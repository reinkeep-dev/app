// The four later features of the gate API, through the Cloudflare entry with fakes: an in-memory SQLite standing in for D1,
// fake Durable Object namespaces, a fake chain node (the collector's fixtures) and a fake facilitator. No network.
//   1. GET /api/v1/verdict/{address}   free token check, 60 per IP per day
//   2. POST /api/v1/gate/batch         up to 10 tokens, one free call (or one price) each
//   3. receipts stored in D1, GET /api/v1/receipts/{id} and the /r/{id} share page
//   4. GET /api/status and /status
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { openSqlite } from "../collector/src/sqlite-adapter.ts";
import type { TokenFacts } from "../collector/src/token-facts.ts";
import type { LedgerEntry } from "../engine/policy.ts";
import type { LedgerStorage } from "../api/src/gate-store.ts";
import { createHandler } from "../api/src/http-handler.ts";
import { FreeTier, meter } from "../api/src/metering.ts";
import { toBase64 } from "../api/src/x402.ts";
import { makeWorker, PayerLedger } from "../api/src/worker.ts";
import { MINT, PLAIN_CODE, RPC_URL, codeWith, fakeInternet, type TokenSpec } from "./collector-fixtures.ts";
import { PAYER, goodRequest, knownPolicy, makeApp } from "./api-fixture.ts";

const OWNER = "0x1111111111111111111111111111111111111111";
const SHARE = "https://reinkeep-gate.reinkeep.workers.dev/r/";
const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const RISKY = addr(0xa1); // has mint() and a live owner: BLOCK
const PLAIN = addr(0xa2); // a bare contract: liquidity unknown, so REVIEW at best
const TOKENS: Record<string, TokenSpec> = {
  [RISKY]: { code: codeWith(MINT), owner: addr(0xdead) },
  [PLAIN]: { code: PLAIN_CODE },
};

// The worker builds its own chain client on the global fetch, so the fake node goes there for the whole file.
const realFetch = globalThis.fetch;
const internet = fakeInternet({ specs: TOKENS });
globalThis.fetch = ((input: any, init?: RequestInit) => internet.fetch(String(input), init)) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});

async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const was = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = was;
  }
}

type Config = { env?: Record<string, unknown>; payer?: boolean; facilitator?: typeof fetch };

