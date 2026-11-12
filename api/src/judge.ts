// The AI Judge: a second opinion on a REVIEW, asked for with `judge: true` on POST /api/v1/gate.
// Advisory only. The decision in the receipt stays what the rules said (REVIEW); the judgement rides along inside the
// signed body, so anyone can prove what the model said, but it never turns a REVIEW into ALLOW or BLOCK.
// Why not let it decide (Actuary has a "resolve" mode): the rules are the product, a model can be wrong or talked
// round, and an agent that wants the lean can act on it itself, knowing it is a model's opinion.
//
// Model: Llama 3.3 70B on Workers AI, in JSON mode (response_format json_schema; the answer arrives as an object, or
// a string on some runtimes). Id and JSON-mode support from https://developers.cloudflare.com/workers-ai/features/json-mode/
// (checked 2026-11-11). Every failure, timeout or answer outside the schema gives null: no judgement, never a guess.
import type { Decision } from "./receipt-signing.ts";
import { factLines, type AiRunner, type ExplainInput } from "./explain.ts";

export const JUDGE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const JUDGE_TIMEOUT_MS = 8000;
const NOTE_MAX_CHARS = 400;
const MAX_CITES = 6;

export type Judgement = { lean: Decision; confidence: number; cites: string[]; note: string | null; model: string; advisory: true };
// What the gate answer says about the judge when the caller asked for it.
export type JudgeOutcome = ({ ran: true } & Judgement) | { ran: false; why: "only_on_review" | "unavailable" };
export type Judge = (input: ExplainInput) => Promise<Judgement | null>;

const LEANS: Decision[] = ["ALLOW", "REVIEW", "BLOCK"];

// What the model may cite: the reason codes that fired and the names of the token facts it was shown.
export function citable(input: ExplainInput): Set<string> {
  const out = new Set(input.reasons.map((r) => r.code));
  const f = input.token?.facts;
  if (f) for (const [k, v] of Object.entries(f)) if (typeof v === "boolean" || typeof v === "number" || v === null) out.add(k);
  return out;
}

const NUMBER = /\d+(?:[.,]\d+)*/g;

// Checks the model's answer against the schema and the facts. Returns null for anything off.
// A bad note alone is dropped (note: null); a bad lean, confidence or cite drops the whole judgement.
export function checkJudgement(raw: unknown, input: ExplainInput, model: string): Judgement | null {
  let o: unknown = raw;
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch {
      return null;
    }
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (typeof r.lean !== "string" || !LEANS.includes(r.lean as Decision)) return null;
  if (typeof r.confidence !== "number" || !Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 1) return null;
  if (!Array.isArray(r.cites) || r.cites.length > MAX_CITES) return null;
  const allowed = citable(input);
  const cites = [...new Set(r.cites)];
  if (!cites.every((c) => typeof c === "string" && allowed.has(c))) return null;
  // Lean on something: a judgement that cites nothing it was shown is not one.
  if (cites.length === 0) return null;
  return { lean: r.lean as Decision, confidence: Math.round(r.confidence * 100) / 100, cites: cites as string[], note: checkNote(r.note, input), model, advisory: true };
}

function checkNote(raw: unknown, input: ExplainInput): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text || text.length > NOTE_MAX_CHARS) return null;
  const allowed = new Set(factLines(input).join("\n").match(NUMBER) ?? []);
  for (const n of text.match(NUMBER) ?? []) if (!allowed.has(n.replace(/[.,]+$/, ""))) return null;
  return text;
}

const SCHEMA = {
  type: "object",
  properties: {
    lean: { type: "string", enum: LEANS },
    confidence: { type: "number" },
    cites: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
  required: ["lean", "confidence", "cites", "note"],
};

function prompt(input: ExplainInput): { role: string; content: string }[] {
  return [
    {
      role: "system",
      content:
        "A rules engine checked a payment an AI agent wants to make (often to buy a token) and held it for REVIEW. " +
        "Give a second opinion: lean ALLOW if the reasons look harmless given the facts, BLOCK if they point to real danger to the payer " +
        "(for example a live owner who can mint, blacklist or pause), or REVIEW if you cannot tell. Unknown facts are not evidence of safety. " +
        "confidence is from 0 to 1. cites lists the exact reason codes or fact names your lean rests on, copied from the input. " +
        "note is one or two plain sentences on why, using only the facts given and no new numbers. Answer only with the JSON object.",
    },
    { role: "user", content: [...factLines(input), `Citable: ${[...citable(input)].join(", ")}`].join("\n") },
  ];
}

// Builds the judge for a worker with the AI binding. Never throws.
export function aiJudge(ai: AiRunner, opts: { timeoutMs?: number; model?: string } = {}): Judge {
  const model = opts.model ?? JUDGE_MODEL;
  const timeoutMs = opts.timeoutMs ?? JUDGE_TIMEOUT_MS;
  return async (input) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const slow = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      });
      const out = await Promise.race([ai.run(model, { messages: prompt(input), max_tokens: 300, response_format: { type: "json_schema", json_schema: SCHEMA } }), slow]);
      const raw = typeof out === "object" && out !== null ? (out as { response?: unknown }).response : undefined;
      return checkJudgement(raw, input, model);
    } catch (err) {
      console.error("judge failed", err instanceof Error ? err.message : "unknown");
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
