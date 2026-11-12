// Pre-mortem: for a builder, before launch. A launch draft goes in; out come
//   1. what the Reinkeep gate will tell every agent that wants to buy it (the SAME token rules, run on the draft),
//   2. launch risks the gate cannot see on chain yet (taxes, team share, liquidity lock): our rules of thumb,
//   3. what our data says: whether an earlier token already uses the ticker, and how many tokens that started with
//      similar liquidity were still trading a day later (with the sample size; under MIN_SAMPLE we say so).
// Nothing is stored. Each risk says where it comes from (basis), so a rule of thumb is never passed off as data.
import { defaultPolicy, evaluateToken, type TokenFactSheet } from "../../engine/policy.ts";
import type { CollectorStore, LiquidityBand } from "../../collector/src/collector-store.ts";
import { normalizeTicker } from "../../collector/src/ticker.ts";
import rules from "../../site/data/rules.json" with { type: "json" };
import premortemRules from "../../site/data/premortem-rules.json" with { type: "json" };
import { ApiError } from "./api-error.ts";
import type { Decision } from "./receipt-signing.ts";

export const LIQUIDITY_BANDS = [0, 1_000, 10_000, 100_000];
export const MIN_SAMPLE = 30; // below this many re-checked pools a share is not shown

export type Draft = {
  name: string | null;
  ticker: string;
  contract: { mint: boolean; ownerRenounced: boolean; pause: boolean; blacklist: boolean; upgradeable: boolean };
  buyTaxPct: number;
  sellTaxPct: number;
  teamAllocationPct: number;
  liquidityUsd: number;
  liquidityLockDays: number;
};

type Severity = "high" | "medium" | "low";
type Basis = "gate rule" | "rule of thumb" | "collector data";
export type Risk = { code: string; severity: Severity; basis: Basis; plain: string; fix: string };

const PLAIN = new Map<string, string>(rules.map((r) => [r.code, r.plain]));
const GATE_FIX = premortemRules.gateFixes as Record<string, string>;
const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

// --- input -------------------------------------------------------------------------------------------------------

// The accepted field names, tied to the Draft type: adding a field to Draft does not compile until it is listed here.
const DRAFT_FIELDS: Record<keyof Draft, true> = {
  name: true, ticker: true, contract: true, buyTaxPct: true, sellTaxPct: true, teamAllocationPct: true, liquidityUsd: true, liquidityLockDays: true,
};
const CONTRACT_FIELDS: Record<keyof Draft["contract"], true> = { mint: true, ownerRenounced: true, pause: true, blacklist: true, upgradeable: true };
const contractNames = Object.keys(CONTRACT_FIELDS) as (keyof Draft["contract"])[];

function num(v: unknown, field: string, min: number, max: number, whole = false): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (whole && !Number.isInteger(v))) {
    throw new ApiError(400, "invalid_draft", `${field} must be a ${whole ? "whole " : ""}number from ${min} to ${max}.`);
  }
  return v;
}

export function parseDraft(raw: unknown): Draft {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ApiError(400, "invalid_body", "Body must be a JSON object.");
  const b = raw as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!(k in DRAFT_FIELDS)) throw new ApiError(400, "unknown_field", `Unknown field: ${k.slice(0, 40)}.`);
  if (typeof b.ticker !== "string" || normalizeTicker(b.ticker) === null) throw new ApiError(400, "invalid_draft", "ticker must be 1 to 32 letters or digits.");
  if (b.name !== undefined && b.name !== null && (typeof b.name !== "string" || b.name.length > 64)) throw new ApiError(400, "invalid_draft", "name must be text up to 64 characters.");
  const c = b.contract;
  if (typeof c !== "object" || c === null || Array.isArray(c)) throw new ApiError(400, "invalid_draft", `contract must be an object with ${contractNames.join(", ")} (true or false).`);
  const co = c as Record<string, unknown>;
  for (const k of Object.keys(co)) if (!(k in CONTRACT_FIELDS)) throw new ApiError(400, "unknown_field", `Unknown field: contract.${k.slice(0, 40)}.`);
  for (const k of contractNames) if (typeof co[k] !== "boolean") throw new ApiError(400, "invalid_draft", `contract.${k} must be true or false.`);
  return {
    name: typeof b.name === "string" ? b.name : null,
    ticker: b.ticker,
    contract: { mint: co.mint as boolean, ownerRenounced: co.ownerRenounced as boolean, pause: co.pause as boolean, blacklist: co.blacklist as boolean, upgradeable: co.upgradeable as boolean },
    buyTaxPct: num(b.buyTaxPct, "buyTaxPct", 0, 100),
    sellTaxPct: num(b.sellTaxPct, "sellTaxPct", 0, 100),
    teamAllocationPct: num(b.teamAllocationPct, "teamAllocationPct", 0, 100),
    liquidityUsd: num(b.liquidityUsd, "liquidityUsd", 0, 1e12),
    liquidityLockDays: num(b.liquidityLockDays, "liquidityLockDays", 0, 36_500, true),
  };
}

// --- judging -----------------------------------------------------------------------------------------------------