function setup(config: Config = {}) {
  const db = openSqlite(":memory:");
  const pending: Promise<unknown>[] = [];
  const free = new Map<string, Map<string, any>>();
  const freeInst = new Map<string, FreeTier>();
  const mem = (m: Map<string, any>) => ({ get: async (k: string) => m.get(k), put: async (k: string, v: any) => void m.set(k, structuredClone(v)) });
  const env: any = {
    REINKEEP_SIGNER_KEY: generatePrivateKey(),
    RPC_URL,
    DB: db,
    X402_PAY_TO: OWNER,
    PRIORS_API_KEY: "secret-key-123",
    FREE: {
      idFromName: (n: string) => n,
      get: (id: string) => ({
        fetch: (req: Request) => {
          if (!free.has(id)) free.set(id, new Map());
          if (!freeInst.has(id)) freeInst.set(id, new FreeTier({ storage: mem(free.get(id)!) }));
          return freeInst.get(id)!.fetch(req);
        },
      }),
    },
    ...config.env,
  };
  if (config.payer) {
    const stores = new Map<string, Map<string, LedgerEntry[]>>();
    env.PAYER = {
      idFromName: (n: string) => n,
      get: (id: string) => ({
        fetch: (req: Request) => {
          if (!stores.has(id)) stores.set(id, new Map());
          const st = stores.get(id)!;
          const storage = { get: async (k: string) => st.get(k), put: async (k: string, v: LedgerEntry[]) => void st.set(k, structuredClone(v)) } as LedgerStorage;
          return new PayerLedger({ storage, waitUntil: (p: Promise<unknown>) => void pending.push(p) }, env).fetch(req);
        },
      }),
    };
  }
  const facilitatorCalls: string[] = [];
  const facilitator =
    config.facilitator ??
    ((async (url: string) => {
      const path = new URL(url).pathname;
      facilitatorCalls.push(path);
      if (path === "/health") return new Response("ok");
      return new Response(JSON.stringify(path === "/verify" ? { isValid: true, payer: PAYER } : { success: true, transaction: "0xabc", network: "eip155:4663", payer: PAYER }));
    }) as unknown as typeof fetch);
  const worker = makeWorker(facilitator, async () => {});

  async function send(method: string, path: string, over: { b?: unknown; ip?: string; sig?: unknown } = {}) {
    const headers: Record<string, string> = {};
    if (over.b !== undefined) headers["content-type"] = "application/json";
    if (over.ip) headers["cf-connecting-ip"] = over.ip;
    if (over.sig !== undefined) headers["payment-signature"] = toBase64(over.sig);
    const res = await worker.fetch(new Request("https://gate.test" + path, { method, headers, body: over.b === undefined ? undefined : JSON.stringify(over.b) }), env, { waitUntil: (p: Promise<unknown>) => void pending.push(p) });
    await Promise.all(pending.splice(0)); // let the background receipt save finish before anything looks at the table
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    return { status: res.status, headers: res.headers, text, data };
  }
  const gate = (request: Record<string, unknown> = goodRequest(), extra: Record<string, unknown> = {}, ip = "1.1.1.1") => send("POST", "/api/v1/gate", { b: { request, policy: knownPolicy, ...extra }, ip });
  const batch = (tokens: unknown, extra: Record<string, unknown> = {}, ip = "1.1.1.1", sig?: unknown) =>
    send("POST", "/api/v1/gate/batch", { b: { request: goodRequest(), policy: knownPolicy, tokens, ...extra }, ip, sig });
  const verdict = (address: string, ip = "1.1.1.1") => send("GET", "/api/v1/verdict/" + address, { ip });
  const count = (id: string) => (free.get(id)?.get("count") as { count: number } | undefined)?.count ?? 0;
  const rows = () => db.raw.prepare("SELECT id, decision, json, issued_at FROM receipts ORDER BY id").all() as { id: string; decision: string; json: string; issued_at: number }[];
  return { env, db, send, gate, batch, verdict, count, rows, facilitatorCalls, free };
}

const codes = (r: { data: any }): string[] => r.data.reasons.map((x: any) => x.code);

// ---------------------------------------------------------------- 1. verdict

test("verdict: a token with a mint function and a live owner is BLOCK, with the exact answer shape", async () => {
  const s = setup();
  const r = await s.verdict(RISKY);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.data).sort(), ["checkedAt", "decision", "explanation", "facts", "reasons", "token"]);
  assert.equal(r.data.decision, "BLOCK");
  assert.equal(r.data.token, RISKY);
  assert.deepEqual(codes(r), ["token_mint_live_owner"]);
  assert.ok(r.data.reasons[0].plain.length > 5);
  assert.equal(r.data.facts.mint_with_live_owner, true);
  assert.equal(r.data.explanation.source, "rules"); // no AI binding in this env
  assert.match(r.data.explanation.text, /^Blocked\./);
  assert.ok(Math.abs(Date.parse(r.data.checkedAt) - Date.now()) < 5000);
  assert.equal(new Date(r.data.checkedAt).toISOString(), r.data.checkedAt);
  assert.equal(r.data.receipt, undefined, "a verdict is not signed");
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});

test("verdict: a bare contract whose liquidity we cannot know is REVIEW, never ALLOW", async () => {
  const s = setup();
  const r = await s.verdict(PLAIN.toUpperCase().replace("0X", "0x")); // the address is matched without case
  assert.equal(r.status, 200);
  assert.equal(r.data.decision, "REVIEW");
  assert.equal(r.data.token, PLAIN);
  assert.deepEqual(codes(r), ["token_facts_unknown"]);
  assert.equal(r.data.explanation.source, "rules");
});

