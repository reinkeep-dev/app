// Metering for POST /api/v1/gate: 25 free calls per caller IP per UTC day (a FreeTier Durable Object per IP), then
// x402 v2 pay-per-call. POST /api/v1/gate/x402 skips the free tier. POST /api/v1/gate/batch costs one call per token
// (all or nothing) and, past the free tier, asks for PRICE_AMOUNT times that count.
// GET /api/v1/verdict/{address} is free but limited: 60 per caller IP per UTC day in its own FreeTier object ("verdict:" + ip).
// The gate itself runs through `route` (payer ledger routing lives in worker.ts), so the body is read once, there.
import { ApiError } from "./api-error.ts";
import { json, fail, readLimited, MAX_BODY_BYTES } from "./http-handler.ts";
import { batchSize } from "./request-validation.ts";
import { isMandatePurchase } from "./mandate-routes.ts";
import { MANDATE_CALLS } from "./mandate-service.ts";
import { HOLDER_DISCOUNT_PCT, HOLDER_HEADER, claimedHolder, holderAmount, holderConfig, payerOf } from "./holder.ts";
import {
  DATA_CALLS_PER_DAY, DEFAULT_FACILITATOR, FREE_CALLS_PER_DAY, FacilitatorUnavailable, NETWORK, PREMORTEM_CALLS_PER_DAY, PRICE_AMOUNT, PRICE_USD, USDG, VERDICT_CALLS_PER_DAY,
  checkPayload, createFacilitator, fromBase64, paymentRequired, requirementsFor, toBase64, type Facilitator, type Requirements,
} from "./x402.ts";

