import test from "node:test";
import assert from "node:assert/strict";
import { recoverTypedDataAddress } from "viem";
import { goodRequest, knownPolicy, makeApp, T0 } from "./api-fixture.ts";

async function signedReceipt(app = makeApp(), over: Record<string, unknown> = {}) {
  const r = await app.gate(goodRequest(over), { policy: knownPolicy });
  assert.equal(r.status, 200);
  return { app, receipt: r.data.receipt as any, reply: r.data };
}
const verify = (app: ReturnType<typeof makeApp>, receipt: unknown) => app.send("POST", "/api/v1/receipts/verify", { receipt });
const clone = (o: unknown) => JSON.parse(JSON.stringify(o));

test("a receipt can be re-checked by a stranger using ONLY the public signer info", async () => {
  const { app, receipt } = await signedReceipt();
  const info = (await app.send("GET", "/api/v1/receipts/signer")).data;
  const recovered = await recoverTypedDataAddress({
    domain: info.domain,
    types: info.types,
    primaryType: info.primaryType,
    message: { id: receipt.id, decision: receipt.decision, policyHash: receipt.policyHash, bodyHash: receipt.bodyHash, issuedAt: BigInt(receipt.issuedAt) },
    signature: receipt.signature,
  });
  assert.equal(recovered, info.signer);
  assert.equal(info.domain.chainId, 4663);
  assert.equal(info.domain.name, "Reinkeep");
});

test("the verify endpoint accepts a genuine receipt", async () => {
  const { app, receipt } = await signedReceipt();
  const v = await verify(app, receipt);
  assert.equal(v.status, 200);
  assert.deepEqual(v.data, { valid: true, signer: app.account.address });
});

test("the receipt carries what it needs to be re-checked, and nothing it should not", async () => {
  const { receipt } = await signedReceipt();
  assert.match(receipt.id, /^rk_[0-9a-f]{16}$/);
  assert.match(receipt.policyHash, /^0x[0-9a-f]{64}$/);
  assert.match(receipt.bodyHash, /^0x[0-9a-f]{64}$/);
  assert.equal(receipt.issuedAt, Math.floor(T0 / 1000), "time comes from the server clock, in seconds");
  assert.equal(receipt.body.engine, "rules-v2");
  assert.equal("now" in receipt.body.request, false);
  assert.equal("buying" in receipt.body, false, "no token named, so no token section at all");
  assert.deepEqual(receipt.body.reasons, []);
  assert.equal(receipt.policy.perPaymentUsd, 0.1);
});

test("same request, same time: same body hash and same id; different request: different id", async () => {
  const app = makeApp();
  const a = (await signedReceipt(app)).receipt;
  const b = (await signedReceipt(app)).receipt;
  const c = (await signedReceipt(app, { amount: "20000", quotedAmount: "20000" })).receipt;
  assert.equal(a.bodyHash, b.bodyHash);
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
});

test("the policy hash follows the policy", async () => {
  const app = makeApp();
  const a = await app.gate(goodRequest(), { policy: knownPolicy });
  const b = await app.gate(goodRequest(), { policy: { ...knownPolicy, perPaymentUsd: 0.5 } });
  assert.notEqual(a.data.receipt.policyHash, b.data.receipt.policyHash);
});

test("TAMPER: flipping BLOCK to ALLOW is caught", async () => {
  const { app, receipt } = await signedReceipt(makeApp(), { amount: "900000", quotedAmount: "900000" });
  assert.equal(receipt.decision, "BLOCK");
  const forged = clone(receipt);
  forged.decision = "ALLOW";
  const v = (await verify(app, forged)).data;
  assert.equal(v.valid, false);
  assert.match(v.reason, /^(signer_mismatch|bad_signature)$/);
});

test("TAMPER: changing the amount inside the body is caught", async () => {
  const { app, receipt } = await signedReceipt();
  const forged = clone(receipt);
  forged.body.request.amount = "1";
  assert.deepEqual((await verify(app, forged)).data, { valid: false, reason: "body_hash_mismatch" });
});

test("TAMPER: removing a reason from the body is caught", async () => {
  const { app, receipt } = await signedReceipt(makeApp(), { network: "eip155:1" });
  assert.ok(receipt.body.reasons.length > 0);
  const forged = clone(receipt);
  forged.body.reasons = [];
  assert.deepEqual((await verify(app, forged)).data, { valid: false, reason: "body_hash_mismatch" });
});

test("TAMPER: loosening the policy afterwards is caught", async () => {
  const { app, receipt } = await signedReceipt();
  const forged = clone(receipt);
  forged.policy.perPaymentUsd = 1000;
  assert.deepEqual((await verify(app, forged)).data, { valid: false, reason: "policy_hash_mismatch" });
});

test("TAMPER: id, time and signer fields cannot be swapped", async () => {
  const { app, receipt } = await signedReceipt();
  const id = clone(receipt);
  id.id = "rk_0000000000000000";
  assert.deepEqual((await verify(app, id)).data, { valid: false, reason: "id_mismatch" });

  const time = clone(receipt);
  time.issuedAt += 1;
  assert.equal((await verify(app, time)).data.valid, false);

  const signer = clone(receipt);
  signer.signer = "0x0000000000000000000000000000000000000001";
  assert.deepEqual((await verify(app, signer)).data, { valid: false, reason: "signer_mismatch" });
});

test("a receipt that is internally perfect but signed by someone else is 'not ours'", async () => {
  const { receipt } = await signedReceipt(makeApp());
  const other = makeApp();
  assert.deepEqual((await verify(other, receipt)).data, { valid: false, reason: "not_our_signature" });
});

test("garbage in the verify endpoint never throws and never says valid", async () => {
  const { app, receipt } = await signedReceipt();
  for (const bad of ["x", 5, null, [], {}, { ...receipt, signature: "0x12" }, { ...receipt, signature: 7 }, { ...receipt, decision: "MAYBE" }, { ...receipt, issuedAt: -1 }, { ...receipt, bodyHash: "0x12" }, { ...receipt, body: null }]) {
    const v = await verify(app, bad);
    assert.equal(v.status, 200, JSON.stringify(bad)?.slice(0, 60));
    assert.equal(v.data.valid, false);
  }
  assert.equal((await app.send("POST", "/api/v1/receipts/verify", {})).data.error.code, "missing_receipt");
});

test("receipts stay valid as time passes (they record a moment, they do not expire)", async () => {
  const { app, receipt } = await signedReceipt();
  app.clock.now += 365 * 86_400_000;
  assert.equal((await verify(app, receipt)).data.valid, true);
});