test("verdict: no data at all is REVIEW token_unknown with facts null; a clean token with known liquidity is ALLOW", async () => {
  const clean: TokenFacts = {
    token: PLAIN, ticker: "CLEAN", facts_read_at_ms: 1, is_contract: true, is_proxy: false, has_mint: false, has_pause: false, has_blacklist: false,
    has_upgrade: false, has_owner_function: false, owner_renounced: null, mint_with_live_owner: false, total_supply: "1000", decimals: 18,
    pool_count: 1, seen_age_minutes: 5, seen_liquidity_usd: 25_000, seen_volume_usd: 100, seen_swaps: 10, liquidity_not_reported: false,
    ticker_uses: 1, ticker_clone_of_older: false,
  };
  const app = makeApp({ tokenFacts: async (t) => (t === PLAIN ? clean : null) });
  const none = await app.send("GET", "/api/v1/verdict/" + RISKY);
  assert.equal(none.data.decision, "REVIEW");
  assert.deepEqual(codes(none), ["token_unknown"]);
  assert.equal(none.data.facts, null);
  const ok = await app.send("GET", "/api/v1/verdict/" + PLAIN);
  assert.equal(ok.data.decision, "ALLOW");
  assert.deepEqual(ok.data.reasons, []);
  assert.deepEqual(ok.data.facts, clean);
  assert.match(ok.data.explanation.text, /^Allowed\. No rule objected\.$/);
  assert.equal(ok.data.checkedAt, new Date(app.clock.now).toISOString());
  // Only GET is accepted.
  assert.equal((await app.send("POST", "/api/v1/verdict/" + PLAIN, {})).status, 405);
});

test("verdict: the AI note is used when it is clean, and the rule text when it is not", async () => {
  const sayings: unknown[] = ["The token has a mint function its owner can still use.", "You should buy this."];
  const key = generatePrivateKey();
  const { aiExplainer } = await import("../api/src/explain.ts");
  const ai = { run: async () => ({ response: sayings.shift() }) };
  const handle = createHandler({ account: privateKeyToAccount(key), now: () => Date.now(), tokenFacts: async () => null, explain: aiExplainer(ai) });
  const get = async () => (await handle(new Request("http://x.test/api/v1/verdict/" + PLAIN))).json() as Promise<any>;
  assert.equal((await get()).explanation.source, "ai");
  assert.equal((await get()).explanation.source, "rules");
});

test("verdict: a bad address is 400 and does not use a slot", async () => {
  const s = setup();
  for (const bad of ["0x123", "nope", RISKY.slice(0, -1) + "g", RISKY + "00"]) {
    const r = await s.verdict(bad);
    assert.equal(r.status, 400, bad);
    assert.equal(r.data.error.code, "invalid_address");
  }
  assert.equal(s.free.size, 0, "no counter was even created");
});

test("verdict: the 61st check of the day from one IP is 429 verdict_limit; other IPs and the gate counter are untouched", async () => {
  const s = setup();
  for (let i = 1; i <= 60; i++) assert.equal((await s.verdict(PLAIN)).status, 200, `call ${i}`);
  const over = await s.verdict(PLAIN);
  assert.equal(over.status, 429);
  assert.equal(over.data.error.code, "verdict_limit");
  assert.equal(s.count("verdict:1.1.1.1"), 60);
  assert.equal((await s.verdict(PLAIN, "2.2.2.2")).status, 200);
  // The gate has its own 25 per day: still untouched.
  const g = await s.gate();
  assert.equal(g.status, 200);
  assert.equal(g.headers.get("x-free-calls-left"), "24");
});

test("verdict: a check that fails gives its slot back (metering with a route that answers 500)", async () => {
  const s = setup();
  const res = await meter(new Request("https://gate.test/api/v1/verdict/" + PLAIN, { headers: { "cf-connecting-ip": "9.9.9.9" } }), s.env, {
    route: async () => new Response("{}", { status: 500 }),
    fetch,
  });
  assert.equal(res!.status, 500);
  assert.equal(s.count("verdict:9.9.9.9"), 0);
});

