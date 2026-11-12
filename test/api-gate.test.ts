import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultPolicy } from "../engine/policy.ts";
import { gate as gateService } from "../api/src/gate-service.ts";
import { goodRequest, knownPolicy, makeApp, PAYER, PAY_TO, T0 } from "./api-fixture.ts";

const codes = (r: { data: any }): string[] => r.data.reasons.map((x: any) => x.code);

test("small payment to a known recipient: ALLOW, no reasons", async () => {
  const app = makeApp();
  const r = await app.gate(goodRequest(), { policy: knownPolicy });
  assert.equal(r.status, 200);
  assert.equal(r.data.decision, "ALLOW");
  assert.deepEqual(r.data.reasons, []);
  assert.equal(r.data.receipt.signer, app.account.address);
});

test("first payment to an unknown recipient: REVIEW, with the reason in plain words", async () => {
  const r = await makeApp().gate(goodRequest());
  assert.equal(r.data.decision, "REVIEW");
  assert.deepEqual(codes(r), ["new_recipient"]);
  assert.match(r.data.reasons[0].plain, /First time paying this address/);
});

test("bigger than the cap: BLOCK over_payment_cap", async () => {
  const r = await makeApp().gate(goodRequest({ amount: "900000", quotedAmount: "900000" }), { policy: knownPolicy });
  assert.equal(r.data.decision, "BLOCK");
  assert.deepEqual(codes(r), ["over_payment_cap"]);
});

test("the injected-page scenario from the site: 0.90 USDG to a stranger is BLOCK", async () => {
  const stranger = "0x000000000000000000000000000000000000dEaD";
  const r = await makeApp().gate(goodRequest({ amount: "900000", quotedAmount: "900000", payTo: stranger }));
  assert.equal(r.data.decision, "BLOCK");
  assert.ok(codes(r).includes("over_payment_cap"));
});

test("wrong chain and wrong token: BLOCK, both named", async () => {
  const r = await makeApp().gate(goodRequest({ network: "eip155:1", asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }), { policy: knownPolicy });
  assert.equal(r.data.decision, "BLOCK");
  assert.deepEqual(codes(r).sort(), ["asset_not_allowed", "network_not_allowed"]);
});

test("plain http link, broken amount, wrong decimals, changed quote: each BLOCKs with its own reason", async () => {
  const app = makeApp();
  const cases: [Record<string, unknown>, string][] = [
    [{ resourceUrl: "http://api.example.com/x" }, "resource_not_https"],
    [{ amount: "1.5", quotedAmount: "1.5" }, "invalid_amount"],
    [{ decimals: 18 }, "unsupported_decimals"],
    [{ amount: "20000" }, "amount_changed"],
    [{ validForSeconds: 600 }, "validity_too_long"],
  ];
  for (const [over, code] of cases) {
    const r = await app.gate(goodRequest(over), { policy: knownPolicy });
    assert.equal(r.data.decision, "BLOCK", code);
    assert.ok(codes(r).includes(code), `${code} in ${codes(r)}`);
  }
});

test("a human-review threshold is a REVIEW, not a BLOCK", async () => {
  const r = await makeApp().gate(goodRequest({ amount: "60000", quotedAmount: "60000" }), { policy: knownPolicy });
  assert.equal(r.data.decision, "REVIEW");
  assert.deepEqual(codes(r), ["above_approval_threshold"]);
});

test("a deny always beats a review", async () => {
  const r = await makeApp().gate(goodRequest({ amount: "900000", quotedAmount: "900000" })); // also a new recipient
  assert.equal(r.data.decision, "BLOCK");
});

test("every rule code the engine can return has a plain-words explanation", () => {
  const src = readFileSync(new URL("../engine/policy.ts", import.meta.url), "utf8");
  const engine = new Set([...src.matchAll(/(?:deny|approve)\.push\("([a-z_]+)"\)/g)].map((m) => m[1]).concat("invalid_amount"));
  const rules = JSON.parse(readFileSync(new URL("../site/data/rules.json", import.meta.url), "utf8")) as { code: string; plain: string }[];
  assert.deepEqual([...engine].sort(), rules.map((r) => r.code).sort(), "engine codes and rules.json codes must match");
  assert.ok(rules.every((r) => r.plain.length > 10));
});

test("without a payer the gate is stateless and the receipt says so", async () => {
  const app = makeApp();
  const a = await app.gate(goodRequest(), { policy: knownPolicy });
  const b = await app.gate(goodRequest(), { policy: knownPolicy });
  assert.equal(a.data.receipt.body.stateful, false);
  assert.equal(b.data.decision, "ALLOW", "no history, so an identical repeat is not caught");
});

test("with a payer but no store configured, it is still stateless and says so", async () => {
  const app = makeApp({ store: null });
  const r = await app.gate(goodRequest(), { policy: knownPolicy, payer: PAYER });
  assert.equal(r.data.receipt.body.stateful, false);
});

test("with a payer the gate remembers: an identical repeat within 30s is a duplicate", async () => {
  const app = makeApp();
  const first = await app.gate(goodRequest(), { policy: knownPolicy, payer: PAYER });
  const second = await app.gate(goodRequest(), { policy: knownPolicy, payer: PAYER });
  assert.equal(first.data.decision, "ALLOW");
  assert.equal(first.data.receipt.body.stateful, true);
  assert.equal(second.data.decision, "BLOCK");
  assert.deepEqual(codes(second), ["duplicate_payment"]);
  const other = await app.gate(goodRequest(), { policy: knownPolicy, payer: "0x00000000000000000000000000000000000000b2" });
  assert.equal(other.data.decision, "ALLOW", "another payer has its own history");
});

