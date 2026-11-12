// Local server so you can try the API with curl:  node api/dev-server.ts
// Listens on 127.0.0.1 only. Uses REINKEEP_SIGNER_KEY if set; otherwise makes a throwaway key for this run
// and prints only its public address. Keeps payer history in memory (lost when you stop it).
// Token facts: the collector's local database, COLLECTOR_DB (default collector/data/collector.sqlite, filled by
// `npm run collect:local`), and for any token it does not know, the contract is read live from RPC_URL
// (default: the public Robinhood Chain node).
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createRpcClient } from "../collector/src/contract-facts.ts";
import { D1CollectorStore } from "../collector/src/d1-store.ts";
import { openSqlite } from "../collector/src/sqlite-adapter.ts";
import { MemoryGateStore } from "./src/gate-store.ts";
import { createHandler } from "./src/http-handler.ts";
import { factsLive } from "./src/token-facts-source.ts";

const PORT = Number(process.env.PORT ?? 4190);
const envKey = process.env.REINKEEP_SIGNER_KEY;
if (envKey !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(envKey)) {
  console.error("REINKEEP_SIGNER_KEY must be 0x followed by 64 hex characters.");
  process.exit(1);
}
const account = privateKeyToAccount((envKey as `0x${string}` | undefined) ?? generatePrivateKey());
const dbFile = process.env.COLLECTOR_DB ?? fileURLToPath(new URL("../collector/data/collector.sqlite", import.meta.url));
const rpc = createRpcClient({ url: process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com", fetch: (i, init) => fetch(i, init), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
const tokenFacts = factsLive({ rpc, now: Date.now, store: existsSync(dbFile) ? new D1CollectorStore(openSqlite(dbFile)) : undefined });
const handle = createHandler({ account, now: Date.now, store: new MemoryGateStore(), tokenFacts });

createServer(async (nodeReq, nodeRes) => {
  const hasBody = nodeReq.method !== "GET" && nodeReq.method !== "HEAD" && nodeReq.method !== "OPTIONS";
  const req = new Request(`http://${nodeReq.headers.host ?? "localhost"}${nodeReq.url ?? "/"}`, {
    method: nodeReq.method,
    headers: nodeReq.headers as Record<string, string>,
    body: hasBody ? (Readable.toWeb(nodeReq) as ReadableStream) : undefined,
    duplex: "half",
  } as RequestInit);
  const res = await handle(req);
  nodeRes.writeHead(res.status, Object.fromEntries(res.headers));
  nodeRes.end(Buffer.from(await res.arrayBuffer()));
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Reinkeep gate API on http://127.0.0.1:${PORT}  signer ${account.address}${envKey ? "" : "  (throwaway key for this run)"}`);
  console.log(`token facts: ${existsSync(dbFile) ? dbFile + " + " : ""}live contract reads`);
});