test("FreeTier: ?limit= and ?n= change the cap and the step, and the default is still 25 one at a time", async () => {
  const m = new Map<string, any>();
  const tier = new FreeTier({ storage: { get: async (k) => m.get(k), put: async (k, v) => void m.set(k, v) } });
  const call = async (path: string) => (await tier.fetch(new Request("https://free" + path, { method: "POST" }))).json() as Promise<{ ok: boolean; left: number }>;
  assert.deepEqual(await call("/take?limit=2"), { ok: true, left: 1 });
  assert.deepEqual(await call("/take?limit=2&n=2"), { ok: false, left: 1 }); // all or nothing
  assert.deepEqual(await call("/take?limit=2"), { ok: true, left: 0 });
  assert.deepEqual(await call("/take?limit=2"), { ok: false, left: 0 });
  assert.deepEqual(await call("/refund?n=2"), { ok: true, left: 25 }); // back to 0 used; with no ?limit= the cap is the default 25
  assert.deepEqual(await call("/take"), { ok: true, left: 24 });
});

// ---------------------------------------------------------------- 2. batch

test("batch: 3 tokens give 3 gate answers in order, each with its own valid signed receipt, and use 3 free slots", async () => {
  const s = setup();
  const r = await s.batch([RISKY, PLAIN, addr(0xa3)]);
  assert.equal(r.status, 200);
  assert.equal(r.data.results.length, 3);
  assert.deepEqual(r.data.results.map((x: any) => x.receipt.body.buying.token), [RISKY, PLAIN, addr(0xa3)]);
  assert.equal(r.data.results[0].decision, "BLOCK");
  assert.equal(r.data.results[1].decision, "REVIEW");
  assert.equal(new Set(r.data.results.map((x: any) => x.id)).size, 3);
  for (const x of r.data.results) {
    assert.deepEqual(Object.keys(x).sort(), ["decision", "explanation", "id", "reasons", "receipt", "shareUrl"]);
    const v = await s.send("POST", "/api/v1/receipts/verify", { b: { receipt: x.receipt } });
    assert.equal(v.data.valid, true);
  }
  assert.equal(s.count("1.1.1.1"), 3);
  assert.equal(r.headers.get("x-free-calls-left"), "22");
});

test("batch: 11 tokens, none, a bad address or a payer are 400 and use no slot", async () => {
  const s = setup();
  const eleven = Array.from({ length: 11 }, (_, i) => addr(i + 1));
  const many = await s.batch(eleven);
  assert.equal(many.status, 400);
  assert.equal(many.data.error.code, "too_many_tokens");
  assert.equal((await s.batch([])).data.error.code, "invalid_tokens");
  assert.equal((await s.batch("0xabc" as any)).data.error.code, "invalid_tokens");
  assert.equal((await s.batch([RISKY, "0x12"])).data.error.code, "invalid_address");
  const withPayer = await s.batch([RISKY], { payer: PAYER });
  assert.equal(withPayer.status, 400);
  assert.equal(withPayer.data.error.code, "payer_not_supported_in_batch");
  assert.equal(s.count("1.1.1.1"), 0);
  assert.equal(s.rows().length, 0);
  // Ten is fine.
  assert.equal((await s.batch(eleven.slice(0, 10))).status, 200);
  assert.equal(s.count("1.1.1.1"), 10);
});

test("batch: a request the gate refuses gives the slots back", async () => {
  const s = setup();
  const r = await s.send("POST", "/api/v1/gate/batch", { b: { request: goodRequest({ payTo: "nope" }), tokens: [RISKY, PLAIN] }, ip: "1.1.1.1" });
  assert.equal(r.status, 400);
  assert.equal(s.count("1.1.1.1"), 0);
});

