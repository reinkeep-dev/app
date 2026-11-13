// Mandates: keep watching a token after the agent bought it. Pure logic only (no HTTP, no Durable Object), so it is
// tested directly. The watcher (mandate-object.ts) calls check() about every 30 minutes for 7 days.
//
// Each check re-reads the contract LIVE from the chain (never the collector's cached copy: the point is to see a
// change), runs the same token rules as the gate, compares with the previous read, and produces a signed SIGNAL:
//   exit   the token now fails a BLOCK rule, or a power appeared / the owner or implementation changed
//   watch  REVIEW, or something else changed (supply, ...), or the read failed
//   hold   ALLOW and nothing changed
// A signal is EIP-712 signed by the gate's key and valid for one hour, so an agent can act on it and prove why.
// The rules decide; Reinkeep never trades for anyone.
import { keccak256, recoverTypedDataAddress, stringToHex, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { defaultPolicy, evaluateToken, type TokenFactSheet } from "../../engine/policy.ts";
import type { ContractFacts } from "../../collector/src/types.ts";
import { ApiError } from "./api-error.ts";
import { checkEmail, maskEmail } from "./mandate-email.ts";
import { canonicalJson } from "./canonical-json.ts";
import { RECEIPT_DOMAIN, type Decision } from "./receipt-signing.ts";

export const MANDATE_DAYS = 7;
export const MANDATE_MS = MANDATE_DAYS * 86_400_000;
export const CHECK_EVERY_MS = 30 * 60_000;
export const SIGNAL_VALID_S = 3600;
export const MANDATE_CALLS = 5; // price in gate calls: 5 x $0.01 = $0.05, the free daily calls count first
export const MAX_EVENTS = 400; // 7 days x 48 checks = 336, plus created/renewed/expired

export type Action = "exit" | "watch" | "hold";
type Scalar = string | number | boolean | null;
export type Change = { field: string; before: Scalar; after: Scalar };

// What a fresh read gives: the raw contract facts (for comparing) and the fact sheet the rules read.
export type FreshRead = { contract: ContractFacts; sheet: TokenFactSheet };

export type Signal = {
  mandate: string;
  token: string;
  action: Action;
  decision: Decision;
  reasons: string[];
  factsHash: Hex; // keccak256 of the canonical JSON of the sheet the rules read (null sheet when the read failed)
  issuedAt: number; // unix seconds
  validUntil: number;
  signer: Address;
  signature: Hex;
};

export const SIGNAL_TYPES = {
  Signal: [
    { name: "mandate", type: "string" },
    { name: "token", type: "address" },
    { name: "action", type: "string" },
    { name: "decision", type: "string" },
    { name: "factsHash", type: "bytes32" },
    { name: "issuedAt", type: "uint64" },
    { name: "validUntil", type: "uint64" },
  ],
} as const;

export type EventKind = "created" | "check" | "renewed" | "expired" | "cancelled" | "test";
export type MandateEvent = {
  seq: number;
  at: string; // ISO time
  kind: EventKind;
  changes: Change[];
  error?: string; // set when the chain could not be read this time
  signal?: Signal;
  webhook?: { delivered: boolean; status: number | null };
  email?: { sent: boolean; status: number | null };
};

export type Mandate = {
  id: string;
  token: string;
  webhookUrl: string | null;
  webhookSecret: string | null; // shown once at creation, kept to sign deliveries
  // Optional email alerts (mandate-email.ts). Missing on mandates created before email existed: read as null / "hold" / 0.
  email?: string | null;
  emailedAction?: Action; // the action of the last email that went out; the next email waits for a different one
  emailsSent?: number; // attempts, capped at MAX_EMAILS_PER_MANDATE
  createdAt: number; // ms
  expiresAt: number; // ms
  cancelled: boolean;
  checks: number;
  last: ContractFacts | null; // last successful contract read, for comparing
  lastSignal: Signal | null;
  nextSeq: number;
};

// --- comparing two reads ---------------------------------------------------------------------------------------

// How a change in each contract fact is treated. Typed over every key of ContractFacts, so a fact added to the
// scanner later does not compile until someone decides what its change means.
//   power    alarming when it APPEARS (false/null -> true)
//   control  who controls the token: any change is alarming
//   info     reported as a change, not alarming on its own
//   ignore   bookkeeping of the read itself
type FieldRole = "power" | "control" | "info" | "ignore";
export const FIELD_ROLE: Record<keyof ContractFacts, FieldRole> = {
  token: "ignore",
  readAtMs: "ignore",
  scannerVersion: "ignore",
  hasOwnerFunction: "info",
  isContract: "control",
  owner: "control",
  implementation: "control",
  isProxy: "power",
  hasMint: "power",
  hasPause: "power",
  hasBlacklist: "power",
  hasUpgrade: "power",
  mintWithLiveOwner: "power",
  codeSize: "info",
  ownerRenounced: "info",
  totalSupply: "info",
  decimals: "info",
  symbol: "info",
};
const FIELDS = Object.keys(FIELD_ROLE) as (keyof ContractFacts)[];

const norm = (v: unknown): Scalar => (typeof v === "string" ? v.toLowerCase() : ((v as Scalar) ?? null));

export function diffContract(before: ContractFacts, after: ContractFacts): Change[] {
  const out: Change[] = [];
  for (const f of FIELDS) {
    if (FIELD_ROLE[f] === "ignore") continue;
    const a = norm(before[f]);
    const b = norm(after[f]);
    if (a !== b) out.push({ field: f, before: a, after: b });
  }
  return out;
}

const roleOf = (field: string): FieldRole => FIELD_ROLE[field as keyof ContractFacts] ?? "info";

// The rules first, then the changes. An unreadable chain is never "hold".
export function chooseAction(decision: Decision, changes: Change[], readFailed: boolean): Action {
  if (decision === "BLOCK") return "exit";
  const alarming = changes.some((c) => (roleOf(c.field) === "power" && c.after === true && c.before !== true) || roleOf(c.field) === "control");
  if (alarming) return "exit";
  if (readFailed || decision === "REVIEW" || changes.length > 0) return "watch";
  return "hold";
}

export function judgeSheet(token: string, sheet: TokenFactSheet | null): { decision: Decision; reasons: string[] } {
  const { deny, approve } = evaluateToken({ token, facts: sheet }, defaultPolicy.token);
  return { decision: deny.length ? "BLOCK" : approve.length ? "REVIEW" : "ALLOW", reasons: deny.length ? deny : approve };
}

// --- signals -----------------------------------------------------------------------------------------------------

export const factsHash = (sheet: TokenFactSheet | null): Hex => keccak256(stringToHex(canonicalJson(sheet)));

export async function signSignal(
  account: PrivateKeyAccount,
  s: { mandate: string; token: string; action: Action; decision: Decision; reasons: string[]; sheet: TokenFactSheet | null; nowMs: number },
): Promise<Signal> {
  const issuedAt = Math.floor(s.nowMs / 1000);
  const validUntil = issuedAt + SIGNAL_VALID_S;
  const hash = factsHash(s.sheet);
  const signature = await account.signTypedData({
    domain: RECEIPT_DOMAIN,
    types: SIGNAL_TYPES,
    primaryType: "Signal",
    message: { mandate: s.mandate, token: s.token as Address, action: s.action, decision: s.decision, factsHash: hash, issuedAt: BigInt(issuedAt), validUntil: BigInt(validUntil) },
  });
  return { mandate: s.mandate, token: s.token, action: s.action, decision: s.decision, reasons: s.reasons, factsHash: hash, issuedAt, validUntil, signer: account.address, signature };
}

export type SignalCheck = { valid: true; expired: boolean } | { valid: false; reason: string };
const ACTIONS: readonly string[] = ["exit", "watch", "hold"] satisfies Action[];
const DECISIONS: readonly string[] = ["ALLOW", "REVIEW", "BLOCK"] satisfies Decision[];

// Untrusted input: never throws. `nowS` decides "expired"; a signal past validUntil is still genuine, just stale.
export async function verifySignal(raw: unknown, ourSigner: Address, nowS: number): Promise<SignalCheck> {
  const bad = (reason: string): SignalCheck => ({ valid: false, reason });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("malformed");
  const s = raw as Record<string, unknown>;
  if (
    typeof s.mandate !== "string" || !MANDATE_ID.test(s.mandate) ||
    typeof s.token !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(s.token) ||
    !ACTIONS.includes(s.action as string) ||
    !DECISIONS.includes(s.decision as string) ||
    typeof s.factsHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(s.factsHash) ||
    !Number.isSafeInteger(s.issuedAt) || !Number.isSafeInteger(s.validUntil) ||
    typeof s.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(s.signature)
  ) return bad("malformed");
  let who: Address;
  try {
    who = await recoverTypedDataAddress({
      domain: RECEIPT_DOMAIN,
      types: SIGNAL_TYPES,
      primaryType: "Signal",
      message: {
        mandate: s.mandate, token: s.token as Address, action: s.action as string, decision: s.decision as string,
        factsHash: s.factsHash as Hex, issuedAt: BigInt(s.issuedAt as number), validUntil: BigInt(s.validUntil as number),
      },
      signature: s.signature as Hex,
    });
  } catch {
    return bad("bad_signature");
  }
  if (who.toLowerCase() !== ourSigner.toLowerCase()) return bad("not_our_signature");
  return { valid: true, expired: nowS > (s.validUntil as number) };
}

// --- webhooks ----------------------------------------------------------------------------------------------------

// Header value  t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">  with the mandate's secret.
export async function webhookSignature(secret: string, t: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  return `t=${t},v1=${Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// https only and a public-looking host name: no IP literals, no single-label or *.local style names, no credentials.
// Workers' fetch cannot reach a private network anyway; this keeps the intent obvious and the error message useful.
const INTERNAL_SUFFIX = /\.(local|localhost|internal|lan|home|corp)$/;
export function checkWebhookUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 500) throw new ApiError(400, "invalid_webhook", "webhookUrl must be an https URL up to 500 characters.");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ApiError(400, "invalid_webhook", "webhookUrl is not a valid URL.");
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:") throw new ApiError(400, "invalid_webhook", "webhookUrl must use https.");
  if (u.username || u.password) throw new ApiError(400, "invalid_webhook", "webhookUrl must not carry a user name or password.");
  if (u.port && u.port !== "443") throw new ApiError(400, "invalid_webhook", "webhookUrl must use the standard https port.");
  const ipLike = /^[0-9.]+$/.test(host) || host.startsWith("[") || host.includes(":");
  const internal = host === "localhost" || !host.includes(".") || INTERNAL_SUFFIX.test(host);
  if (ipLike || internal) throw new ApiError(400, "invalid_webhook", "webhookUrl must name a public host, not an IP address or an internal name.");
  return u.toString();
}

// --- creating ----------------------------------------------------------------------------------------------------

export const MANDATE_ID = /^md_[0-9a-f]{32}$/;
const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
export const newMandateId = () => "md_" + randomHex(16);
export const newWebhookSecret = () => "whsec_" + randomHex(32);

export type MandateInput = { token: string; webhookUrl: string | null; email?: string | null };

export function parseMandateBody(raw: unknown): MandateInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ApiError(400, "invalid_body", "Body must be a JSON object.");
  const b = raw as Record<string, unknown>;
  for (const k of Object.keys(b)) if (k !== "token" && k !== "webhookUrl" && k !== "email") throw new ApiError(400, "unknown_field", `Unknown field: ${k.slice(0, 40)}.`);
  if (typeof b.token !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(b.token)) throw new ApiError(400, "invalid_token", "token must be a 0x address with 40 hex characters.");
  const webhookUrl = b.webhookUrl === undefined || b.webhookUrl === null ? null : checkWebhookUrl(b.webhookUrl);
  const email = b.email === undefined || b.email === null ? null : checkEmail(b.email);
  return { token: b.token.toLowerCase(), webhookUrl, email };
}

// What the API shows. The secret only ever appears in the creation answer, never here.
export function publicView(m: Mandate, nowMs: number) {
  const active = !m.cancelled && nowMs < m.expiresAt;
  return {
    id: m.id,
    token: m.token,
    state: m.cancelled ? "cancelled" : active ? "active" : "expired",
    createdAt: new Date(m.createdAt).toISOString(),
    expiresAt: new Date(m.expiresAt).toISOString(),
    checkEveryMinutes: CHECK_EVERY_MS / 60_000,
    checks: m.checks,
    webhook: m.webhookUrl ? { url: m.webhookUrl } : null,
    email: m.email ? maskEmail(m.email) : null,
    signal: m.lastSignal,
  };
}
