// The Cloudflare entry point with payer history: requests that name a payer go to that payer's Durable Object
// (PayerLedger), whose storage is the only place the history lives. Cloudflare's runtime is replaced by a small fake
// namespace (one PayerLedger per name, like idFromName) and an async storage, so the routing, the queue and the
// survival of the history across a restart are all exercised in Node.
import assert from "node:assert/strict";
import test from "node:test";
import { generatePrivateKey } from "viem/accounts";
import type { LedgerEntry } from "../engine/policy.ts";
import type { LedgerStorage } from "../api/src/gate-store.ts";
import worker, { PayerLedger } from "../api/src/worker.ts";
import { MAX_BODY_BYTES } from "../api/src/http-handler.ts";
import { PAYER, PAYER_B, PAY_TO, goodRequest, knownPolicy, withProof } from "./api-fixture.ts";

// Every read and write waits a tick, as real storage does, so requests really interleave.
function slowStorage(): LedgerStorage & { data: Map<string, LedgerEntry[]> } {
  const data = new Map<string, LedgerEntry[]>();
  const tick = () => new Promise((r) => setTimeout(r, 1));
  return {
    data,
    async get(k) {
      await tick();
      return data.get(k);
    },
    async put(k, v) {
      await tick();
      data.set(k, structuredClone(v));
    },
  };
}

function setup() {
  const storages = new Map<string, ReturnType<typeof slowStorage>>();
  const instances = new Map<string, PayerLedger>();
  const routed: string[] = [];
  const env: any = { REINKEEP_SIGNER_KEY: generatePrivateKey() };
  env.PAYER = {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: (req: Request) => {
        routed.push(id);
        if (!storages.has(id)) storages.set(id, slowStorage());
        if (!instances.has(id)) instances.set(id, new PayerLedger({ storage: storages.get(id)! }, env));
        return instances.get(id)!.fetch(req);
      },
    }),
  };
  // Cloudflare may evict an idle object; the next request builds a new one over the same storage.
  const restart = () => instances.clear();
  // The worker judges with the real clock, so the test payer signs with it too.
  const post = async (raw: unknown) => {
    const body = typeof raw === "object" && raw !== null ? await withProof(raw as Record<string, any>, Date.now()) : raw;
    const res = await worker.fetch(new Request("https://gate.test/api/v1/gate", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }), env);
    return { status: res.status, data: (await res.json()) as any };
  };
  return { env, storages, routed, restart, post };
}

const codes = (r: { data: any }) => r.data.reasons.map((x: { code: string }) => x.code);

test("a request with a payer goes to that payer's ledger and is remembered", async () => {
  const s = setup();
  const first = await s.post({ request: goodRequest(), policy: knownPolicy, payer: PAYER });
  assert.equal(first.data.decision, "ALLOW");
  assert.equal(first.data.receipt.body.stateful, true);
  const again = await s.post({ request: goodRequest(), policy: knownPolicy, payer: PAYER });
  assert.equal(again.data.decision, "BLOCK");
  assert.deepEqual(codes(again), ["duplicate_payment"]);
  assert.deepEqual(s.routed, [PAYER, PAYER]);
  assert.equal(s.storages.get(PAYER)!.data.get(PAYER)!.length, 1);
});

test("the payer address is matched without caring about upper or lower case", async () => {
  const s = setup();
  await s.post({ request: goodRequest(), policy: knownPolicy, payer: PAYER.toUpperCase().replace("0X", "0x") });
  const again = await s.post({ request: goodRequest(), policy: knownPolicy, payer: PAYER });
  assert.deepEqual(codes(again), ["duplicate_payment"]);
  assert.equal(new Set(s.routed).size, 1);
});

test("PARALLEL identical requests through the worker: exactly one is allowed", async () => {
  const s = setup();
  const results = await Promise.all(Array.from({ length: 8 }, () => s.post({ request: goodRequest(), policy: knownPolicy, payer: PAYER })));
  const decisions = results.map((r) => r.data.decision);
  assert.equal(decisions.filter((d) => d === "ALLOW").length, 1, decisions.join(","));
  assert.equal(decisions.filter((d) => d === "BLOCK").length, 7);
});

test("the history survives the object being restarted (it lives in storage, not in memory)", async () => {
  const s = setup();
  await s.post({ request: goodRequest(), policy: knownPolicy, payer: PAYER });
  s.restart();
  const again = await s.post({ request: goodRequest(), policy: knownPolicy, payer: PAYER });
  assert.deepEqual(codes(again), ["duplicate_payment"]);
});

test("payers do not share a history", async () => {
  const s = setup();
  const other = PAYER_B;
  await s.post({ request: goodRequest(), policy: knownPolicy, payer: PAYER });
  const b = await s.post({ request: goodRequest(), policy: knownPolicy, payer: other });
  assert.equal(b.data.decision, "ALLOW");
  assert.deepEqual([...s.storages.keys()].sort(), [PAYER, other].sort());
});

test("no payer: answered by the worker itself, stateless, nothing stored", async () => {
  const s = setup();
  const r = await s.post({ request: goodRequest(), policy: { allowPayTo: [PAY_TO] } });
  assert.equal(r.data.decision, "ALLOW");
  assert.equal(r.data.receipt.body.stateful, false);
  assert.equal(s.routed.length, 0);
});

test("a broken payer or broken JSON is not routed, and gets the normal error", async () => {
  const s = setup();
  const bad = await s.post({ request: goodRequest(), payer: "0x123" });
  assert.equal(bad.status, 400);
  const notJson = await s.post("{nope");
  assert.equal(notJson.status, 400);
  assert.equal(notJson.data.error.code, "invalid_json");
  assert.equal(s.routed.length, 0);
});

test("a body over the size limit is refused before any routing", async () => {
  const s = setup();
  const r = await s.post({ request: goodRequest(), payer: PAYER, pad: "x".repeat(MAX_BODY_BYTES) });
  assert.equal(r.status, 413);
  assert.equal(r.data.error.code, "body_too_large");
  assert.equal(s.routed.length, 0);
});

test("without the signer key the payer's object refuses too", async () => {
  const s = setup();
  delete s.env.REINKEEP_SIGNER_KEY;
  const r = await s.post({ request: goodRequest(), payer: PAYER });
  assert.equal(r.status, 503);
});