test("batch: not enough free calls left means 402 for 3 x the price, and the payment must match that amount", async () => {
  const s = setup();
  for (let i = 0; i < 23; i++) assert.equal((await s.gate()).status, 200); // 2 slots left
  const r = await s.batch([RISKY, PLAIN, addr(0xa3)]);
  assert.equal(r.status, 402);
  assert.equal(r.data.accepts[0].amount, "30000");
  assert.equal(s.count("1.1.1.1"), 23, "nothing was taken");
  const terms = r.data.accepts[0];
  const payload = (amount: string) => ({ x402Version: 2, accepted: { ...terms, amount }, payload: { signature: "0xsig", authorization: {} } });
  // A payment for one call is not enough for three.
  const cheap = await s.batch([RISKY, PLAIN, addr(0xa3)], {}, "1.1.1.1", payload("10000"));
  assert.equal(cheap.status, 402);
  assert.match(cheap.data.error, /wrong amount/);
  assert.deepEqual(s.facilitatorCalls, []);
  // The right amount passes: verified, gated, then settled.
  const paid = await s.batch([RISKY, PLAIN, addr(0xa3)], {}, "1.1.1.1", payload("30000"));
  assert.equal(paid.status, 200);
  assert.equal(paid.data.results.length, 3);
  assert.deepEqual(s.facilitatorCalls, ["/verify", "/settle"]);
  assert.ok(paid.headers.get("payment-response"));
  assert.equal(s.count("1.1.1.1"), 23);
  // One token is still priced as one call.
  const one = await s.batch([RISKY]);
  assert.equal(one.status, 200); // 2 slots were left
  assert.equal(s.count("1.1.1.1"), 24);
});

// ---------------------------------------------------------------- 3. receipts

test("receipts: a gate answer is stored, carries shareUrl, and is fetched back with a fresh valid check", async () => {
  const s = setup();
  const g = await s.gate(goodRequest(), { token: PLAIN });
  assert.equal(g.status, 200);
  assert.equal(g.data.shareUrl, SHARE + g.data.id);
  const rows = s.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, g.data.id);
  assert.equal(rows[0].decision, g.data.decision);
  assert.equal(rows[0].issued_at, g.data.receipt.issuedAt);
  assert.deepEqual(JSON.parse(rows[0].json), g.data.receipt);

  const got = await s.send("GET", "/api/v1/receipts/" + g.data.id);
  assert.equal(got.status, 200);
  assert.deepEqual(got.data.receipt, g.data.receipt);
  assert.equal(got.data.valid, true);
  const signer = await s.send("GET", "/api/v1/receipts/signer");
  assert.equal(got.data.signer, signer.data.signer);
});

test("receipts: an unknown or malformed id is 404, and a tampered stored receipt reads as not valid", async () => {
  const s = setup();
  const miss = await s.send("GET", "/api/v1/receipts/rk_0000000000000000");
  assert.equal(miss.status, 404);
  assert.equal(miss.data.error.code, "receipt_not_found");
  assert.equal((await s.send("GET", "/api/v1/receipts/whatever")).status, 404);
  assert.equal((await s.send("POST", "/api/v1/receipts/rk_0000000000000000", { b: {} })).status, 405);

  const g = await s.gate();
  const stored = JSON.parse(s.rows()[0].json);
  stored.decision = "ALLOW" === stored.decision ? "BLOCK" : "ALLOW"; // someone edits the database
  s.db.raw.prepare("UPDATE receipts SET json = ? WHERE id = ?").run(JSON.stringify(stored), g.data.id);
  const got = await s.send("GET", "/api/v1/receipts/" + g.data.id);
  assert.equal(got.data.valid, false);
  assert.equal(typeof got.data.reason, "string");
});

