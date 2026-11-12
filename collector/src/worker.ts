// Cloudflare Worker entry: runs the collector on a cron schedule against a D1 database.
//   bindings: DB (D1 database). Optional variable: RPC_URL (defaults to the public Robinhood Chain node).
// Cloudflare's free plan allows 50 outgoing requests per run, so the run is held to a budget of 45.
import { runCollect } from "./collect-run.ts";
import { D1CollectorStore } from "./d1-store.ts";
import type { D1Like } from "./collector-store.ts";
import { createRpcClient } from "./contract-facts.ts";
import { createGeckoClient } from "./geckoterminal.ts";
import { createBudget } from "./http-json.ts";
import { retentionPlan } from "./retention.ts";

// RPC_URL: contract reads (and launches when LOGS_RPC_URL is not set). LOGS_RPC_URL: launches only, from a node
// that serves eth_getLogs for the last several minutes (the free Chainstack plan does not; see collect-run.ts).
type Env = { DB: D1Like; RPC_URL?: string; LOGS_RPC_URL?: string };

const DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com";
const REQUESTS_PER_RUN = 45;

export default {
  async scheduled(_event: unknown, env: Env): Promise<void> {
    // Not `fetch` directly: calling a detached fetch in Workers throws "Illegal invocation".
    const budget = createBudget(REQUESTS_PER_RUN, (input, init) => fetch(input, init));
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const store = new D1CollectorStore(env.DB);
    // Leave a note that the run began, so a run that gets cut off (CPU limit, crash) still shows up as unfinished.
    let runId: number | null = null;
    try { runId = await store.startRun(Date.now()); } catch (e) { console.log(JSON.stringify({ event: "run_note_failed", error: String(e) })); }
    const stats = await runCollect({
      store,
      gecko: createGeckoClient({ fetch: budget.fetch, sleep, now: Date.now }),
      rpc: createRpcClient({ url: env.RPC_URL ?? DEFAULT_RPC, fetch: budget.fetch, sleep }),
      logsRpc: env.LOGS_RPC_URL ? createRpcClient({ url: env.LOGS_RPC_URL, fetch: budget.fetch, sleep }) : undefined,
      now: Date.now,
      budgetLeft: budget.left,
      // One page of new pools (the 20 newest) per run. The second page is what GeckoTerminal refused from Cloudflare's
      // shared address on 2026-11-10; at about 60 new pools an hour, 20 every 5 minutes is enough when it gets through.
      pages: 1,
      // Launches straight from the chain are OFF (2026-11-11): every free node we tried refuses eth_getLogs for a
      // 5-minute window from Cloudflare (DATA-MODEL.md decision log). The gate reads unknown tokens live instead.
      // To switch on with a node that allows it: set LOGS_RPC_URL and add `chain: {}` here.
    });
    const summary = { requestsUsed: budget.used(), ...stats };
    console.log(JSON.stringify({ event: "collect_run", ...summary }));
    if (runId !== null) await store.finishRun(runId, Date.now(), summary).catch(() => {});

    // Keep the database small. Own try/catch: a failure here must never hide the collection result above.
    // Normally once an hour (the run in minutes 0 to 4); when the database is getting full, every run.
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
  },
};
