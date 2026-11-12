// Free tier (25 gate calls per IP per UTC day) and x402 v2 pay-per-call, through the Cloudflare entry with fake Durable
// Object namespaces and a fake facilitator. No network.
import assert from "node:assert/strict";
import test from "node:test";
import { generatePrivateKey } from "viem/accounts";
import type { LedgerEntry } from "../engine/policy.ts";
import type { LedgerStorage } from "../api/src/gate-store.ts";
import { FreeTier } from "../api/src/metering.ts";
import { fromBase64, toBase64 } from "../api/src/x402.ts";
import { makeWorker, PayerLedger } from "../api/src/worker.ts";
import { PAYER, USDG, goodRequest, knownPolicy, withProof } from "./api-fixture.ts";

const OWNER = "0x1111111111111111111111111111111111111111";
const body = (over: Record<string, unknown> = {}) => ({ request: goodRequest(), policy: knownPolicy, ...over });

const payload = (accepted: Record<string, unknown> = {}) => ({
  x402Version: 2,
  accepted: { scheme: "exact", network: "eip155:4663", asset: USDG, amount: "10000", payTo: OWNER, maxTimeoutSeconds: 60, extra: { name: "Global Dollar", version: "1" }, ...accepted },
  payload: { signature: "0xsig", authorization: {} },
});

type Fac = { verifyBody?: any; settleBody?: any; verifyStatus?: number; settleQueue?: any[]; sleeps: number[]; calls: string[]; auth: string[]; bodies: any[]; down: boolean };

function setup(config: Record<string, unknown> = { X402_PAY_TO: OWNER, PRIORS_API_KEY: "secret-key-123" }) {
  const free = new Map<string, Map<string, any>>();
  const freeInst = new Map<string, FreeTier>();
  const payerStore = new Map<string, Map<string, LedgerEntry[]>>();
  const fac: Fac = { calls: [], auth: [], bodies: [], sleeps: [], down: false };
  const facilitatorFetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    fac.calls.push(path);
    fac.auth.push(String((init.headers as Record<string, string>).authorization));
    fac.bodies.push(JSON.parse(String(init.body)));
    if (fac.down) throw new Error("connect ECONNREFUSED secret-upstream-text");
    const queued = path === "/settle" ? fac.settleQueue?.shift() : undefined;
    const data = path === "/verify" ? (fac.verifyBody ?? { isValid: true, payer: PAYER }) : (queued ?? fac.settleBody ?? { success: true, transaction: "0xabc", network: "eip155:4663", payer: PAYER });
    return new Response(JSON.stringify(data), { status: path === "/verify" ? (fac.verifyStatus ?? 200) : 200 });
  }) as unknown as typeof fetch;
  const worker = makeWorker(facilitatorFetch, async (ms) => void fac.sleeps.push(ms));
  const env: any = { REINKEEP_SIGNER_KEY: generatePrivateKey(), ...config };
  const storage = (m: Map<string, any>) => ({ get: async (k: string) => m.get(k), put: async (k: string, v: any) => void m.set(k, structuredClone(v)) });
  env.FREE = {
    idFromName: (n: string) => n,
    get: (id: string) => ({
      fetch: (req: Request) => {
        if (!free.has(id)) free.set(id, new Map());
        if (!freeInst.has(id)) freeInst.set(id, new FreeTier({ storage: storage(free.get(id)!) }));
        return freeInst.get(id)!.fetch(req);
      },
    }),
  };
  env.PAYER = {
    idFromName: (n: string) => n,
    get: (id: string) => ({
      fetch: (req: Request) => {
        if (!payerStore.has(id)) payerStore.set(id, new Map());
        const st = payerStore.get(id)!;
        return new PayerLedger({ storage: { get: async (k: string) => st.get(k), put: async (k: string, v: LedgerEntry[]) => void st.set(k, structuredClone(v)) } as LedgerStorage }, env).fetch(req);
      },
    }),
  };
  const send = async (path: string, over: { ip?: string; b?: unknown; sig?: unknown; method?: string; headers?: Record<string, string> } = {}) => {
    // A test payer in the body signs it with the real clock, which the worker judges by.
    if (over.b && typeof over.b === "object") over = { ...over, b: await withProof(over.b as Record<string, any>, Date.now()) };
    const headers: Record<string, string> = { "content-type": "application/json", ...over.headers };
    if (over.ip) headers["cf-connecting-ip"] = over.ip;
    if (over.sig !== undefined) headers["payment-signature"] = typeof over.sig === "string" ? over.sig : toBase64(over.sig);
    const method = over.method ?? "POST";
    const res = await worker.fetch(new Request("https://gate.test" + path, { method, headers, body: method === "POST" ? JSON.stringify(over.b ?? body()) : undefined }), env);
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, data: text ? (JSON.parse(text) as any) : undefined };
  };
  return { env, fac, send, restart: () => freeInst.clear() };
}