test("receipts: every receipt of a batch is stored, and so is one answered inside a payer's Durable Object", async () => {
  const s = setup({ payer: true });
  const b = await s.batch([RISKY, PLAIN]);
  assert.deepEqual(s.rows().map((r) => r.id).sort(), b.data.results.map((x: any) => x.id).sort());

  const viaDo = await s.send("POST", "/api/v1/gate", { b: { request: goodRequest({ resourceUrl: "https://api.example.com/v2/other" }), policy: knownPolicy, payer: PAYER }, ip: "3.3.3.3" });
  assert.equal(viaDo.status, 200);
  assert.equal(viaDo.data.receipt.body.stateful, true);
  assert.ok(s.rows().some((r) => r.id === viaDo.data.id));
  assert.equal((await s.send("GET", "/api/v1/receipts/" + viaDo.data.id)).data.valid, true);
});

test("receipts: a save that fails is swallowed (answer 200, error logged), and a save that never ends does not hold the answer", async () => {
  const s = setup();
  const real = s.env.DB;
  s.env.DB = { prepare: (sql: string) => (/INSERT/.test(sql) ? (() => { throw new Error("disk on fire"); })() : real.prepare(sql)) };
  const g = await quietly(() => s.gate());
  assert.equal(g.status, 200);
  assert.equal(g.data.decision, "ALLOW");
  assert.equal(s.rows().length, 0);

  // Directly: a store whose put() never resolves. The handler answers anyway.
  const handle = createHandler({
    account: privateKeyToAccount(generatePrivateKey()),
    now: () => Date.now(),
    receipts: { put: () => new Promise<void>(() => {}), get: async () => null },
  });
  const res = await Promise.race([
    handle(new Request("http://x.test/api/v1/gate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: goodRequest(), policy: knownPolicy }) })),
    new Promise<"slow">((r) => setTimeout(() => r("slow"), 1000)),
  ]);
  assert.notEqual(res, "slow");
  assert.equal((res as Response).status, 200);
});

test("receipts: without a database there is no shareUrl and the receipt endpoints say so", async () => {
  const s = setup({ env: { DB: undefined } });
  const g = await s.gate();
  assert.equal(g.status, 200);
  assert.equal("shareUrl" in g.data, false);
  const got = await s.send("GET", "/api/v1/receipts/rk_0000000000000000");
  assert.equal(got.status, 503);
  assert.equal(got.data.error.code, "receipts_unavailable");
  assert.equal((await s.send("GET", "/r/rk_0000000000000000")).status, 404);
});

test("share page: shows the decision, reasons, payment, token facts, signer and the signature check", async () => {
  const s = setup();
  const g = await s.gate(goodRequest(), { token: RISKY });
  const page = await s.send("GET", "/r/" + g.data.id);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type")!, /^text\/html/);
  assert.match(page.text, /class="verdict BLOCK">BLOCK</);
  assert.match(page.text, /token_mint_live_owner/);
  assert.ok(page.text.includes(g.data.reasons[0].plain.replace(/'/g, "&#39;")));
  assert.match(page.text, /0\.01/); // 10000 base units, 6 decimals
  assert.match(page.text, /0xAbCd…0001/); // payTo, shortened
  assert.match(page.text, /eip155:4663/);
  assert.ok(page.text.includes(RISKY));
  assert.match(page.text, /mint_with_live_owner/);
  assert.ok(page.text.includes(g.data.receipt.signer));
  assert.match(page.text, /Valid signature/);
  assert.ok(page.text.includes(`/api/v1/receipts/${g.data.id}`));
  assert.ok(page.text.includes("https://reinkeep-site.reinkeep.workers.dev"));
  assert.ok(page.text.includes(new Date(g.data.receipt.issuedAt * 1000).toISOString()));
  assert.match(page.headers.get("content-security-policy")!, /default-src 'none'/);
  assert.doesNotMatch(page.text, /<script/i);
  assert.match(page.text, /viewport/);

  const gone = await s.send("GET", "/r/rk_0000000000000000");
  assert.equal(gone.status, 404);
  assert.match(gone.headers.get("content-type")!, /^text\/html/);
});

test("share page: a hostile resourceUrl and hostile stored values are escaped, never raw HTML", async () => {
  const s = setup();
  const hostile = `<script>alert("x")</script>`;
  const g = await s.gate(goodRequest({ resourceUrl: hostile, quotedAmount: undefined }));
  assert.equal(g.status, 200);
  assert.deepEqual(codes(g), ["resource_invalid"]);
  const page = await s.send("GET", "/r/" + g.data.id);
  assert.equal(page.status, 200);
  assert.ok(!page.text.includes("<script>alert"), "raw script tag must not appear");
  assert.ok(page.text.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));

  // Even a row edited by hand to carry markup everywhere comes out inert.
  const stored = JSON.parse(s.rows()[0].json);
  const evil = `"><img src=x onerror=alert(1)>`;
  stored.signer = evil;
  stored.body.request.network = evil;
  stored.body.request.payTo = evil;
  stored.body.reasons = [evil];
  stored.body.buying = { token: evil, facts: { [evil]: evil } };
  s.db.raw.prepare("UPDATE receipts SET json = ? WHERE id = ?").run(JSON.stringify(stored), g.data.id);
  const page2 = await s.send("GET", "/r/" + g.data.id);
  assert.ok(!page2.text.includes("<img"), "no raw tag from stored values");
  assert.ok(!page2.text.includes('"><img'), "a quote cannot close an attribute");
  assert.ok(page2.text.includes("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"));
  assert.match(page2.text, /Not valid/);
});

// ---------------------------------------------------------------- 4. status

const NODE_BLOCK = "0x1b4"; // 436

function statusFetch(over: { rpc?: "ok" | "hang" | "error"; health?: "ok" | "down" } = {}): typeof fetch {
  return (async (input: any, init?: RequestInit) => {
    const url = String(input);
    if (url === SECRET_RPC) {
      if (over.rpc === "hang") return new Promise<Response>(() => {});
      if (over.rpc === "error") throw new Error(`connect ECONNREFUSED ${SECRET_RPC}`);
      return new Response(JSON.stringify([{ jsonrpc: "2.0", id: 1, result: NODE_BLOCK }]));
    }
    if (url.endsWith("/health")) return over.health === "down" ? new Response("no", { status: 500 }) : new Response("ok");
    return new Response("unexpected", { status: 599 });
  }) as typeof fetch;
}
const SECRET_RPC = "https://secret-rpc.example/KEY-abc123";
const AI = { run: async () => ({}) };
const full = (extra: Record<string, unknown> = {}) => ({ RPC_URL: SECRET_RPC, AI, ...extra });

test("status: everything in place is ok, with the block number and the signer address only", async () => {
  const key = generatePrivateKey();
  const s = setup({ env: full({ REINKEEP_SIGNER_KEY: key }), facilitator: statusFetch() });
  const r = await s.send("GET", "/api/status");
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.deepEqual(Object.keys(r.data.checks), ["signer", "d1", "chainRpc", "payments", "ai", "freeTier"]);
  for (const c of Object.values<any>(r.data.checks)) {
    assert.equal(c.ok, true);
    assert.equal(typeof c.detail, "string");
  }
  assert.ok(r.data.checks.signer.detail.includes(privateKeyToAccount(key).address));
  assert.ok(r.data.checks.chainRpc.detail.includes("436"));
  assert.equal(new Date(r.data.checkedAt).toISOString(), r.data.checkedAt);
});

test("status: never contains the RPC URL, the API key, the private key or the facilitator address (JSON and HTML)", async () => {
  const key = generatePrivateKey();
  for (const rpc of ["ok", "error"] as const) {
    const s = setup({ env: full({ REINKEEP_SIGNER_KEY: key }), facilitator: statusFetch({ rpc }) });
    for (const path of ["/api/status", "/status"]) {
      const r = await s.send("GET", path);
      for (const secret of [SECRET_RPC, "secret-rpc", "KEY-abc123", "secret-key-123", key, key.slice(2), "facilitator.priors", "https://"]) {
        assert.ok(!r.text.includes(secret), `${path} (rpc ${rpc}) leaked ${secret}`);
      }
    }
  }
});

test("status: HTML page mirrors the JSON, and a failing critical check is a 503 with ok false", async () => {
  const s = setup({ env: full(), facilitator: statusFetch({ rpc: "error" }) });
  const json = await s.send("GET", "/api/status");
  const html = await quietly(() => s.send("GET", "/status"));
  assert.equal(json.status, 503);
  assert.equal(json.data.ok, false);
  assert.equal(json.data.checks.chainRpc.ok, false);
  assert.equal(json.data.checks.chainRpc.detail, "check failed");
  assert.equal(json.data.checks.d1.ok, true);
  assert.equal(html.status, 503);
  assert.match(html.text, /^<!doctype html>/);
  assert.match(html.text, /Chain RPC/);
  assert.match(html.text, /DOWN/);
  assert.equal((await s.send("POST", "/api/status", { b: {} })).status, 404); // only GET is status
});

test("status: a node that never answers is cut off after about 3 seconds, and the other checks still report", async () => {
  const s = setup({ env: full(), facilitator: statusFetch({ rpc: "hang" }) });
  const t0 = Date.now();
  const r = await s.send("GET", "/api/status");
  const took = Date.now() - t0;
  assert.ok(took >= 2800 && took < 4500, `took ${took} ms`);
  assert.equal(r.data.checks.chainRpc.ok, false);
  assert.match(r.data.checks.chainRpc.detail, /no answer within 3 s/);
  assert.equal(r.data.checks.signer.ok, true);
  assert.equal(r.data.checks.d1.ok, true);
  assert.equal(r.data.ok, false);
});

test("status: a missing signer or a broken database is reported without error text; optional parts do not fail the whole", async () => {
  const noKey = setup({ env: full({ REINKEEP_SIGNER_KEY: undefined }), facilitator: statusFetch() });
  const a = await noKey.send("GET", "/api/status");
  assert.equal(a.status, 503); // answered even though the gate itself would say not_configured
  assert.equal(a.data.checks.signer.detail, "not set");
  assert.equal(a.data.ok, false);

  const broken = setup({ env: full({ DB: { prepare: () => { throw new Error("db exploded: secret-detail"); } } }), facilitator: statusFetch() });
  const b = await broken.send("GET", "/api/status");
  assert.equal(b.data.checks.d1.ok, false);
  assert.ok(!b.text.includes("secret-detail"));

  // Payments, AI and the free tier are optional: all missing, still ok.
  const bare = setup({ env: full({ AI: undefined, FREE: undefined, X402_PAY_TO: undefined, PRIORS_API_KEY: undefined }), facilitator: statusFetch({ health: "down" }) });
  const c = await bare.send("GET", "/api/status");
  assert.equal(c.status, 200);
  assert.equal(c.data.ok, true);
  assert.equal(c.data.checks.payments.ok, false);
  assert.equal(c.data.checks.ai.ok, false);
  assert.equal(c.data.checks.freeTier.ok, false);
  assert.equal(c.data.checks.payments.critical, false);
});

// ---------------------------------------------------------------- MCP tools

test("MCP: check_token returns the verdict and get_receipt returns the stored receipt", async () => {
  const s = setup();
  const g = await s.gate();
  const mcp = async (name: string, args: unknown) =>
    (await s.send("POST", "/mcp", { b: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ip: "5.5.5.5" })).data.result;
  const t = await mcp("check_token", { address: RISKY });
  assert.equal(t.isError, undefined);
  assert.equal(t.structuredContent.decision, "BLOCK");
  assert.match(t.content[0].text, /^BLOCK \(token /);
  const r = await mcp("get_receipt", { id: g.data.id });
  assert.equal(r.structuredContent.valid, true);
  assert.equal(r.structuredContent.receipt.id, g.data.id);
  const missing = await mcp("get_receipt", { id: "rk_0000000000000000" });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /receipt_not_found/);
});
