// Run the collector once on this machine, against the real network, saving to a local SQLite file.
//   node collector/run-local.ts                 one run (2 pages of new pools, up to 20 contracts)
//   node collector/run-local.ts --sheet 0x...   print the fact sheet for one token already collected
// Data goes to collector/data/collector.sqlite (git-ignored).
import { mkdirSync } from "node:fs";
import { buildTokenFacts } from "./src/token-facts.ts";
import { runCollect } from "./src/collect-run.ts";
import { D1CollectorStore } from "./src/d1-store.ts";
import { createRpcClient } from "./src/contract-facts.ts";
import { createGeckoClient } from "./src/geckoterminal.ts";
import { createBudget } from "./src/http-json.ts";
import { openSqlite } from "./src/sqlite-adapter.ts";

const dataDir = new URL("./data/", import.meta.url);
mkdirSync(dataDir, { recursive: true });
const db = openSqlite(new URL("collector.sqlite", dataDir).pathname);
const store = new D1CollectorStore(db);
const args = process.argv.slice(2);

if (args[0] === "--sheet") {
  const address = (args[1] ?? "").toLowerCase();
  const token = await store.getToken(address);
  if (!token) {
    console.error(`No token ${address} in the local data yet.`);
    process.exit(1);
  }
  const same = token.ticker ? await store.tokensWithTicker(token.ticker) : [];
  console.log(JSON.stringify(buildTokenFacts(token, await store.poolsOfToken(address), same), null, 2));
} else {
  const budget = createBudget(45, (input, init) => fetch(input, init));
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const stats = await runCollect({
    store,
    gecko: createGeckoClient({ fetch: budget.fetch, sleep, now: Date.now }),
    rpc: createRpcClient({ url: process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com", fetch: budget.fetch, sleep }),
    now: Date.now,
    budgetLeft: budget.left,
    chain: {}, // launches from the chain, as on Cloudflare
  });
  console.log(JSON.stringify({ requestsUsed: budget.used(), ...stats }, null, 2));
  console.log("stored so far:", await store.counts());
}
db.close();
