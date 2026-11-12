// Shared test bench for the collector: a fake internet that answers GeckoTerminal with the REAL responses recorded on
// 2026-11-10 (test/fixtures), and a fake chain node whose tokens the test describes. No test touches the network.
import { readFileSync } from "node:fs";
import { encodeAbiParameters } from "viem";
import type { Fetcher } from "../collector/src/http-json.ts";

export const fixture = (name: string): any => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

export const word = (n: bigint): string => "0x" + n.toString(16).padStart(64, "0");
export const addressWord = (a: string): string => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
export const textResult = (s: string): string => encodeAbiParameters([{ type: "string" }], [s]);

// A token with no special powers, then one that carries the given 4-byte selectors (as solidity's dispatcher would).
export const PLAIN_CODE = "0x608060405263a9059cbb00";
export const codeWith = (...selectors: string[]): string => "0x6080604052" + "63a9059cbb" + selectors.map((s) => "63" + s.replace(/^0x/, "")).join("") + "00"; // carries transfer(), like any ERC-20

export const MINT = "40c10f19"; // mint(address,uint256)
export const PAUSE = "8456cb59"; // pause()
export const UPGRADE = "3659cfe6"; // upgradeTo(address)
export const BLACKLIST = "f9f92be4"; // blacklist(address)

export const NOW = Date.parse("2026-11-10T05:50:00Z"); // eight minutes after the newest recorded pool
export const RPC_URL = "https://rpc.test";

export type TokenSpec = {
  code?: string;
  slot?: string; // EIP-1967 implementation slot value
  owner?: "revert" | "zero" | "garbage" | string; // an address string means that owner
  supply?: bigint;
  decimals?: bigint;
  symbol?: string; // "bytes32:MKR" answers like an old token
  codeFails?: boolean;
};

type Call = { method: string; params: any[] };
type Reply = { result: unknown } | { error: { code: number; message: string; data?: string } };

// A fake chain for the launch reader: a head block, the launch logs on it, and each block's time (seconds).
// archiveBelow: getLogs ranges starting under this block are refused with the REAL message Cloudflare got on 2026-11-11.
export type Chain = { head: number; logs: any[]; blockTime?: (block: number) => number; logsFail?: boolean; blockFails?: number[]; archiveBelow?: number };
export const ARCHIVE_MESSAGE = "Archive, Debug and Trace requests are not available on your current plan. Visit https://console.chainstack.com/user/settings/billing to upgrade..";
const hex = (n: number) => "0x" + n.toString(16);

function chainAnswer(call: Call, chain: Chain): Reply | null {
  if (call.method === "eth_blockNumber") return { result: hex(chain.head) };
  if (call.method === "eth_getLogs") {
    if (chain.logsFail) return { error: { code: -32005, message: "query returned more than 10000 results" } };
    const f = call.params[0];
    const from = Number.parseInt(f.fromBlock, 16), to = Number.parseInt(f.toBlock, 16);
    if (chain.archiveBelow !== undefined && from < chain.archiveBelow) return { error: { code: -32601, message: ARCHIVE_MESSAGE } };
    return { result: chain.logs.filter((l) => l.address === f.address && l.topics[0] === f.topics[0] && Number.parseInt(l.blockNumber, 16) >= from && Number.parseInt(l.blockNumber, 16) <= to) };
  }
  if (call.method === "eth_getBlockByNumber") {
    const n = Number.parseInt(call.params[0], 16);
    if (chain.blockFails?.includes(n)) return { error: { code: -32000, message: "header not found" } };
    return { result: { number: hex(n), timestamp: hex(chain.blockTime ? chain.blockTime(n) : 1_700_000_000 + n) } };
  }
  return null;
}

export function nodeAnswer(call: Call, specs: Record<string, TokenSpec>, impls: Record<string, string | null>, chain?: Chain): Reply {
  if (chain) {
    const answer = chainAnswer(call, chain);
    if (answer) return answer;
  }
  const target = String(call.method === "eth_call" ? call.params[0].to : call.params[0]).toLowerCase();
  if (call.method === "eth_getCode" && target in impls) {
    const code = impls[target];
    return code === null ? { error: { code: -32000, message: "node hiccup" } } : { result: code };
  }
  const s = specs[target] ?? {};
  switch (call.method) {
    case "eth_getCode":
      return s.codeFails ? { error: { code: -32000, message: "node hiccup" } } : { result: s.code ?? PLAIN_CODE };
    case "eth_getStorageAt":
      return { result: s.slot ?? word(0n) };
    case "eth_call": {
      const data = String(call.params[0].data);
      if (data === "0x8da5cb5b") {
        const o = s.owner ?? "revert";
        if (o === "revert") return { error: { code: 3, message: "execution reverted", data: "0x" } };
        if (o === "zero") return { result: word(0n) };
        if (o === "garbage") return { result: "0x" + "ff".repeat(32) };
        return { result: addressWord(o) };
      }
      if (data === "0x18160ddd") return { result: word(s.supply ?? 10n ** 27n) };
      if (data === "0x313ce567") return { result: word(s.decimals ?? 18n) };
      if (data === "0x95d89b41") {
        const sym = s.symbol ?? "TKN";
        return { result: sym.startsWith("bytes32:") ? "0x" + Buffer.from(sym.slice(8)).toString("hex").padEnd(64, "0") : textResult(sym) };
      }
      return { error: { code: 3, message: "execution reverted", data: "0x" } };
    }
    default:
      return { error: { code: -32601, message: "method not found" } };
  }
}

export type Internet = {
  specs?: Record<string, TokenSpec>;
  impls?: Record<string, string | null>;
  gecko?: "ok" | "error500" | "challenge";
  rpc?: "ok" | "challenge" | "slow-down" | "omit-last" | "not-a-list";
  newPools?: Record<number, unknown>; // page -> body; default is the recorded page for every page
  multi?: unknown;
  chain?: Chain;
};

export function fakeInternet(o: Internet = {}) {
  const calls: { url: string; method: string; body?: any }[] = [];
  const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
  const challenge = () => new Response("<html>Just a moment...</html>", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } });

  const fetch: Fetcher = async (url, init) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url.startsWith("https://api.geckoterminal.com")) {
      if (o.gecko === "error500") return new Response("boom", { status: 500 });
      if (o.gecko === "challenge") return challenge();
      if (url.includes("/pools/multi/")) return json(o.multi ?? fixture("gecko-multi.json"));
      const page = Number(new URL(url).searchParams.get("page"));
      return json(o.newPools?.[page] ?? fixture("gecko-new-pools.json"));
    }
    if (url === RPC_URL) {
      if (o.rpc === "challenge") return challenge();
      if (o.rpc === "slow-down") return new Response("", { status: 429 });
      if (o.rpc === "not-a-list") return json({ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "batch not supported" } });
      const answers = (body as any[]).map((c) => ({ jsonrpc: "2.0", id: c.id, ...nodeAnswer(c, o.specs ?? {}, o.impls ?? {}, o.chain) }));
      return json(o.rpc === "omit-last" ? answers.slice(0, -1) : answers);
    }
    return new Response("unexpected host", { status: 599 });
  };
  return { fetch, calls, count: (host: string) => calls.filter((c) => c.url.includes(host)).length };
}

export const noSleep = async (): Promise<void> => {};
