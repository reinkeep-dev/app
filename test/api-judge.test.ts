// AI Judge (api/src/judge.ts): advisory second opinion on a REVIEW. Fake model runner, no network.
import assert from "node:assert/strict";
import test from "node:test";
import { JUDGE_MODEL, aiJudge, checkJudgement, type Judge } from "../api/src/judge.ts";
import type { ExplainInput } from "../api/src/explain.ts";
import { sharePage } from "../api/src/share-page.ts";
import { goodRequest, knownPolicy, makeApp } from "./api-fixture.ts";

const TOKEN = "0x" + "c".repeat(40);
const input: ExplainInput = {
  decision: "REVIEW",
  reasons: [{ code: "token_upgradeable", plain: "The token can be upgraded." }],
  token: { token: TOKEN, facts: { isProxy: true, hasMint: false, liquidityUsd: 2500 } as any },
};
const good = { lean: "BLOCK", confidence: 0.82, cites: ["token_upgradeable", "isProxy"], note: "An upgradeable token can change its rules later." };

test("checkJudgement keeps a clean answer and rejects anything off the schema or the facts", () => {
  assert.deepEqual(checkJudgement(good, input, "m"), { ...good, model: "m", advisory: true });
  assert.equal(checkJudgement(JSON.stringify(good), input, "m")?.lean, "BLOCK", "a JSON string is accepted too");
  assert.equal(checkJudgement({ ...good, confidence: 0.8333 }, input, "m")?.confidence, 0.83);
  assert.equal(checkJudgement({ ...good, lean: "SELL" }, input, "m"), null);
  assert.equal(checkJudgement({ ...good, confidence: 1.2 }, input, "m"), null);
  assert.equal(checkJudgement({ ...good, cites: ["owner_is_scammer"] }, input, "m"), null, "cites only what it was shown");
  assert.equal(checkJudgement({ ...good, cites: [] }, input, "m"), null, "a lean on nothing is no judgement");
  assert.equal(checkJudgement("not json", input, "m"), null);
  assert.equal(checkJudgement({ ...good, note: "Liquidity of 9999 is low." }, input, "m")?.note, null, "invented number drops the note only");
  assert.equal(checkJudgement({ ...good, note: "Liquidity of 2500 is the figure." }, input, "m")?.note, "Liquidity of 2500 is the figure.");
});

test("aiJudge asks the 70B model in JSON mode; errors and timeouts give null", async () => {
  const seen: any[] = [];
  const j = aiJudge({ run: async (model, opts) => (seen.push({ model, opts }), { response: good }) });
  assert.equal((await j(input))?.lean, "BLOCK");
  assert.equal(seen[0].model, JUDGE_MODEL);
  assert.equal(seen[0].opts.response_format.type, "json_schema");
  assert.match(seen[0].opts.messages[1].content, /Citable: token_upgradeable, isProxy/);
  assert.equal(await aiJudge({ run: async () => { throw new Error("JSON Mode couldn't be met"); } })(input), null);
  assert.equal(await aiJudge({ run: () => new Promise(() => {}) }, { timeoutMs: 20 })(input), null);
});

const fakeJudge = (out: unknown): Judge => async (i) => checkJudgement(out, i, "fake");

test("HTTP: judge on a REVIEW is signed into the receipt, but the decision stays REVIEW", async () => {
  const app = makeApp({ tokenFacts: async () => null, judge: fakeJudge({ ...good, cites: ["token_unknown"], lean: "ALLOW" }) });
  const r = await app.gate(goodRequest(), { policy: knownPolicy, token: TOKEN, judge: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.decision, "REVIEW");
  assert.equal(r.data.receipt.decision, "REVIEW", "a lean of ALLOW never changes the signed decision");
  assert.deepEqual([r.data.judgement.ran, r.data.judgement.lean], [true, "ALLOW"]);
  assert.equal(r.data.receipt.body.judgement.advisory, true);
  const v = await app.send("POST", "/api/v1/receipts/verify", { receipt: r.data.receipt });
  assert.equal(v.data.valid, true);
  const tampered = structuredClone(r.data.receipt);
  tampered.body.judgement.lean = "BLOCK";
  assert.equal((await app.send("POST", "/api/v1/receipts/verify", { receipt: tampered })).data.valid, false, "the judgement is covered by the signature");
  const html = await sharePage(r.data.id, r.data.receipt, { valid: true, signer: app.account.address }).text();
  assert.match(html, /AI Judge \(advisory\)/);
  assert.match(html, /did not change the decision/);
});

test("HTTP: judge skipped on ALLOW, unavailable without a model, refused when not boolean, absent when not asked", async () => {
  let calls = 0;
  const counting: Judge = async (i) => (calls++, checkJudgement(good, i, "fake"));
  const app = makeApp({ judge: counting });
  const allow = await app.gate(goodRequest(), { policy: knownPolicy, judge: true });
  assert.deepEqual([allow.data.decision, allow.data.judgement], ["ALLOW", { ran: false, why: "only_on_review" }]);
  assert.equal(allow.data.receipt.body.judgement, undefined);
  assert.equal(calls, 0, "the model is not called on ALLOW");

  const bare = makeApp({ tokenFacts: async () => null });
  const none = await bare.gate(goodRequest(), { policy: knownPolicy, token: TOKEN, judge: true });
  assert.deepEqual(none.data.judgement, { ran: false, why: "unavailable" });

  const offSchema = makeApp({ tokenFacts: async () => null, judge: fakeJudge({ lean: "MAYBE" }) });
  assert.deepEqual((await offSchema.gate(goodRequest(), { policy: knownPolicy, token: TOKEN, judge: true })).data.judgement, { ran: false, why: "unavailable" });

  assert.equal((await app.gate(goodRequest(), { judge: "yes" })).status, 400);
  assert.equal((await app.gate(goodRequest(), { policy: knownPolicy })).data.judgement, undefined);
  const batch = await app.send("POST", "/api/v1/gate/batch", { request: goodRequest(), tokens: [TOKEN], judge: true });
  assert.equal(batch.status, 400, "batch does not take judge");
});
