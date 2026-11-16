// Daily Workers AI budget for this worker. Cloudflare gives the whole account 10,000 free neurons a day (reset 00:00 UTC);
// on Workers Paid every neuron past that is billed, and the Workers spending limit does not cover Workers AI.
// Every AI call (explain.ts note, judge.ts) books its worst-case neurons here first; once today's budget is used up the
// worker answers with the rules text and no judgement until the next UTC day. Any other worker on the account that uses
// Workers AI needs its own cap, and all the caps together must stay under 10,000 (Forge402's AI is off since 2026-11-16).
//
// Over-estimate on purpose: we book the ceiling (prompt length / 3 tokens, full max_tokens out) and never refund the
// difference, so the real spend is always at or below the budget.

export const DEFAULT_AI_DAILY_NEURONS = 1500;
const MAX_AI_DAILY_NEURONS = 10_000;
const COUNTER_NAME = "ai-neurons"; // one FreeTier counter shared by every request and Durable Object of this worker

// Neurons per million tokens, from https://developers.cloudflare.com/workers-ai/platform/pricing/ (checked 2026-11-16).
export type ModelRate = { inPerM: number; outPerM: number };
export const RATES: Record<string, ModelRate> = {
  "@cf/meta/llama-3.2-3b-instruct": { inPerM: 4625, outPerM: 30475 },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { inPerM: 26668, outPerM: 204805 },
};
// A model missing from the table is booked at the 70B price: too high is safe, too low is not.
const UNKNOWN_RATE: ModelRate = { inPerM: 26668, outPerM: 204805 };

// Worst-case neurons for one call. ~3 characters per token for English prompts (real models average ~4), so this is high.
export function neuronCeiling(model: string, promptChars: number, maxTokens: number): number {
  const rate = RATES[model] ?? UNKNOWN_RATE;
  const tokensIn = Math.ceil(Math.max(0, promptChars) / 3);
  return Math.max(1, Math.ceil((tokensIn * rate.inPerM + Math.max(0, maxTokens) * rate.outPerM) / 1e6));
}

// AI_DAILY_NEURONS from wrangler vars: a whole number from 1 to 10,000; anything else gives the default.
export function dailyLimit(raw: string | undefined): number {
  const n = raw !== undefined && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_AI_DAILY_NEURONS) : DEFAULT_AI_DAILY_NEURONS;
}

// true = the call may run (its neurons are booked). false = budget used up, or the counter failed.
export type AiBudget = (neurons: number) => Promise<boolean>;

type Stub = { fetch(req: Request): Promise<Response> };
type CounterNamespace = { idFromName(name: string): unknown; get(id: unknown): Stub };

// Backed by the FreeTier Durable Object (metering.ts): one instance, per-UTC-day count, all-or-nothing take.
export function counterBudget(ns: CounterNamespace, limit: number): AiBudget {
  return async (neurons) => {
    const stub = ns.get(ns.idFromName(COUNTER_NAME));
    const res = await stub.fetch(new Request(`https://free/take?limit=${limit}&n=${Math.ceil(neurons)}`, { method: "POST" }));
    const body = (await res.json()) as { ok?: unknown };
    return body.ok === true;
  };
}

// No budget wired (local dev, tests) = no cap. A counter error = no AI: costs nothing and the answer still goes out.
export async function mayCallAi(budget: AiBudget | undefined, neurons: number): Promise<boolean> {
  if (!budget) return true;
  try {
    return await budget(neurons);
  } catch (err) {
    console.error("ai budget check failed", err instanceof Error ? err.message : "unknown");
    return false;
  }
}
