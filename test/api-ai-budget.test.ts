// Daily Workers AI budget: past AI_DAILY_NEURONS the note falls back to the rules text and the judge gives nothing,
// without calling the model, so the account never goes past Cloudflare's free 10,000 neurons a day because of this worker.
import assert from "node:assert/strict";
import { test } from "node:test";
import { counterBudget, dailyLimit, DEFAULT_AI_DAILY_NEURONS, mayCallAi, neuronCeiling, type AiBudget } from "../api/src/ai-budget.ts";
import { aiExplainer, EXPLAIN_MODEL, type AiRunner, type ExplainInput } from "../api/src/explain.ts";
import { aiJudge, JUDGE_MODEL } from "../api/src/judge.ts";
import { FreeTier } from "../api/src/metering.ts";

const input: ExplainInput = { decision: "REVIEW", reasons: [{ code: "NEW_RECIPIENT", plain: "This recipient is new." }], amount: "0.01" };

// FreeTier objects kept in memory, one per name, like the Durable Object namespace in production.
function namespace() {
  const objects = new Map<string, FreeTier>();
  return {
    idFromName: (name: string) => name,
    get: (id: unknown) => {
      const name = String(id);
      if (!objects.has(name)) {
        const m = new Map<string, any>();
        objects.set(name, new FreeTier({ storage: { get: async (k) => m.get(k), put: async (k, v) => void m.set(k, v) } }));
      }
      return objects.get(name)!;
    },
  };
}

function countingAi(response: unknown = "Held for a person to look at because the recipient is new.") {
  let calls = 0;
  const ai: AiRunner = { run: async () => ((calls += 1), { response }) };
  return { ai, calls: () => calls };
}

test("neuronCeiling: Cloudflare's per-model price, rounded up, and the 70B price for an unknown model", () => {
  // 900 chars = 300 tokens in at 4,625/M plus 100 out at 30,475/M = 1.39 + 3.05 = 4.43, rounded up.
  assert.equal(neuronCeiling(EXPLAIN_MODEL, 900, 100), 5);
  // 70B: 300 in at 26,668/M plus 300 out at 204,805/M = 8.0 + 61.44 = 69.44.
  assert.equal(neuronCeiling(JUDGE_MODEL, 900, 300), 70);
  assert.equal(neuronCeiling("@cf/some/new-model", 900, 300), 70);
  assert.equal(neuronCeiling(EXPLAIN_MODEL, 0, 0), 1); // never books zero
});

test("dailyLimit: a whole number from 1 to 10,000, anything else is the default", () => {
  assert.equal(DEFAULT_AI_DAILY_NEURONS, 1500);
  assert.equal(dailyLimit(undefined), 1500);
  assert.equal(dailyLimit("abc"), 1500);
  assert.equal(dailyLimit("0"), 1500);
  assert.equal(dailyLimit("-5"), 1500);
  assert.equal(dailyLimit(" 2000 "), 2000);
  assert.equal(dailyLimit("50000"), 10_000);
});

test("counterBudget: books neurons all or nothing until the limit, shared by every caller", async () => {
  const ns = namespace();
  const a = counterBudget(ns, 10);
  const b = counterBudget(ns, 10); // a second handler (another Durable Object) uses the same counter
  assert.equal(await a(6), true);
  assert.equal(await b(6), false); // 12 > 10: refused, nothing booked
  assert.equal(await b(4), true); // exactly 10
  assert.equal(await a(1), false);
});

test("counterBudget: one call above 100 neurons is booked in full, not cut to 100", async () => {
  const budget = counterBudget(namespace(), 150);
  assert.equal(await budget(140), true);
  assert.equal(await budget(20), false); // 160 > 150; with the old cap of 100 per take this would have passed
});

test("counterBudget: the count starts again on the next UTC day", async () => {
  const realNow = Date.now;
  try {
    const budget = counterBudget(namespace(), 10);
    Date.now = () => Date.parse("2026-11-16T23:59:00Z");
    assert.equal(await budget(10), true);
    assert.equal(await budget(1), false);
    Date.now = () => Date.parse("2026-11-17T00:00:30Z");
    assert.equal(await budget(10), true);
  } finally {
    Date.now = realNow;
  }
});

test("mayCallAi: no budget wired means no cap; a counter error means no AI", async () => {
  assert.equal(await mayCallAi(undefined, 5), true);
  assert.equal(await mayCallAi(async () => { throw new Error("object down"); }, 5), false);
});

test("explainer: within budget it calls the model and books its ceiling", async () => {
  const asked: number[] = [];
  const budget: AiBudget = async (n) => (asked.push(n), true);
  const { ai, calls } = countingAi();
  const out = await aiExplainer(ai, { budget })(input);
  assert.equal(out.source, "ai");
  assert.equal(calls(), 1);
  assert.equal(asked.length, 1);
  assert.ok(asked[0] >= 1 && asked[0] < 20, `booked ${asked[0]} neurons`);
});

test("explainer: budget used up gives the rules text and never calls the model", async () => {
  const { ai, calls } = countingAi();
  const out = await aiExplainer(ai, { budget: async () => false })(input);
  assert.deepEqual(out, { text: "Held for a person to look at. This recipient is new.", source: "rules" });
  assert.equal(calls(), 0);
});

test("explainer: a broken counter gives the rules text and never calls the model", async () => {
  const { ai, calls } = countingAi();
  const out = await aiExplainer(ai, { budget: async () => { throw new Error("object down"); } })(input);
  assert.equal(out.source, "rules");
  assert.equal(calls(), 0);
});

test("judge: budget used up gives no judgement and never calls the model", async () => {
  const { ai, calls } = countingAi({ lean: "BLOCK", confidence: 0.9, cites: ["NEW_RECIPIENT"], note: "New recipient." });
  assert.equal(await aiJudge(ai, { budget: async () => false })(input), null);
  assert.equal(calls(), 0);
});

test("end to end: with a real counter the AI stops once today's neurons are booked", async () => {
  const ns = namespace();
  const { ai, calls } = countingAi();
  const explain = aiExplainer(ai, { budget: counterBudget(ns, 12) });
  const sources: string[] = [];
  for (let i = 0; i < 5; i++) sources.push((await explain(input)).source);
  // Each call books ~5 neurons, so 2 fit in 12 and the rest fall back to the rules text.
  assert.deepEqual(sources, ["ai", "ai", "rules", "rules", "rules"]);
  assert.equal(calls(), 2);
});