const use25 = async (s: ReturnType<typeof setup>, ip = "1.1.1.1") => {
  for (let i = 0; i < 25; i++) assert.equal((await s.send("/api/v1/gate", { ip })).status, 200);
};

test("free calls 1..25 pass with a falling x-free-calls-left", async () => {
  const s = setup();
  for (let i = 1; i <= 25; i++) {
    const r = await s.send("/api/v1/gate", { ip: "1.1.1.1" });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-free-calls-left"), String(25 - i));
  }
  assert.equal(s.fac.calls.length, 0);
});

test("the 26th call is 402 with a valid body and the same JSON base64 in PAYMENT-REQUIRED", async () => {
  const s = setup();
  await use25(s);
  const r = await s.send("/api/v1/gate", { ip: "1.1.1.1" });
  assert.equal(r.status, 402);
  assert.equal(r.data.x402Version, 2);
  assert.deepEqual(r.data.accepts, [{ scheme: "exact", network: "eip155:4663", amount: "10000", asset: USDG, payTo: OWNER, maxTimeoutSeconds: 60, extra: { name: "Global Dollar", version: "1" } }]);
  assert.equal(r.data.resource.mimeType, "application/json");
  assert.match(r.data.resource.url, /\/api\/v1\/gate$/);
  assert.equal(typeof r.data.error, "string");
  assert.deepEqual(fromBase64(r.headers.get("payment-required")!), r.data);
});

test("different IPs have separate counters; no IP header is one shared 'unknown' caller", async () => {
  const s = setup();
  await use25(s, "1.1.1.1");
  assert.equal((await s.send("/api/v1/gate", { ip: "1.1.1.1" })).status, 402);
  const other = await s.send("/api/v1/gate", { ip: "2.2.2.2" });
  assert.equal(other.status, 200);
  assert.equal(other.headers.get("x-free-calls-left"), "24");
  await s.send("/api/v1/gate");
  const again = await s.send("/api/v1/gate");
  assert.equal(again.headers.get("x-free-calls-left"), "23");
  // The payer field does not buy a fresh counter.
  const p = await s.send("/api/v1/gate", { ip: "1.1.1.1", b: body({ payer: PAYER }) });
  assert.equal(p.status, 402);
});

test("the counter survives a Durable Object restart", async () => {
  const s = setup();
  await use25(s);
  s.restart();
  assert.equal((await s.send("/api/v1/gate", { ip: "1.1.1.1" })).status, 402);
});

test("a failed gate call (400) does not use up a free call", async () => {
  const s = setup();
  const bad = await s.send("/api/v1/gate", { ip: "1.1.1.1", b: { request: {} } });
  assert.equal(bad.status, 400);
  const ok = await s.send("/api/v1/gate", { ip: "1.1.1.1" });
  assert.equal(ok.headers.get("x-free-calls-left"), "24");
});

test("the counter starts again on a new UTC day", async () => {
  const s = setup();
  const real = Date.now;
  try {
    Date.now = () => Date.UTC(2026, 10, 11, 12);
    await use25(s);
    assert.equal((await s.send("/api/v1/gate", { ip: "1.1.1.1" })).status, 402);
    Date.now = () => Date.UTC(2026, 10, 12, 0, 0, 1);
    assert.equal((await s.send("/api/v1/gate", { ip: "1.1.1.1" })).status, 200);
  } finally {
    Date.now = real;
  }
});

test("presets, receipts and pricing stay free and unmetered", async () => {
  const s = setup();
  await use25(s);
  assert.equal((await s.send("/api/v1/gate/presets", { ip: "1.1.1.1", method: "GET" })).status, 200);
  assert.equal((await s.send("/api/v1/receipts/signer", { ip: "1.1.1.1", method: "GET" })).status, 200);
  assert.equal((await s.send("/api/v1/gate/pricing", { ip: "1.1.1.1", method: "GET" })).status, 200);
});

