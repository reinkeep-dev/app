// The short plain-English note that rides along with every gate answer.
// It is decoration. The decision, the reasons and the signed receipt never come from here and never change because of it.
// Two paths: Workers AI when the worker has the AI binding, and a fixed sentence built from the rules when it does not,
// or when the model is slow, fails, or says something we do not let through.
import type { TokenFactSheet } from "../../engine/policy.ts";
import type { Decision } from "./receipt-signing.ts";

// Small, fast instruct model on the Workers AI free allowance (10,000 neurons a day shared by all models).
// Id and run shape (env.AI.run(model, { messages, max_tokens }) -> { response }) taken from
// https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/ (checked 2026-11-11).
export const EXPLAIN_MODEL = "@cf/meta/llama-3.2-3b-instruct";
export const EXPLAIN_TIMEOUT_MS = 2500;
export const EXPLAIN_MAX_CHARS = 320;

export type Explanation = { text: string; source: "ai" | "rules"; model?: string };
export type ExplainInput = {
  decision: Decision;
  reasons: { code: string; plain: string }[];
  amount?: string; // human amount, e.g. "0.01"
  token?: { token: string; facts: TokenFactSheet | null };
  // "token_check": the free token check (no payment is being judged). Changes only what the model is told the decision means.
  kind?: "token_check";
};
export type Explainer = (input: ExplainInput) => Promise<Explanation>;

// The only part of the Workers AI binding used here (typed locally so Node tests and tsc need no Cloudflare types).
export type AiRunner = {
  run(model: string, options: { messages: { role: string; content: string }[]; max_tokens: number; response_format?: { type: "json_schema"; json_schema: unknown } }): Promise<unknown>;
};

const VERB: Record<Decision, string> = {
  ALLOW: "Allowed.",
  REVIEW: "Held for a person to look at.",
  BLOCK: "Blocked.",
};

// Same words every time for the same input. Used whenever the model text is missing or rejected.
export function rulesExplanation(input: ExplainInput): Explanation {
  const plain = input.reasons.map((r) => r.plain.trim()).filter(Boolean);
  const text = plain.length ? `${VERB[input.decision]} ${plain.join(" ")}` : `${VERB[input.decision]} No rule objected.`;
  return { text, source: "rules" };
}

// What each answer means, stated to the model: the check happens BEFORE any payment (live test 2026-11-11: without
// this the model wrote "The payment was successful" for ALLOW and "has been reviewed" for REVIEW).
const MEANING = {
  ALLOW: "the agent may go ahead and make this payment. Nothing has been paid yet.",
  REVIEW: "a human (not the agent) must look at this payment and decide before the agent pays. Nothing has been paid yet.",
  BLOCK: "the agent must not make this payment. Nothing has been paid.",
} as const;

const TOKEN_MEANING = {
  ALLOW: "none of the token rules objected to this token. That is not a promise that it is safe. Nothing has been bought.",
  REVIEW: "a person should look at this token before anyone buys it. Nothing has been bought.",
  BLOCK: "this token should not be bought. Nothing has been bought.",
} as const;

// Every fact the model is allowed to know, as lines of text. The guard checks its answer against exactly this.
export function factLines(input: ExplainInput): string[] {
  const meaning = input.kind === "token_check" ? TOKEN_MEANING : MEANING;
  const lines = [`Decision: ${input.decision}`, `Meaning: ${meaning[input.decision as keyof typeof MEANING] ?? "a check made before paying; nothing has been paid yet."}`];
  for (const r of input.reasons) lines.push(`Reason (${r.code}): ${r.plain}`);
  // Without this line a small model invents a reason for an ALLOW (live test: "below the minimum threshold").
  if (input.reasons.length === 0) lines.push("Reasons: none. Every rule passed.");
  if (input.amount) lines.push(`Payment amount: ${input.amount}`);
  if (input.token) {
    const f = input.token.facts;
    if (!f) lines.push("Token checked: no data on this token");
    else for (const [k, v] of Object.entries(f)) if (typeof v === "boolean" || typeof v === "number" || v === null) lines.push(`Token fact ${k}: ${v === null ? "unknown" : v}`);
  }
  return lines;
}

const NUMBER = /\d+(?:[.,]\d+)*/g;
// Wording that says a payment already happened (or was already reviewed): false for a check made before paying.
const PAST = /\b(successful(ly)?|succeeded|went through|(was|were|has been|have been) (made|sent|paid|completed|processed|reviewed|approved))\b/i;
// Opinions about the size of the amount.
const SIZE_OPINION = /\b(very|too|quite|really) (small|large|big|high|low|cheap|expensive)\b/i;
// The input's own labels copied back ("Decision: REVIEW Meaning: ..."): the model echoed the facts instead of
// writing sentences (seen live on GET /verdict, 2026-11-12). Not a summary a person can read, so the rules text is used.
const ECHO = /\b(Decision|Meaning|Reasons?|Token fact|Token checked|Payment amount)\s*(\([^)]*\))?\s*:/;
const ADVICE = /\b(should(n't| not)? (be )?(buy|bought|sell|sold|hold|held|avoid|avoided|trust|trusted)|do not buy|don't buy|should (buy|sell|invest|avoid|trust)|invest|guarantee[sd]?|safe to|financial advice|i recommend|we recommend|you must|go ahead and)\b/i;

// Returns the text if it is clean, else null (caller falls back).
export function checkExplanation(raw: unknown, facts: string[]): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text || text.length > EXPLAIN_MAX_CHARS) return null;
  if (ADVICE.test(text) || PAST.test(text) || SIZE_OPINION.test(text) || ECHO.test(text)) return null;
  // The reason codes carry digits too (e.g. v1), so allow numbers that appear in the facts text only.
  const allowed = new Set(facts.join("\n").match(NUMBER) ?? []);
  for (const n of text.match(NUMBER) ?? []) if (!allowed.has(n.replace(/[.,]+$/, ""))) return null;
  return text;
}

function prompt(facts: string[]): { role: string; content: string }[] {
  return [
    {
      role: "system",
      content:
        "You explain a payment check result to a person who is not technical. Write at most 2 short plain-English sentences. " +
        "This check happens BEFORE any payment: never say a payment was made, sent, completed, successful or already reviewed. " +
        "Sentence 1: what the decision means. Sentence 2: the reason, taken only from the Reason lines (if there are none, say every rule passed). " +
        "Never repeat a sentence. Never invent a reason. Never say whether to buy, sell, hold or avoid anything; only say what the check found. " +
        "Use only the facts given. Do not add numbers. Do not give advice or opinions about buying, investing, safety or the size of the amount. Output only the sentences.",
    },
    { role: "user", content: facts.join("\n") },
  ];
}

// Builds the explainer for a worker that has the AI binding. Never throws: every failure returns the rules text.
export function aiExplainer(ai: AiRunner, opts: { timeoutMs?: number; model?: string } = {}): Explainer {
  const model = opts.model ?? EXPLAIN_MODEL;
  const timeoutMs = opts.timeoutMs ?? EXPLAIN_TIMEOUT_MS;
  return async (input) => {
    const fallback = rulesExplanation(input);
    const facts = factLines(input);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const slow = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      });
      const out = await Promise.race([ai.run(model, { messages: prompt(facts), max_tokens: 100 }), slow]);
      const raw = typeof out === "object" && out !== null ? (out as { response?: unknown }).response : undefined;
      const text = checkExplanation(raw, facts);
      return text ? { text, source: "ai", model } : fallback;
    } catch (err) {
      // Log the kind of failure only, never the prompt or the model's words.
      console.error("explanation failed", err instanceof Error ? err.message : "unknown");
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  };
}
