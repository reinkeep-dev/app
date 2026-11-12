// Turns untrusted JSON into typed inputs. The rule of thumb:
//   validation rejects what cannot be judged at all (wrong types, a broken recipient address),
//   the rules engine judges everything else (wrong chain, wrong token, http link, bad amount),
// so a bad payment gets a BLOCK with a named reason, not an opaque 400.
import { defaultPolicy, type PaymentRequest, type Policy } from "../../engine/policy.ts";
import { ApiError } from "./api-error.ts";

export type GateInput = {
  request: Omit<PaymentRequest, "now">;
  policy: Policy;
  policyName: string;
  payer?: string;
  token?: string; // the token this payment buys, lowercase (the collector stores tokens lowercase)
  judge?: boolean; // ask the AI Judge for an advisory second opinion when the rules say REVIEW (judge.ts)
};

export const MAX_BATCH_TOKENS = 10;

export type BatchInput = { request: Omit<PaymentRequest, "now">; policy: Policy; policyName: string; tokens: string[] };

export const DEFAULT_PRESET = "reinkeep-default-v1";
export const PRESETS: Record<string, Policy> = { [DEFAULT_PRESET]: defaultPolicy };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HOST = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const bad = (code: string, message: string): never => {
  throw new ApiError(400, code, message);
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function onlyKeys(obj: Record<string, unknown>, allowed: string[], where: string, code: string): void {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length) bad(code, `${where}: unknown field "${extra[0]}". Allowed: ${allowed.join(", ")}.`);
}

function str(v: unknown, field: string, max: number): string {
  if (typeof v !== "string") return bad("invalid_field", `${field} must be a string.`);
  if (v.length > max) return bad("invalid_field", `${field} is longer than ${max} characters.`);
  return v;
}

function num(v: unknown, field: string, min: number, max: number, integer = false): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return bad("invalid_field", `${field} must be a number.`);
  if (integer && !Number.isInteger(v)) return bad("invalid_field", `${field} must be a whole number.`);
  if (v < min || v > max) return bad("invalid_field", `${field} must be between ${min} and ${max}.`);
  return v;
}

function list(v: unknown, field: string, max: number, each: (x: unknown, f: string) => string): string[] {
  if (!Array.isArray(v)) return bad("invalid_field", `${field} must be an array.`);
  if (v.length > max) return bad("invalid_field", `${field} has more than ${max} entries.`);
  return v.map((x, i) => each(x, `${field}[${i}]`));
}

const address = (v: unknown, field: string): string => {
  const s = str(v, field, 42);
  return ADDRESS.test(s) ? s : bad("invalid_address", `${field} must be a 0x address with 40 hex characters.`);
};

function parseRequest(v: unknown): Omit<PaymentRequest, "now"> {
  if (!isObject(v)) return bad("invalid_request", "request must be an object.");
  onlyKeys(v, ["network", "asset", "amount", "decimals", "payTo", "resourceUrl", "validForSeconds", "quotedAmount"], "request", "unknown_request_field");
  const out: Omit<PaymentRequest, "now"> = {
    network: str(v.network, "request.network", 64),
    asset: str(v.asset, "request.asset", 66),
    amount: str(v.amount, "request.amount", 64),
    decimals: num(v.decimals, "request.decimals", 0, 255, true),
    payTo: address(v.payTo, "request.payTo"),
    resourceUrl: str(v.resourceUrl, "request.resourceUrl", 2048),
    validForSeconds: num(v.validForSeconds, "request.validForSeconds", 0, 31_536_000),
  };
  if (v.quotedAmount !== undefined) out.quotedAmount = str(v.quotedAmount, "request.quotedAmount", 64);
  return out;
}