test("a recipient paid before stops being new for that payer only", async () => {
  const app = makeApp();
  const first = await app.gate(goodRequest({ resourceUrl: "https://api.example.com/a" }), { payer: PAYER });
  assert.equal(first.data.decision, "REVIEW"); // new recipient, not recorded (only ALLOW is recorded)
  const approvedThenPaid = await app.gate(goodRequest({ resourceUrl: "https://api.example.com/a" }), { policy: knownPolicy, payer: PAYER });
  assert.equal(approvedThenPaid.data.decision, "ALLOW");
  app.clock.now += 60_000;
  const later = await app.gate(goodRequest({ resourceUrl: "https://api.example.com/b" }), { payer: PAYER });
  assert.equal(later.data.decision, "ALLOW", "the recipient is now in this payer's history");
});

test("daily cap adds up across calls and resets after a day", async () => {
  const app = makeApp();
  const policy = { allowPayTo: [PAY_TO], approveAboveUsd: 0.1, dailyUsd: 0.25 };
  const pay = (n: number) => app.gate(goodRequest({ amount: "90000", quotedAmount: "90000", resourceUrl: `https://api.example.com/${n}` }), { policy, payer: PAYER });
  assert.equal((await pay(1)).data.decision, "ALLOW");
  app.clock.now += 40_000;
  assert.equal((await pay(2)).data.decision, "ALLOW");
  app.clock.now += 40_000;
  const third = await pay(3);
  assert.equal(third.data.decision, "BLOCK");
  assert.deepEqual(codes(third), ["over_daily_cap"]);
  app.clock.now = T0 + 25 * 3_600_000;
  assert.equal((await pay(4)).data.decision, "ALLOW", "history older than a day no longer counts");
});

test("only an ALLOW is written to the history: a BLOCK or REVIEW does not use up the daily cap", async () => {
  const app = makeApp();
  const policy = { allowPayTo: [PAY_TO], approveAboveUsd: 0.1, dailyUsd: 0.25, maxPerMinute: 100 };
  const big = await app.gate(goodRequest({ amount: "900000", quotedAmount: "900000" }), { policy, payer: PAYER });
  assert.equal(big.data.decision, "BLOCK"); // $0.90 refused, so it must not count toward the $0.25 day
  const stranger = await app.gate(goodRequest({ payTo: "0x00000000000000000000000000000000000000c3", amount: "90000", quotedAmount: "90000" }), { policy, payer: PAYER });
  assert.equal(stranger.data.decision, "REVIEW"); // new recipient, held for a human, also not counted
  for (const n of [1, 2]) {
    const r = await app.gate(goodRequest({ amount: "90000", quotedAmount: "90000", resourceUrl: `https://api.example.com/${n}` }), { policy, payer: PAYER });
    assert.equal(r.data.decision, "ALLOW", `payment ${n} should still fit in the day`);
  }
});

test("rate limit: more than the per-minute maximum is a BLOCK", async () => {
  const app = makeApp();
  const policy = { allowPayTo: [PAY_TO], maxPerMinute: 2, dailyUsd: 100 };
  const pay = (n: number) => app.gate(goodRequest({ resourceUrl: `https://api.example.com/${n}` }), { policy, payer: PAYER });
  assert.equal((await pay(1)).data.decision, "ALLOW");
  assert.equal((await pay(2)).data.decision, "ALLOW");
  const third = await pay(3);
  assert.equal(third.data.decision, "BLOCK");
  assert.deepEqual(codes(third), ["rate_limit"]);
});

test("PARALLEL identical requests: exactly one is allowed (no check-then-record gap)", async () => {
  const app = makeApp();
  const results = await Promise.all(Array.from({ length: 8 }, () => app.gate(goodRequest(), { policy: knownPolicy, payer: PAYER })));
  const decisions = results.map((r) => r.data.decision);
  assert.equal(decisions.filter((d) => d === "ALLOW").length, 1, decisions.join(","));
  assert.equal(decisions.filter((d) => d === "BLOCK").length, 7);
  for (const r of results.filter((x) => x.data.decision === "BLOCK")) assert.deepEqual(codes(r), ["duplicate_payment"]);
});

test("PARALLEL requests that are different all get their own answer", async () => {
  const app = makeApp();
  const policy = { allowPayTo: [PAY_TO], maxPerMinute: 100, dailyUsd: 100 };
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => app.gate(goodRequest({ resourceUrl: `https://api.example.com/${i}` }), { policy, payer: PAYER })));
  assert.ok(results.every((r) => r.data.decision === "ALLOW"));
});

test("one payer's failure does not freeze that payer's next request", async () => {
  let calls = 0;
  const flaky = {
    async run(_p: string, _n: number, fn: (l: any) => unknown) {
      calls++;
      if (calls === 1) throw new Error("storage hiccup");
      return fn({ entries: [], add: () => {} });
    },
  };
  const app = makeApp({ store: flaky as any });
  const silence = console.error;
  console.error = () => {};
  try {
    assert.equal((await app.gate(goodRequest(), { policy: knownPolicy, payer: PAYER })).status, 500);
  } finally {
    console.error = silence;
  }
  assert.equal((await app.gate(goodRequest(), { policy: knownPolicy, payer: PAYER })).status, 200);
});

test("the service itself ignores a clock smuggled into the request (second layer behind validation)", async () => {
  const app = makeApp();
  const input = { request: { ...goodRequest(), now: 5 }, policy: defaultPolicy, policyName: "custom" };
  const result = await gateService(input as any, { account: app.account, now: () => T0 });
  assert.equal(result.receipt.issuedAt, Math.floor(T0 / 1000), "the receipt time is the server's, not the caller's");
});