type Stub = { fetch(req: Request): Promise<Response> };
export type MeterEnv = {
  FREE?: { idFromName(name: string): unknown; get(id: unknown): Stub };
  X402_PAY_TO?: string;
  PRIORS_API_KEY?: string;
  FACILITATOR_URL?: string;
  HOLDER_TOKEN?: string; // holder price (holder.ts): the Reinkeep token's address, once launched
  HOLDER_MIN?: string; // and the balance (base units) that counts as a holder
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const GATE = "/api/v1/gate";
const BATCH = GATE + "/batch";
const VERDICT = "/api/v1/verdict/";
const PREMORTEM = "/api/v1/premortem";
const AUTOPSY = "/api/v1/autopsy/";
const DATA_PATHS = new Set(["/api/v1/odds", "/api/v1/board", "/api/v1/radar"]);
const PENDING_WAITS = [1000, 2000, 2000]; // ms between /settle retries

const withHeaders = (res: Response, extra: Record<string, string>): Response => {
  // Responses that came from a Durable Object stub are immutable, so build a new one.
  const out = new Response(res.body, { status: res.status, headers: res.headers });
  for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
  return out;
};

const payOk = (env: MeterEnv): boolean => !!env.PRIORS_API_KEY && ADDRESS.test(env.X402_PAY_TO ?? "");

export function pricing(env: MeterEnv): Response {
  return json(200, {
    freeCallsPerDay: FREE_CALLS_PER_DAY, priceUsd: PRICE_USD, amount: PRICE_AMOUNT, asset: USDG, network: NETWORK,
    payTo: ADDRESS.test(env.X402_PAY_TO ?? "") ? env.X402_PAY_TO : null, facilitator: env.FACILITATOR_URL || DEFAULT_FACILITATOR,
    holder: holderPricing(env),
  });
}

// null until the token is launched and HOLDER_TOKEN / HOLDER_MIN are set.
function holderPricing(env: MeterEnv) {
  const cfg = holderConfig(env);
  if (!cfg) return null;
  return { token: cfg.token, minBalance: String(cfg.minBalance), discountPct: HOLDER_DISCOUNT_PCT, amount: holderAmount(PRICE_AMOUNT), header: HOLDER_HEADER };
}

function payment402(url: string, requirements: Requirements, error: string): Response {
  const body = paymentRequired(url, requirements, error);
  return withHeaders(json(402, body), { "payment-required": toBase64(body) });
}

// Returns null when the request is not metered (the caller then handles it as before).
export async function meter(
  req: Request,
  env: MeterEnv,
  deps: {
    route: (req: Request) => Promise<Response>;
    fetch: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    // Reads the holder's balance (holder.ts holderCheck). Absent, or HOLDER_TOKEN unset: no holder price.
    isHolder?: (address: string) => Promise<boolean>;
  },
): Promise<Response | null> {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  if (req.method === "GET" && path === GATE + "/pricing") return pricing(env);
  const ip = (req.headers.get("cf-connecting-ip") ?? "").trim() || "unknown";
  if (req.method === "GET" && path.startsWith(VERDICT)) return meterVerdict(req, path.slice(VERDICT.length), ip, env, deps.route);
  if (req.method === "GET" && (DATA_PATHS.has(path) || path.startsWith(AUTOPSY))) {
    return meterLimited(req, ip, env, deps.route, {
      name: "data", limit: DATA_CALLS_PER_DAY, code: "data_limit",
      message: `The ${DATA_CALLS_PER_DAY} free launch-data reads for today are used. Try again tomorrow (UTC).`,
    });
  }
  if (req.method === "POST" && path === PREMORTEM) {
    return meterLimited(req, ip, env, deps.route, {
      name: "premortem", limit: PREMORTEM_CALLS_PER_DAY, code: "premortem_limit",
      message: `The ${PREMORTEM_CALLS_PER_DAY} free pre-mortems for today are used. Try again tomorrow (UTC).`,
    });
  }
  const mandate = isMandatePurchase(req.method, path);
  if (!mandate && (req.method !== "POST" || (path !== GATE && path !== GATE + "/x402" && path !== BATCH))) return null;

  const paidOnly = path === GATE + "/x402";
  // A batch costs one call per token. The body is read here to count them, then handed on unchanged.
  // A mandate (new or renewed) costs MANDATE_CALLS calls: 7 days of checks every 30 minutes.
  let units = mandate ? MANDATE_CALLS : 1;
  if (path === BATCH) {
    let text: string;
    try {
      text = await readLimited(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err instanceof ApiError) return fail(err.status, err.code, err.message);
      throw err;
    }
    req = new Request(req.url, { method: "POST", headers: req.headers, body: text });
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    units = batchSize(parsed);
    // Not a usable batch (bad JSON, no tokens, over 10): the handler gives the proper 400. Nothing is counted or charged.
    if (units === 0) return deps.route(req);
  }
  const free = !paidOnly && env.FREE ? env.FREE.get(env.FREE.idFromName(ip)) : undefined;

  // The gate itself is always /api/v1/gate, whichever path the caller used.
  const gateReq = () => {
    if (!paidOnly) return req;
    const url = new URL(req.url);
    url.pathname = GATE;
    return new Request(url, { method: "POST", headers: req.headers, body: req.body, duplex: "half" } as RequestInit);
  };

  if (free) {
    // Take the slots first (race-safe: parallel calls cannot overshoot; all or nothing), give them back unless the gate answered 200.
    const taken = (await (await free.fetch(new Request(`https://free/take?n=${units}`, { method: "POST" }))).json()) as { ok: boolean; left: number };
    if (taken.ok) {
      const res = await deps.route(gateReq());
      if (res.ok) return withHeaders(res, { "x-free-calls-left": String(taken.left) });
      await free.fetch(new Request(`https://free/refund?n=${units}`, { method: "POST" }));
      return withHeaders(res, { "x-free-calls-left": String(taken.left + units) });
    }
  }
  // Free calls used up (or this is the paid-only route, or no free tier is bound in this environment).
  if (!paidOnly && !env.FREE) return deps.route(req);

  if (!payOk(env)) return fail(503, "payment_not_configured", "Paid calls are not set up on this server yet.");
  const full = String(BigInt(PRICE_AMOUNT) * BigInt(units));
  // Holder price: the claimed wallet's balance is read live on every quote, so the quote and the paid retry agree.
  const claimed = claimedHolder(req);
  const holder = claimed && holderConfig(env) && deps.isHolder ? ((await deps.isHolder(claimed)) ? claimed : null) : null;
  const requirements = requirementsFor(env.X402_PAY_TO!, holder ? holderAmount(full) : full);
  const header = req.headers.get("payment-signature");
  if (!header) {
    const what = mandate ? `a mandate (${units} calls)` : `${units} tokens`;
    return payment402(req.url, requirements, paidOnly ? "Payment required." : units > 1 ? `Not enough of the ${FREE_CALLS_PER_DAY} free calls for today are left for ${what}. Payment required.` : `The ${FREE_CALLS_PER_DAY} free calls for today are used. Payment required.`);
  }

  const payload = fromBase64(header);
  const problem = checkPayload(payload, requirements);
  if (problem) return payment402(req.url, requirements, problem);

  const facilitator: Facilitator = createFacilitator({ url: env.FACILITATOR_URL || DEFAULT_FACILITATOR, apiKey: env.PRIORS_API_KEY!, fetch: deps.fetch });
  const unavailable = () => fail(502, "payment_unavailable", "The payment service could not be reached. Nothing was charged.");
  try {
    const verified = await facilitator.verify(payload, requirements);
    if (!verified.isValid) return payment402(req.url, requirements, `Payment not valid: ${String(verified.invalidReason ?? "unknown").slice(0, 100)}`);
    // Checked before the gate runs and before anything settles: half price only from the holder's own wallet.
    if (holder && payerOf(payload, verified.payer) !== holder) {
      return payment402(req.url, requirementsFor(env.X402_PAY_TO!, full), `The holder price is only for payments from ${holder}. Pay the full price, or pay from that wallet.`);
    }

    const res = await deps.route(gateReq());
    if (!res.ok) return res; // the caller's mistake: nothing is settled

    // "settlement_pending" is not a failure: the transaction is out but not confirmed. Ask again with the SAME payload
    // (never ask the payer to sign again), a few short waits, about 5 s in total.
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let settled = await facilitator.settle(payload, requirements);
    for (const wait of PENDING_WAITS) {
      if (settled.success || settled.errorReason !== "settlement_pending") break;
      await sleep(wait);
      settled = await facilitator.settle(payload, requirements);
    }
    if (!settled.success && settled.errorReason === "settlement_pending") {
      return payment402(req.url, requirements, "Payment is still pending on chain. Do not sign again: send the same PAYMENT-SIGNATURE in a moment.");
    }
    if (!settled.success) return payment402(req.url, requirements, `Payment could not be settled: ${String(settled.errorReason ?? "unknown").slice(0, 100)}`);
    return withHeaders(res, {
      "payment-response": toBase64({ success: true, transaction: settled.transaction, network: settled.network ?? NETWORK, payer: settled.payer }),
    });
  } catch (err) {
    if (err instanceof FacilitatorUnavailable) return unavailable();
    throw err;
  }
}

// Free but limited tools: each has its own per-IP daily counter (a FreeTier object named "<name>:" + ip). A slot is
// given back unless the tool answered 2xx, so a bad request costs nothing.
type Limited = { name: string; limit: number; code: string; message: string };
async function meterLimited(req: Request, ip: string, env: MeterEnv, route: (req: Request) => Promise<Response>, l: Limited): Promise<Response | null> {
  if (!env.FREE) return null; // no counter in this environment
  const counter = env.FREE.get(env.FREE.idFromName(`${l.name}:${ip}`));
  const taken = (await (await counter.fetch(new Request(`https://free/take?limit=${l.limit}`, { method: "POST" }))).json()) as { ok: boolean };
  if (!taken.ok) return fail(429, l.code, l.message);
  const res = await route(req);
  if (!res.ok) await counter.fetch(new Request("https://free/refund", { method: "POST" }));
  return res;
}

// Free token check. The address is checked first, so a typo costs nothing; then one slot of this IP's verdict counter.
function meterVerdict(req: Request, address: string, ip: string, env: MeterEnv, route: (req: Request) => Promise<Response>): Promise<Response | null> {
  if (!ADDRESS.test(address)) return Promise.resolve(null); // the handler answers a bad address with a 400
  return meterLimited(req, ip, env, route, {
    name: "verdict", limit: VERDICT_CALLS_PER_DAY, code: "verdict_limit",
    message: `The ${VERDICT_CALLS_PER_DAY} free token checks for today are used. Try again tomorrow (UTC), or use POST /api/v1/gate.`,
  });
}

// One per caller IP (and one more per IP for token checks, named "verdict:" + ip). Storage: { day: "YYYY-MM-DD" (UTC), count }.
export class FreeTier {
  private storage: { get(k: string): Promise<any> | any; put(k: string, v: any): Promise<void> | void };
  private tail: Promise<unknown> = Promise.resolve();
  constructor(ctx: { storage: FreeTier["storage"] }) {
    this.storage = ctx.storage;
  }

  fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const refund = url.pathname === "/refund";
    // ?limit= (calls per day, default 25) and ?n= (slots to take or give back, default 1). Only our own worker calls this.
    const whole = (name: string, fallback: number, max: number) => {
      const v = Number(url.searchParams.get(name));
      return Number.isInteger(v) && v >= 1 ? Math.min(v, max) : fallback;
    };
    const limit = whole("limit", FREE_CALLS_PER_DAY, 10_000);
    const n = whole("n", 1, 100);
    const step = this.tail.then(async () => {
      const day = new Date(Date.now()).toISOString().slice(0, 10);
      const cur = (await this.storage.get("count")) as { day: string; count: number } | undefined;
      let count = cur && cur.day === day ? cur.count : 0;
      let ok = true;
      if (refund) count = Math.max(0, count - n);
      else if (count + n <= limit) count += n;
      else ok = false;
      await this.storage.put("count", { day, count });
      return Response.json({ ok, left: Math.max(0, limit - count) });
    });
    this.tail = step.catch(() => undefined);
    return step;
  }
}