test("/gate/x402 is 402 without payment even with free calls left", async () => {
  const s = setup();
  const r = await s.send("/api/v1/gate/x402", { ip: "9.9.9.9" });
  assert.equal(r.status, 402);
  assert.equal(r.headers.get("x-free-calls-left"), null);
  assert.ok(r.headers.get("payment-required"));
  assert.match(r.data.resource.url, /\/gate\/x402$/);
});

test("a valid payment: verify, then the gate, then settle; 200 with PAYMENT-RESPONSE", async () => {
  const s = setup();
  const r = await s.send("/api/v1/gate/x402", { sig: payload() });
  assert.equal(r.status, 200);
  assert.equal(r.data.decision, "ALLOW");
  assert.deepEqual(s.fac.calls, ["/verify", "/settle"]);
  assert.equal(s.fac.auth[0], "Bearer secret-key-123");
  assert.equal(s.fac.bodies[0].x402Version, 2);
  assert.equal(s.fac.bodies[0].paymentRequirements.payTo, OWNER);
  assert.deepEqual(s.fac.bodies[0].paymentPayload, payload());
  assert.deepEqual(fromBase64(r.headers.get("payment-response")!), { success: true, transaction: "0xabc", network: "eip155:4663", payer: PAYER });
  assert.ok(!r.text.includes("secret-key-123"));
});

