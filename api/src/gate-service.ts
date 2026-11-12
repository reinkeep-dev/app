// The gate: one payment request in, one signed answer out. No HTTP in here, so it is tested directly.
// The decision always comes from engine/policy.ts (the same evaluate() the site and the local guard run).
import type { PrivateKeyAccount } from "viem/accounts";
import { evaluate, record, type Decision as EngineVerdict, type TokenFactSheet, type TokenUnderTest } from "../../engine/policy.ts";
import rules from "../../site/data/rules.json" with { type: "json" };
import { rulesExplanation, type Explainer, type Explanation, type ExplainInput } from "./explain.ts";
import type { GateStore, LedgerView } from "./gate-store.ts";
import type { Judge, JudgeOutcome } from "./judge.ts";
import type { CollectorStore } from "../../collector/src/collector-store.ts";
import { ENGINE, signReceipt, type Decision, type Receipt, type ReceiptBody } from "./receipt-signing.ts";
import { BASE_URL } from "./discovery.ts";
import { saveReceipt, type ReceiptStore } from "./receipt-store.ts";
import type { BatchInput, GateInput } from "./request-validation.ts";
import { checkPayerProof } from "./payer-proof.ts";

export type GateDeps = {
  account: PrivateKeyAccount;
  now: () => number; // ms; the server decides the time, never the caller
  // Without a store the gate is stateless: only rules that need no history can fire, and the receipt says so.
  store?: GateStore;
  // Where the token rules get their facts (the collector's database; see token-facts-source.ts).
  // Without one, a request that names a token gets token_unknown (REVIEW): we never judge a token blind.
  tokenFacts?: (token: string) => Promise<TokenFactSheet | null>;
  // Writes the short plain-English note (explain.ts). Optional: without it, or if it throws, the note is built from the rules.
  explain?: Explainer;
  // The AI Judge (judge.ts): an advisory second opinion on a REVIEW when the caller asks. Optional.
  judge?: Judge;
  // Where signed receipts are kept (D1). Without one nothing is stored and the answer has no shareUrl.
  receipts?: ReceiptStore;
  // Keeps a background job (the receipt save) alive after the answer is sent. Workers: ctx.waitUntil.
  waitUntil?: (p: Promise<unknown>) => void;
  // The collector's data, read directly by the tools that need more than one token's facts (pre-mortem: ticker uses
  // and 24h outcomes by liquidity). Optional: without it those parts say "not checked".
  collector?: Pick<CollectorStore, "tokensWithTicker" | "outcomesByLiquidity" | "outcomesByBand" | "boardDays" | "tickerWaves" | "poolsOfToken" | "getToken" | "counts">;
};

// A failed read is treated exactly like "never seen": REVIEW, never ALLOW. The error is logged for us.
export async function readFacts(token: string, deps: Pick<GateDeps, "tokenFacts">): Promise<TokenUnderTest> {
  if (!deps.tokenFacts) return { token, facts: null };
  try {
    return { token, facts: await deps.tokenFacts(token) };
  } catch (err) {
    console.error("token facts read failed", err);
    return { token, facts: null };
  }
}

export type Reason = { code: string; plain: string };
export type GateResult = { id: string; decision: Decision; reasons: Reason[]; receipt: Receipt; explanation: Explanation; judgement?: JudgeOutcome; shareUrl?: string };

const LABEL: Record<EngineVerdict["verdict"], Decision> = { allow: "ALLOW", approve: "REVIEW", deny: "BLOCK" };
const PLAIN = new Map<string, string>(rules.map((r) => [r.code, r.plain]));

export const explain = (code: string): Reason => ({ code, plain: PLAIN.get(code) ?? "" });

// "0.01" from amount "10000" and decimals 6. Only for the note; the receipt keeps the raw request.
function humanAmount(amount: string, decimals: number): string | undefined {
  if (!/^\d+$/.test(amount) || !Number.isInteger(decimals) || decimals < 0 || decimals > 30) return undefined;
  const digits = amount.padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals).replace(/^0+(?=\d)/, "");
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

// The judge runs only on a REVIEW, and any failure (no binding, timeout, an answer off the schema) is "unavailable".
export async function judgeSafely(input: ExplainInput, deps: Pick<GateDeps, "judge">): Promise<JudgeOutcome> {
  if (input.decision !== "REVIEW") return { ran: false, why: "only_on_review" };
  if (!deps.judge) return { ran: false, why: "unavailable" };
  try {
    const j = await deps.judge(input);
    return j ? { ran: true, ...j } : { ran: false, why: "unavailable" };
  } catch {
    return { ran: false, why: "unavailable" };
  }
}

// The note never decides anything and never blocks the answer: any failure gives the rules text.
export async function explainSafely(input: ExplainInput, deps: Pick<GateDeps, "explain">): Promise<Explanation> {
  if (!deps.explain) return rulesExplanation(input);
  try {
    return await deps.explain(input);
  } catch {
    return rulesExplanation(input);
  }
}

export async function gate(input: GateInput, deps: GateDeps): Promise<GateResult> {
  const nowMs = deps.now();
  const request = { ...input.request, now: nowMs };
  // A payer's history is only touched by that payer: checked before anything is read or written (payer-proof.ts).
  if (input.payer) await checkPayerProof({ ...input, payer: input.payer }, nowMs);
  const stateful = Boolean(input.payer && deps.store);
  // Read before taking the payer's lock: token facts do not depend on the payer's history.
  const buying = input.token ? await readFacts(input.token, deps) : undefined;

  // Read the history, decide and record as one step, so two parallel identical requests cannot both pass.
  const decide = (history: LedgerView): EngineVerdict => {
    const verdict = evaluate(request, input.policy, history.entries, buying);
    if (verdict.verdict === "allow") history.add(record(request));
    return verdict;
  };
  const verdict: EngineVerdict = stateful
    ? await deps.store!.run(input.payer!, nowMs, decide)
    : evaluate(request, input.policy, [], buying);

  const decision = LABEL[verdict.verdict];
  const reasons = verdict.reasons.map(explain);
  const note: ExplainInput = { decision, reasons, amount: humanAmount(input.request.amount, input.request.decimals), token: buying };
  const judged = input.judge ? await judgeSafely(note, deps) : undefined;
  const body: ReceiptBody = { engine: ENGINE, policyName: input.policyName, request: input.request, reasons: verdict.reasons, stateful };
  if (buying) body.buying = buying;
  // Signed with the receipt so the opinion can be proven later; the decision above is untouched by it.
  if (judged?.ran) body.judgement = { lean: judged.lean, confidence: judged.confidence, cites: judged.cites, note: judged.note, model: judged.model, advisory: true };
  const receipt = await signReceipt(deps.account, { decision, body, policy: input.policy, issuedAt: Math.floor(nowMs / 1000) });
  const result: GateResult = { id: receipt.id, decision, reasons, receipt, explanation: await explainSafely(note, deps) };
  if (judged) result.judgement = judged;
  // Saved in the background: the answer never waits for the database and never fails because of it.
  if (deps.receipts) {
    saveReceipt(deps.receipts, receipt, deps.waitUntil);
    result.shareUrl = `${BASE_URL}/r/${receipt.id}`;
  }
  return result;
}

// One gate answer per token, each with its own signed receipt. Always stateless (parseBatchBody refuses a payer).
export async function gateBatch(input: BatchInput, deps: GateDeps): Promise<{ results: GateResult[] }> {
  const results = await Promise.all(input.tokens.map((token) => gate({ request: input.request, policy: input.policy, policyName: input.policyName, token }, deps)));
  return { results };
}
