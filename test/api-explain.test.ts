// The AI note on gate answers: used when clean, dropped (rules text instead) when not, never touches the receipt.
import assert from "node:assert/strict";
import { test } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { aiExplainer, checkExplanation, EXPLAIN_MODEL, EXPLAIN_TIMEOUT_MS, type AiRunner } from "../api/src/explain.ts";
import { createHandler } from "../api/src/http-handler.ts";
import { MemoryGateStore } from "../api/src/gate-store.ts";
import type { GateDeps } from "../api/src/gate-service.ts";
import { T0, goodRequest, knownPolicy } from "./api-fixture.ts";

const account = privateKeyToAccount(generatePrivateKey());
const fake = (run: AiRunner["run"]): AiRunner => ({ run });
const says = (response: unknown) => fake(async () => ({ response }));

function app(extra: Partial<GateDeps> = {}) {
  const handle = createHandler({ account, now: () => T0, store: new MemoryGateStore(), ...extra });
  return async (body: unknown) => {
    const res = await handle(new Request("http://gate.test/api/v1/gate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { status: res.status, data: (await res.json()) as any };
  };
}
const allow = { request: goodRequest(), policy: knownPolicy };
const withAi = (ai: AiRunner, timeoutMs?: number) => app({ explain: aiExplainer(ai, { timeoutMs }) });

test("clean AI text is used and labelled with the model", async () => {
  const r = await withAi(says("The payment is small and goes to a recipient you already approved."))(allow);
  assert.equal(r.data.decision, "ALLOW");
  assert.deepEqual(r.data.explanation, { text: "The payment is small and goes to a recipient you already approved.", source: "ai", model: EXPLAIN_MODEL });
});

test("the model gets only the facts, and the amount in plain units", async () => {
  let seen = "";
  await withAi(fake(async (_m, o) => ((seen = o.messages.map((m) => m.content).join("\n")), { response: "Fine." })))(allow);
  assert.match(seen, /Decision: ALLOW/);
  assert.match(seen, /Payment amount: 0\.01/);
  assert.doesNotMatch(seen, new RegExp(goodRequest().payTo));
});

test("a number that is not in the facts drops the AI text", async () => {
  const r = await withAi(says("This is a 99 dollar payment that looks fine."))(allow);
  assert.equal(r.data.explanation.source, "rules");
  assert.equal(r.data.explanation.model, undefined);
  assert.doesNotMatch(r.data.explanation.text, /99/);
});

test("a number that is in the facts is fine", async () => {
  const r = await withAi(says("A payment of 0.01 to a known recipient."))(allow);
  assert.equal(r.data.explanation.source, "ai");
});

test("advice words drop the AI text", async () => {
  for (const bad of ["You should buy this token.", "It is safe to proceed.", "This is a great invest chance.", "We guarantee it works."]) {
    const r = await withAi(says(bad))(allow);
    assert.equal(r.data.explanation.source, "rules", bad);
  }
});

test("empty, non-string and over-long text drop the AI text", async () => {
  for (const bad of ["", "   ", 42, null, "a".repeat(321)]) {
    const r = await withAi(says(bad))(allow);
    assert.equal(r.data.explanation.source, "rules", String(bad));
  }
  assert.equal((await withAi(says("a".repeat(320)))(allow)).data.explanation.source, "ai");
});

test("a slow model falls back at the timeout, and the call still answers", async () => {
  const slow = fake(() => new Promise(() => {})); // never resolves
  const t = Date.now();
  const r = await withAi(slow, 100)(allow);
  assert.ok(Date.now() - t < 1000);
  assert.equal(r.status, 200);
  assert.equal(r.data.explanation.source, "rules");
});

test("default timeout: a model that never answers is dropped after EXPLAIN_TIMEOUT_MS", async () => {
  // The limit itself is checked exactly; the wall clock only loosely, since a busy machine adds scheduling delay
  // (a 100 ms margin here used to fail now and then).
  assert.ok(EXPLAIN_TIMEOUT_MS <= 2500);
  const t = Date.now();
  const r = await app({ explain: aiExplainer(fake(() => new Promise(() => {}))) })(allow);
  assert.ok(Date.now() - t < EXPLAIN_TIMEOUT_MS + 1500);
  assert.equal(r.data.explanation.source, "rules");
});

test("a thrown error falls back", async () => {
  const r = await withAi(fake(async () => { throw new Error("model down"); }))(allow);
  assert.equal(r.status, 200);
  assert.equal(r.data.explanation.source, "rules");
});

test("an explain dep that throws still gives the rules text", async () => {
  const r = await app({ explain: async () => { throw new Error("boom"); } })(allow);
  assert.equal(r.status, 200);
  assert.equal(r.data.explanation.source, "rules");
});

test("no AI binding: rules text, field always present", async () => {
  const r = await app()(allow);
  assert.equal(r.data.explanation.source, "rules");
  assert.ok(r.data.explanation.text.length > 0);
});

test("explanation is present on ALLOW, REVIEW and BLOCK, and the decision is not the AI's", async () => {
  const ai = says("Nothing here changes the outcome.");
  const run = withAi(ai);
  const a = await run(allow);
  const rv = await run({ request: goodRequest(), policy: {} }); // unknown recipient -> REVIEW
  const b = await run({ request: goodRequest({ network: "eip155:1" }), policy: knownPolicy });
  assert.deepEqual([a.data.decision, rv.data.decision, b.data.decision], ["ALLOW", "REVIEW", "BLOCK"]);
  for (const x of [a, rv, b]) assert.equal(x.data.explanation.source, "ai");
  // rules text names the reasons
  const plain = await app()({ request: goodRequest({ network: "eip155:1" }), policy: knownPolicy });
  assert.match(plain.data.explanation.text, /^Blocked\. /);
  assert.ok(plain.data.reasons.length > 0 && plain.data.explanation.text.includes(plain.data.reasons[0].plain));
});

test("a checked token adds its facts to the prompt", async () => {
  let seen = "";
  const ai = fake(async (_m, o) => ((seen = o.messages[1]!.content), { response: "Okay." }));
  const sheet = { is_contract: true, is_proxy: false, has_pause: false, has_blacklist: false, has_upgrade: false, mint_with_live_owner: true, seen_liquidity_usd: 250, ticker_clone_of_older: null };
  await app({ explain: aiExplainer(ai), tokenFacts: async () => sheet })({ ...allow, token: "0x00000000000000000000000000000000000000b2" });
  assert.match(seen, /mint_with_live_owner: true/);
  assert.match(seen, /seen_liquidity_usd: 250/);
  assert.match(seen, /ticker_clone_of_older: unknown/);
});

test("the receipt is identical with and without the note, and still verifies", async () => {
  const plain = await app()(allow);
  const noisy = await withAi(says("A note."))(allow);
  assert.deepEqual(noisy.data.receipt, plain.data.receipt);
  assert.equal(noisy.data.id, plain.data.id);
  assert.equal("explanation" in noisy.data.receipt, false);
  const handle = createHandler({ account, now: () => T0 });
  const res = await handle(new Request("http://gate.test/api/v1/receipts/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ receipt: noisy.data.receipt }) }));
  const v = (await res.json()) as any;
  assert.equal(v.valid, true);
});

test("text that says the payment already happened is dropped (it is a check before paying)", async () => {
  for (const bad of ["The payment was successful.", "The payment has been reviewed and is fine.", "Your payment went through.", "The payment was sent to the recipient."]) {
    const r = await withAi(says(bad))(allow);
    assert.equal(r.data.explanation.source, "rules", bad);
  }
});

test("opinions about the size of the amount are dropped", async () => {
  const r = await withAi(says("The amount of the payment is very small."))(allow);
  assert.equal(r.data.explanation.source, "rules");
});

test("the model is told what the decision means and that nothing is paid yet", async () => {
  let seen = "";
  await withAi(fake(async (_m, o) => ((seen = o.messages.map((m) => m.content).join("\n")), { response: "Fine." })))(allow);
  assert.match(seen, /Meaning: the agent may go ahead/);
  assert.match(seen, /Nothing has been paid yet/);
  assert.match(seen, /BEFORE any payment/);
});

test("an ALLOW with no reasons tells the model so (no invented reason)", async () => {
  let seen = "";
  await withAi(fake(async (_m, o) => ((seen = o.messages.map((m) => m.content).join("\n")), { response: "Fine." })))(allow);
  assert.match(seen, /Reasons: none\. Every rule passed\./);
});

test("buy/sell advice in any form is dropped (live: 'should not be bought')", async () => {
  for (const bad of ["This token should not be bought.", "You shouldn't buy it.", "Do not buy this token.", "It should be avoided."]) {
    const r = await withAi(says(bad))(allow);
    assert.equal(r.data.explanation.source, "rules", bad);
  }
});

test("a model that copies the input labels back is not used (seen live 2026-11-12)", () => {
  const facts = ["Decision: REVIEW", "Meaning: a person should look at this token before anyone buys it.", "Reason (token_facts_unknown): Some facts could not be read."];
  const echoed = "Decision: REVIEW Meaning: a person should look at this token before anyone buys it. Reason: Some facts a blocking rule needs could not be read, so a human decides.";
  assert.equal(checkExplanation(echoed, facts), null);
  assert.equal(checkExplanation("Reason (token_facts_unknown): Some facts could not be read.", facts), null);
  assert.equal(checkExplanation("A person should look at this token first. Some facts could not be read.", facts), "A person should look at this token first. Some facts could not be read.");
});