// The fact sheet the gate WILL read once the token is live, as far as the draft says. The ticker copy is only known
// when we could look the ticker up (null otherwise: no rule fires on unknown copies).
export function draftSheet(d: Draft, tickerTaken: boolean | null): TokenFactSheet {
  return {
    is_contract: true,
    is_proxy: d.contract.upgradeable,
    has_pause: d.contract.pause,
    has_blacklist: d.contract.blacklist,
    has_upgrade: d.contract.upgradeable,
    mint_with_live_owner: d.contract.mint && !d.contract.ownerRenounced,
    seen_liquidity_usd: d.liquidityUsd,
    ticker_clone_of_older: tickerTaken,
  };
}

function launchRisks(d: Draft): Risk[] {
  const values: Record<string, number> = {
    sellTaxPct: d.sellTaxPct, buyTaxPct: d.buyTaxPct, taxGapPct: d.sellTaxPct - d.buyTaxPct,
    teamAllocationPct: d.teamAllocationPct, liquidityLockDays: d.liquidityLockDays,
  };
  const out: Risk[] = [];
  const firedFields = new Set<string>();
  // Rules are listed strongest first per field; only the strongest one per field is reported.
  for (const r of premortemRules.launch as { code: string; severity: Severity; field: string; over?: number; under?: number; plain: string; fix: string }[]) {
    if (firedFields.has(r.field)) continue;
    const v = values[r.field];
    if (v === undefined) throw new Error(`premortem-rules.json names an unknown field: ${r.field}`);
    const hit = (r.over !== undefined && v > r.over) || (r.under !== undefined && v < r.under);
    if (!hit) continue;
    firedFields.add(r.field);
    out.push({ code: r.code, severity: r.severity, basis: "rule of thumb", plain: r.plain, fix: r.fix });
  }
  return out;
}

export type TickerCheck = { checked: boolean; earlierTokens: number | null; firstSeen: string | null };
export type Cohort = { minUsd: number; maxUsd: number | null; n: number; alive: number; dead: number; stillTradingPct: number | null; note: string };

export type Premortem = {
  draft: { name: string | null; ticker: string };
  gate: { decision: Decision; reasons: { code: string; plain: string }[] };
  risks: Risk[];
  ticker: TickerCheck;
  cohort: Cohort | null;
  summary: { high: number; medium: number; low: number };
  stored: false;
};

export function cohortOf(bands: LiquidityBand[], liquidityUsd: number): Cohort {
  const band = [...bands].reverse().find((b) => liquidityUsd >= b.minUsd) ?? bands[0];
  const judged = band.alive + band.dead;
  const enough = judged >= MIN_SAMPLE;
  return {
    ...band,
    stillTradingPct: enough ? Math.round((band.alive / judged) * 100) : null,
    note: enough
      ? `Of ${judged} tokens that started with this much liquidity and were re-checked a day later, ${band.alive} were still trading. A record of past tokens, not a prediction.`
      : `Not enough data yet: ${judged} tokens in this liquidity band were re-checked after a day, and we show a share only from ${MIN_SAMPLE}.`,
  };
}

export async function premortem(d: Draft, deps: { collector?: Pick<CollectorStore, "tokensWithTicker" | "outcomesByLiquidity"> }): Promise<Premortem> {
  // 1. Ticker: any token we have seen with the same normalised ticker is "earlier" (this one does not exist yet).
  let ticker: TickerCheck = { checked: false, earlierTokens: null, firstSeen: null };
  const norm = normalizeTicker(d.ticker);
  if (deps.collector && norm) {
    try {
      const same = await deps.collector.tokensWithTicker(norm);
      const first = same.map((t) => t.firstCreatedMs).filter((ms) => ms > 0).sort((a, b) => a - b)[0];
      ticker = { checked: true, earlierTokens: same.length, firstSeen: first ? new Date(first).toISOString() : null };
    } catch (e) {
      console.error("premortem ticker lookup failed", e);
    }
  }

  // 2. The gate's own token rules on the draft.
  const { deny, approve } = evaluateToken({ token: "draft", facts: draftSheet(d, ticker.checked ? (ticker.earlierTokens ?? 0) > 0 : null) }, defaultPolicy.token);
  const decision: Decision = deny.length ? "BLOCK" : approve.length ? "REVIEW" : "ALLOW";
  const gateRisk = (severity: Severity) => (code: string): Risk => ({ code, severity, basis: "gate rule", plain: PLAIN.get(code) ?? code, fix: GATE_FIX[code] ?? "" });

  // 3. Data: how tokens that started with similar liquidity did after a day.
  let cohort: Cohort | null = null;
  if (deps.collector) {
    try {
      cohort = cohortOf(await deps.collector.outcomesByLiquidity(LIQUIDITY_BANDS), d.liquidityUsd);
    } catch (e) {
      console.error("premortem cohort lookup failed", e);
    }
  }

  const risks = [...deny.map(gateRisk("high")), ...approve.map(gateRisk("medium")), ...launchRisks(d)].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const count = (s: Severity) => risks.filter((r) => r.severity === s).length;
  return {
    draft: { name: d.name, ticker: d.ticker },
    gate: { decision, reasons: [...deny, ...approve].map((code) => ({ code, plain: PLAIN.get(code) ?? "" })) },
    risks,
    ticker,
    cohort,
    summary: { high: count("high"), medium: count("medium"), low: count("low") },
    stored: false,
  };
}