function parsePolicy(v: unknown): { policy: Policy; name: string } {
  if (v === undefined) return { policy: PRESETS[DEFAULT_PRESET], name: DEFAULT_PRESET };
  if (typeof v === "string") {
    const preset = PRESETS[v];
    return preset ? { policy: preset, name: v } : bad("unknown_preset", `No preset called "${v}". See GET /api/v1/gate/presets.`);
  }
  if (!isObject(v)) return bad("invalid_policy", "policy must be a preset name or an object.");
  // A typo must never silently fall back to a default, so unknown fields are an error.
  onlyKeys(v, Object.keys(defaultPolicy), "policy", "unknown_policy_field");
  const p: Policy = { ...defaultPolicy };
  if (v.networks !== undefined) p.networks = list(v.networks, "policy.networks", 8, (x, f) => str(x, f, 64));
  if (v.assets !== undefined) p.assets = list(v.assets, "policy.assets", 16, (x, f) => str(x, f, 66));
  if (v.perPaymentUsd !== undefined) p.perPaymentUsd = num(v.perPaymentUsd, "policy.perPaymentUsd", 0, 1_000_000);
  if (v.dailyUsd !== undefined) p.dailyUsd = num(v.dailyUsd, "policy.dailyUsd", 0, 1_000_000);
  if (v.approveAboveUsd !== undefined) p.approveAboveUsd = num(v.approveAboveUsd, "policy.approveAboveUsd", 0, 1_000_000);
  if (v.allowPayTo !== undefined) p.allowPayTo = list(v.allowPayTo, "policy.allowPayTo", 100, address);
  if (v.allowHosts !== undefined) {
    p.allowHosts = list(v.allowHosts, "policy.allowHosts", 100, (x, f) => {
      const h = str(x, f, 253).toLowerCase();
      return HOST.test(h) ? h : bad("invalid_field", `${f} must be a host name such as api.example.com.`);
    });
  }
  if (v.hostCapsUsd !== undefined) {
    if (!isObject(v.hostCapsUsd)) return bad("invalid_field", "policy.hostCapsUsd must be an object of host to dollars.");
    const entries = Object.entries(v.hostCapsUsd);
    if (entries.length > 100) return bad("invalid_field", "policy.hostCapsUsd has more than 100 entries.");
    p.hostCapsUsd = Object.fromEntries(
      entries.map(([host, cap]) => {
        const h = host.toLowerCase();
        if (!HOST.test(h)) bad("invalid_field", `policy.hostCapsUsd has a bad host name "${host}".`);
        return [h, num(cap, `policy.hostCapsUsd.${host}`, 0, 1_000_000)];
      }),
    );
  }
  if (v.maxValiditySec !== undefined) p.maxValiditySec = num(v.maxValiditySec, "policy.maxValiditySec", 1, 3600, true);
  if (v.duplicateWindowSec !== undefined) p.duplicateWindowSec = num(v.duplicateWindowSec, "policy.duplicateWindowSec", 0, 3600, true);
  if (v.maxPerMinute !== undefined) p.maxPerMinute = num(v.maxPerMinute, "policy.maxPerMinute", 1, 1000, true);
  if (v.token !== undefined) {
    if (!isObject(v.token)) return bad("invalid_field", "policy.token must be an object.");
    onlyKeys(v.token, Object.keys(defaultPolicy.token), "policy.token", "unknown_policy_field");
    p.token = { ...defaultPolicy.token };
    if (v.token.reviewBelowLiquidityUsd !== undefined) {
      p.token.reviewBelowLiquidityUsd = num(v.token.reviewBelowLiquidityUsd, "policy.token.reviewBelowLiquidityUsd", 0, 1_000_000_000);
    }
  }
  return { policy: p, name: "custom" };
}

export function parseGateBody(raw: unknown): GateInput {
  if (!isObject(raw)) return bad("invalid_body", "Body must be a JSON object.");
  onlyKeys(raw, ["request", "policy", "payer", "token", "judge"], "body", "unknown_field");
  if (raw.request === undefined) return bad("missing_request", "Body needs a request object.");
  const { policy, name } = parsePolicy(raw.policy);
  const input: GateInput = { request: parseRequest(raw.request), policy, policyName: name };
  if (raw.payer !== undefined) input.payer = address(raw.payer, "payer").toLowerCase();
  if (raw.token !== undefined) input.token = address(raw.token, "token").toLowerCase();
  if (raw.judge !== undefined) {
    if (typeof raw.judge !== "boolean") return bad("invalid_field", "judge must be true or false.");
    if (raw.judge) input.judge = true;
  }
  return input;
}

// POST /api/v1/gate/batch: one payment request and policy, checked against up to MAX_BATCH_TOKENS tokens.
// `payer` is refused: a payer's history is per payment, and one request repeated for N tokens would trip its own
// duplicate rule, so a batch is always stateless.
export function parseBatchBody(raw: unknown): BatchInput {
  if (!isObject(raw)) return bad("invalid_body", "Body must be a JSON object.");
  onlyKeys(raw, ["request", "policy", "payer", "tokens"], "body", "unknown_field");
  if (raw.payer !== undefined) return bad("payer_not_supported_in_batch", "A batch is stateless: leave out payer, or call POST /api/v1/gate once per token.");
  if (raw.request === undefined) return bad("missing_request", "Body needs a request object.");
  if (!Array.isArray(raw.tokens) || raw.tokens.length < 1) return bad("invalid_tokens", "tokens must be an array of 1 to " + MAX_BATCH_TOKENS + " token addresses.");
  if (raw.tokens.length > MAX_BATCH_TOKENS) return bad("too_many_tokens", `A batch holds at most ${MAX_BATCH_TOKENS} tokens.`);
  const { policy, name } = parsePolicy(raw.policy);
  const tokens = raw.tokens.map((t, i) => address(t, `tokens[${i}]`).toLowerCase());
  return { request: parseRequest(raw.request), policy, policyName: name, tokens };
}

// How many tokens a batch body names, for metering. 0 when the body is not a usable batch (the handler then gives the
// proper 400, and nothing is counted or charged).
export function batchSize(raw: unknown): number {
  if (!isObject(raw) || !Array.isArray(raw.tokens)) return 0;
  return raw.tokens.length >= 1 && raw.tokens.length <= MAX_BATCH_TOKENS ? raw.tokens.length : 0;
}
