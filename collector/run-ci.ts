// One scheduled collector run from GitHub Actions, writing to the production D1 database over Cloudflare's REST API.
//   node collector/run-ci.ts
// Why it exists: from Cloudflare's own addresses GeckoTerminal answers HTTP 429 and the RPC node refuses eth_getLogs
// (measured 2026-11-11, see DATA-MODEL.md). From a GitHub runner both answer, so the same collector runs here instead.
// It is the same runCollect() as the Worker, with the chain stage switched on.
//
// Environment (GitHub repository secrets):
//   CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID, CLOUDFLARE_API_TOKEN   (token needs only "D1 Edit")
//   RPC_URL       optional, contract reads (defaults to the public node)
//   LOGS_RPC_URL  optional, node for eth_getLogs (defaults to RPC_URL)
import { runCollect } from "./src/collect-run.ts";
import { D1CollectorStore } from "./src/d1-store.ts";
import { createD1Rest } from "./src/d1-rest.ts";
import { createRpcClient } from "./src/contract-facts.ts";
import { createGeckoClient } from "./src/geckoterminal.ts";
import { createBudget } from "./src/http-json.ts";
import { retentionPlan } from "./src/retention.ts";

const DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com";

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Set it as a GitHub repository secret (see collector/DEPLOY.md, "GitHub Actions").`);
    process.exit(2);
  }
  return v;
}

const db = createD1Rest({
  accountId: need("CLOUDFLARE_ACCOUNT_ID"),
  databaseId: need("D1_DATABASE_ID"),
  apiToken: need("CLOUDFLARE_API_TOKEN"),
});
const store = new D1CollectorStore(db);

// No 50-request cap here (that is Cloudflare's). GitHub starts scheduled runs late: Actuary's hourly job ran 4 to 11
// hours apart on 8-11 Nov. The chain makes ~35,000 blocks an hour, so one run must be able to read ~13 hours of
// launches (15 scans of 30,000 blocks, the public node's getLogs limit per Actuary's tickers.py). GeckoTerminal calls
// stay paced at 2.2 s by the client; at most 2 + 10 + 6 = 18 of them, about 40 s.
const budget = createBudget(400, (input, init) => fetch(input, init));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const rpcUrl = process.env.RPC_URL || DEFAULT_RPC;

let runId: number | null = null;
try { runId = await store.startRun(Date.now()); } catch (e) { console.log(JSON.stringify({ event: "run_note_failed", error: String(e) })); }

const stats = await runCollect({
  store,
  gecko: createGeckoClient({ fetch: budget.fetch, sleep, now: Date.now }),
  rpc: createRpcClient({ url: rpcUrl, fetch: budget.fetch, sleep }),
  logsRpc: process.env.LOGS_RPC_URL ? createRpcClient({ url: process.env.LOGS_RPC_URL, fetch: budget.fetch, sleep }) : undefined,
  now: Date.now,
  budgetLeft: budget.left,
  pages: 2,
  maxFacts: 100,
  resolveBatches: 6,
  chain: { maxSpanBlocks: 30_000, maxLaunches: 200, maxScans: 15, launchBatches: 10 },
});
const summary = { requestsUsed: budget.used(), ...stats };
console.log(JSON.stringify({ event: "collect_run", ...summary }));
if (runId !== null) await store.finishRun(runId, Date.now(), summary).catch((e) => console.log(JSON.stringify({ event: "finish_note_failed", error: String(e) })));

// Same retention as the Worker: hourly (the run in minutes 0 to 4), or every run when the database is getting full.
try {
  const nowMs = Date.now();
  const sizeBytes = await store.sizeBytes();
  const plan = retentionPlan(sizeBytes, nowMs);
  const hourly = new Date(nowMs).getUTCMinutes() < 5;
  if (hourly) await store.pruneRuns(nowMs - 14 * 86_400_000);
  const pruned = hourly || plan.level !== "normal" ? await store.prune(plan.cutoffMs, hourly ? 300 : 100) : null;
  console.log(JSON.stringify({ event: "retention", sizeMb: sizeBytes === null ? null : Math.round(sizeBytes / 1048576), level: plan.level, keepDays: plan.keepDays, pruned }));
} catch (e) {
  console.log(JSON.stringify({ event: "retention_failed", error: e instanceof Error ? e.message : String(e) }));
}

// A run where nothing worked at all should show red in GitHub, so a dead collector is noticed.
const everythingFailed = stats.errors.length >= 2 && stats.poolsSeen === 0 && stats.launchesFound === 0 && stats.chainScannedTo === null;
if (everythingFailed) {
  console.error("Every stage failed this run.");
  process.exit(1);
}
