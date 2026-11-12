// New tokens found on the chain itself, from the launcher contract's event: one event per launch.
//
// Why: GeckoTerminal's new_pools page refused about 80% of our calls from Cloudflare's shared addresses
// (measured 2026-11-11), and only 198 of 642 launcher launches reached the database. The chain's RPC node answers
// reliably, so discovery moves here; GeckoTerminal is still asked for market numbers (see collect-run.ts, stage 2).
//
// Shape of the event, checked on real data 2026-11-11 (test/fixtures/rpc-launch-log.json):
//   address = LAUNCHER, topic0 = LAUNCH_TOPIC, topic1 = token, topic2 = pool, topic3 = creator.
// topic2 equalled GeckoTerminal's pool id for 200 of 200 launcher tokens already in the database ("pons-v2" pools).
// This only sees tokens made by THIS launcher. Pools on other DEXes are still found through GeckoTerminal.
import { decodeText, type RpcClient } from "./contract-facts.ts";
import { HttpError } from "./http-json.ts";

export const LAUNCHER = "0xe33e9e479df8802cb0866d5d05258bec4cf62948";
export const LAUNCH_TOPIC = "0xdcacba5e347ae7abd91cb519eb877af8fa7774e347b85dd3ddcd24a2ba8cdf37";
const SYMBOL_CALL = "0x95d89b41";

export type LaunchLog = { token: string; pool: string; block: number };

// The node refused the block range because those blocks count as "archive" on its plan. Seen live from Cloudflare on
// 2026-11-11 for a range starting 24 hours back (the same range worked from a home connection, so a different node
// answers there). Carries the newest block, so the caller can jump to recent blocks and SAY which range it gave up.
export class ArchiveRefused extends HttpError {
  head: number;
  from: number;
  to: number;
  constructor(head: number, from: number, to: number, message: string) {
    super(200, `node refused blocks ${from} to ${to} as archive data: ${message.slice(0, 120)}`);
    this.head = head;
    this.from = from;
    this.to = to;
  }
}
const ARCHIVE = /archive/i;
export type Launch = LaunchLog & { createdMs: number; symbol: string | null };

const WORD_ADDRESS = /^0x0{24}([0-9a-fA-F]{40})$/;
const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

// Trusts nothing: anything that is not exactly the launcher's event with three address topics is ignored.
export function parseLaunchLog(log: unknown): LaunchLog | null {
  if (!isObj(log) || typeof log.address !== "string" || log.address.toLowerCase() !== LAUNCHER) return null;
  const t = log.topics;
  if (!Array.isArray(t) || t.length !== 4 || typeof t[0] !== "string" || t[0].toLowerCase() !== LAUNCH_TOPIC) return null;
  const token = typeof t[1] === "string" ? t[1].match(WORD_ADDRESS) : null;
  const pool = typeof t[2] === "string" ? t[2].match(WORD_ADDRESS) : null;
  const block = typeof log.blockNumber === "string" && /^0x[0-9a-fA-F]+$/.test(log.blockNumber) ? Number.parseInt(log.blockNumber, 16) : NaN;
  if (!token || !pool || !Number.isSafeInteger(block) || block <= 0) return null;
  return { token: "0x" + token[1].toLowerCase(), pool: "0x" + pool[1].toLowerCase(), block };
}

const hexNumber = (v: unknown): number | null => (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v) ? Number.parseInt(v, 16) : null);

export type ScanPlan = {
  cursor: number | null; // the last block already fully processed, or null on the very first run
  lookbackBlocks: number; // where a first run starts, counted back from the newest block
  maxSpanBlocks: number; // most blocks one getLogs call covers (the node allows 10M blocks and 10,000 logs)
  maxLaunches: number; // most launches one run turns into rows (each costs part of a request for its details)
};
export type ScanResult = { launches: LaunchLog[]; scannedTo: number; head: number; skipped: number };

// Reads the launch events after the cursor. If there are more than maxLaunches, it stops at a WHOLE block, so the
// cursor never sits in the middle of a block whose other launches were left out.
export async function scanLaunches(rpc: RpcClient, plan: ScanPlan): Promise<ScanResult> {
  const [headAnswer] = await rpc.batch([{ method: "eth_blockNumber", params: [] }]);
  const head = headAnswer.ok ? hexNumber(headAnswer.value) : null;
  if (head === null) throw new HttpError(200, "could not read the newest block number");
  const from = plan.cursor === null ? Math.max(1, head - plan.lookbackBlocks) : plan.cursor + 1;
  if (from > head) return { launches: [], scannedTo: plan.cursor ?? head, head, skipped: 0 };
  const to = Math.min(head, from + plan.maxSpanBlocks - 1);
  const [logsAnswer] = await rpc.batch([{ method: "eth_getLogs", params: [{ address: LAUNCHER, topics: [LAUNCH_TOPIC], fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16) }] }]);
  if (!logsAnswer.ok && ARCHIVE.test(logsAnswer.message)) throw new ArchiveRefused(head, from, to, logsAnswer.message);
  if (!logsAnswer.ok || !Array.isArray(logsAnswer.value)) throw new HttpError(200, `getLogs failed: ${logsAnswer.ok ? "not a list" : logsAnswer.message}`);

  const parsed = logsAnswer.value.map(parseLaunchLog);
  const launches = parsed.filter((l): l is LaunchLog => l !== null).sort((a, b) => a.block - b.block);
  const skipped = parsed.length - launches.length;
  if (launches.length <= plan.maxLaunches) return { launches, scannedTo: to, head, skipped };
  const stopBlock = launches[plan.maxLaunches].block; // the first block we will NOT finish this run
  const kept = launches.filter((l) => l.block < stopBlock);
  // Only if one block holds more launches than the whole allowance: take that block whole rather than loop forever.
  if (kept.length === 0) return { launches: launches.filter((l) => l.block === stopBlock), scannedTo: stopBlock, head, skipped };
  return { launches: kept, scannedTo: stopBlock - 1, head, skipped };
}

// The launch time (block timestamp) and symbol() for each launch, 5 launches (10 calls) per request.
// A missing symbol is null (never a guess); a missing block time is a failure, because time is needed to tell copies apart.
export async function launchDetails(rpc: RpcClient, logs: LaunchLog[]): Promise<Launch[]> {
  const out: Launch[] = [];
  for (let i = 0; i < logs.length; i += 5) {
    const part = logs.slice(i, i + 5);
    const answers = await rpc.batch(
      part.flatMap((l) => [
        { method: "eth_getBlockByNumber", params: ["0x" + l.block.toString(16), false] },
        { method: "eth_call", params: [{ to: l.token, data: SYMBOL_CALL }, "latest"] },
      ]),
    );
    part.forEach((l, j) => {
      const block = answers[2 * j];
      const ts = block.ok && isObj(block.value) ? hexNumber(block.value.timestamp) : null;
      if (ts === null || ts <= 0) throw new HttpError(200, `could not read the time of block ${l.block}`);
      const sym = answers[2 * j + 1];
      out.push({ ...l, createdMs: ts * 1000, symbol: sym.ok ? decodeText(sym.value) : null });
    });
  }
  return out;
}
