import test from "node:test";
import assert from "node:assert/strict";
import { defaultPolicy } from "../engine/policy.ts";
import { goodRequest, makeApp, PAY_TO } from "./api-fixture.ts";

const app = makeApp();
const code = (r: { data: any }) => r.data?.error?.code;

test("a body that is not an object is refused", async () => {
  assert.equal(code(await app.send("POST", "/api/v1/gate", [])), "invalid_body");
  assert.equal(code(await app.send("POST", "/api/v1/gate", "5")), "invalid_body");
  assert.equal(code(await app.send("POST", "/api/v1/gate", "null")), "invalid_body");
});

test("missing request and unknown top-level fields are refused", async () => {
  assert.equal(code(await app.send("POST", "/api/v1/gate", {})), "missing_request");
  assert.equal(code(await app.send("POST", "/api/v1/gate", { request: goodRequest(), extra: 1 })), "unknown_field");
});

test("the caller cannot set the time: 'now' is not an accepted field", async () => {
  const r = await app.gate(goodRequest({ now: 1 }));
  assert.equal(r.status, 400);
  assert.equal(code(r), "unknown_request_field");
});

test("a recipient that is not an address cannot be judged and is refused", async () => {
  for (const payTo of ["0x123", "not-an-address", "0x" + "g".repeat(40), 5, null]) {
    const r = await app.gate(goodRequest({ payTo }));
    assert.equal(r.status, 400, String(payTo));
  }
  assert.equal(code(await app.gate(goodRequest({ payTo: "0x123" }))), "invalid_address");
});

test("wrong field types are refused with the field named", async () => {
  const r = await app.gate(goodRequest({ amount: 10000 }));
  assert.equal(r.status, 400);
  assert.match(r.data.error.message, /request\.amount must be a string/);
  assert.equal((await app.gate(goodRequest({ decimals: "6" }))).status, 400);
  assert.equal((await app.gate(goodRequest({ decimals: 6.5 }))).status, 400);
  assert.equal((await app.gate(goodRequest({ validForSeconds: -1 }))).status, 400);
  assert.equal((await app.gate(goodRequest({ resourceUrl: "https://a.co/" + "x".repeat(2100) }))).status, 400);
});

test("what the rules can judge is not refused: it becomes a BLOCK with a reason", async () => {
  const wrongChain = await app.gate(goodRequest({ network: "eip155:1" }));
  assert.equal(wrongChain.status, 200);
  assert.equal(wrongChain.data.decision, "BLOCK");
  const brokenUrl = await app.gate(goodRequest({ resourceUrl: "not a url" }));
  assert.equal(brokenUrl.status, 200);
  assert.ok(brokenUrl.data.reasons.some((x: any) => x.code === "resource_invalid"));
});

test("a typo in a policy field is an error, never a silent default", async () => {
  const r = await app.gate(goodRequest(), { policy: { perPayment: 5 } });
  assert.equal(r.status, 400);
  assert.equal(code(r), "unknown_policy_field");
  assert.match(r.data.error.message, /perPayment/);
});

test("preset names: known works, unknown is refused", async () => {
  assert.equal((await app.gate(goodRequest(), { policy: "reinkeep-default-v1" })).status, 200);
  assert.equal(code(await app.gate(goodRequest(), { policy: "nope-v9" })), "unknown_preset");
  assert.equal(code(await app.gate(goodRequest(), { policy: 5 })), "invalid_policy");
});

test("policy numbers are range-checked", async () => {
  for (const policy of [{ perPaymentUsd: -1 }, { dailyUsd: 1e9 }, { maxPerMinute: 1.5 }, { maxPerMinute: 0 }, { maxValiditySec: 99999 }, { perPaymentUsd: "5" }]) {
    assert.equal((await app.gate(goodRequest(), { policy })).status, 400, JSON.stringify(policy));
  }
});

test("policy lists are bounded and typed", async () => {
  assert.equal((await app.gate(goodRequest(), { policy: { allowPayTo: ["0x123"] } })).status, 400);
  assert.equal((await app.gate(goodRequest(), { policy: { allowPayTo: Array(101).fill(PAY_TO) } })).status, 400);
  assert.equal((await app.gate(goodRequest(), { policy: { allowHosts: ["bad host!"] } })).status, 400);
  assert.equal((await app.gate(goodRequest(), { policy: { hostCapsUsd: { "bad host!": 1 } } })).status, 400);
  assert.equal((await app.gate(goodRequest(), { policy: { networks: "eip155:4663" } })).status, 400);
});

test("a partial custom policy is filled in from the defaults, and named 'custom'", async () => {
  const r = await app.gate(goodRequest(), { policy: { allowPayTo: [PAY_TO], allowHosts: ["API.Example.COM"], hostCapsUsd: { "Api.Example.com": 0.5 } } });
  assert.equal(r.status, 200);
  const p = r.data.receipt.policy;
  assert.equal(r.data.receipt.body.policyName, "custom");
  assert.equal(p.perPaymentUsd, defaultPolicy.perPaymentUsd);
  assert.deepEqual(p.networks, defaultPolicy.networks);
  assert.deepEqual(p.allowHosts, ["api.example.com"]);
  assert.deepEqual(p.hostCapsUsd, { "api.example.com": 0.5 });
});

test("payer must be an address when given", async () => {
  assert.equal(code(await app.gate(goodRequest(), { payer: "bob" })), "invalid_address");
});