test("a payment also works past the free tier on /gate, and a payer still lands in its ledger", async () => {
  const s = setup();
  await use25(s);
  const r = await s.send("/api/v1/gate", { ip: "1.1.1.1", sig: payload(), b: body({ payer: PAYER }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.receipt.body.stateful, true);
  const dup = await s.send("/api/v1/gate/x402", { sig: payload(), b: body({ payer: PAYER }) });
  assert.equal(dup.data.decision, "BLOCK"); // the duplicate rule saw the first payment in the payer's ledger
});

test("verify says invalid: 402 with the reason, settle never called, no gate answer", async () => {
  const s = setup();
  s.fac.verifyBody = { isValid: false, invalidReason: "insufficient_funds" };
  const r = await s.send("/api/v1/gate/x402", { sig: payload() });
  assert.equal(r.status, 402);
  assert.match(r.data.error, /insufficient_funds/);
  assert.equal(r.data.decision, undefined);
  assert.deepEqual(s.fac.calls, ["/verify"]);
});

test("an invalid gate body with a valid payment is 400 and settle is never called", async () => {
  const s = setup();
  const r = await s.send("/api/v1/gate/x402", { sig: payload(), b: { request: {} } });
  assert.equal(r.status, 400);
  assert.deepEqual(s.fac.calls, ["/verify"]);
  assert.equal(r.headers.get("payment-response"), null);
});

test("settle fails: 402 and no gate answer", async () => {
  const s = setup();
  s.fac.settleBody = { success: false, errorReason: "nonce_used" };
  const r = await s.send("/api/v1/gate/x402", { sig: payload() });
  assert.equal(r.status, 402);
  assert.match(r.data.error, /nonce_used/);
  assert.equal(r.data.decision, undefined);
  assert.equal(r.data.receipt, undefined);
});

test("a payload that accepted other terms is 402 and the facilitator is not called", async () => {
  const s = setup();
  for (const accepted of [{ amount: "1" }, { payTo: "0x2222222222222222222222222222222222222222" }, { asset: "0x0000000000000000000000000000000000000009" }, { network: "eip155:1" }, { scheme: "upto" }]) {
    const r = await s.send("/api/v1/gate/x402", { sig: payload(accepted) });
    assert.equal(r.status, 402, JSON.stringify(accepted));
  }
  assert.equal((await s.send("/api/v1/gate/x402", { sig: "not-base64-json!" })).status, 402);
  assert.equal(s.fac.calls.length, 0);
});

test("the facilitator being down is 502 payment_unavailable, with no upstream text", async () => {
  const s = setup();
  s.fac.down = true;
  const r = await s.send("/api/v1/gate/x402", { sig: payload() });
  assert.equal(r.status, 502);
  assert.equal(r.data.error.code, "payment_unavailable");
  assert.ok(!r.text.includes("secret-upstream-text") && !r.text.includes("secret-key-123"));
});

test("missing config: free tier works, past it 503 payment_not_configured (never an empty payTo)", async () => {
  for (const config of [{}, { X402_PAY_TO: OWNER }, { PRIORS_API_KEY: "secret-key-123" }, { X402_PAY_TO: "nope", PRIORS_API_KEY: "secret-key-123" }]) {
    const s = setup(config);
    await use25(s);
    const r = await s.send("/api/v1/gate", { ip: "1.1.1.1" });
    assert.equal(r.status, 503);
    assert.equal(r.data.error.code, "payment_not_configured");
    assert.equal((await s.send("/api/v1/gate/x402")).status, 503);
  }
});

test("GET /gate/pricing", async () => {
  const s = setup();
  const r = await s.send("/api/v1/gate/pricing", { method: "GET" });
  assert.deepEqual(r.data, { freeCallsPerDay: 25, priceUsd: 0.01, amount: "10000", asset: USDG, network: "eip155:4663", payTo: OWNER, facilitator: "https://facilitator.priors.trade", holder: null, tokenBurn: null });
  const bare = setup({});
  const n = await bare.send("/api/v1/gate/pricing", { method: "GET" });
  assert.equal(n.data.payTo, null);
  const custom = setup({ X402_PAY_TO: OWNER, FACILITATOR_URL: "https://fac.example" });
  assert.equal((await custom.send("/api/v1/gate/pricing", { method: "GET" })).data.facilitator, "https://fac.example");
});

test("settlement_pending then success: same payload re-sent, 200 with PAYMENT-RESPONSE", async () => {
  const s = setup();
  s.fac.settleQueue = [{ success: false, errorReason: "settlement_pending", transaction: "0xabc", network: "eip155:4663" }, { success: true, transaction: "0xabc", network: "eip155:4663", payer: PAYER }];
  const r = await s.send("/api/v1/gate/x402", { sig: payload() });
  assert.equal(r.status, 200);
  assert.deepEqual(s.fac.calls, ["/verify", "/settle", "/settle"]);
  assert.deepEqual(s.fac.bodies[1], s.fac.bodies[2]);
  assert.equal(s.fac.sleeps.length, 1);
  assert.equal((fromBase64(r.headers.get("payment-response")!) as { success: boolean }).success, true);
});

test("settlement_pending that never clears: waits stay under 5 s, 402 saying pending, no gate answer", async () => {
  const s = setup();
  s.fac.settleBody = { success: false, errorReason: "settlement_pending", transaction: "0xabc", network: "eip155:4663" };
  const r = await s.send("/api/v1/gate/x402", { sig: payload() });
  assert.equal(r.status, 402);
  assert.match(r.data.error, /pending/);
  assert.equal(r.data.receipt, undefined);
  assert.ok(s.fac.sleeps.reduce((a, b) => a + b, 0) <= 5000);
  assert.equal(s.fac.calls.filter((c) => c === "/settle").length, 4);
});

test("a 4xx from the facilitator with a structured body is a refusal (402), not an outage", async () => {
  const s = setup();
  s.fac.verifyBody = { isValid: false, invalidReason: "invalid_exact_evm_payload_signature" };
  s.fac.verifyStatus = 400;
  const r = await s.send("/api/v1/gate/x402", { sig: payload() });
  assert.equal(r.status, 402);
  assert.match(r.data.error, /signature/);
  s.fac.verifyBody = { error: "unauthorized" };
  s.fac.verifyStatus = 401;
  assert.equal((await s.send("/api/v1/gate/x402", { sig: payload() })).status, 502);
});

test("the requirements sent to the facilitator are exactly the accepts[] entry we issued", async () => {
  const s = setup();
  const issued = (await s.send("/api/v1/gate/x402")).data.accepts[0];
  await s.send("/api/v1/gate/x402", { sig: payload() });
  assert.deepEqual(s.fac.bodies[0].paymentRequirements, issued);
  assert.equal((await s.send("/api/v1/gate/x402", { sig: payload({ maxTimeoutSeconds: 600 }) })).status, 402);
  assert.equal((await s.send("/api/v1/gate/x402", { sig: payload({ extra: { name: "Other", version: "1" } }) })).status, 402);
});
