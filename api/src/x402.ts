// x402 v2 pieces for the paid gate call: the price, the 402 answer, a check of the buyer's payment payload, and a small
// hand-written client for the Priors facilitator (verify, settle). No SDK: only fetch, so tests can hand in a fake.
// Wire shapes follow @x402/core v2: POST {x402Version, paymentPayload, paymentRequirements} to /verify and /settle;
// verify answers { isValid, invalidReason?, payer? }, settle answers { success, errorReason?, transaction, network, payer? }.

export const X402_VERSION = 2;
export const NETWORK = "eip155:4663";
export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const PRICE_AMOUNT = "10000"; // 6 decimals, so $0.01
export const PRICE_USD = 0.01;
export const FREE_CALLS_PER_DAY = 25;
export const VERDICT_CALLS_PER_DAY = 60; // free token checks (GET /api/v1/verdict/{address}) per caller IP per UTC day
export const PREMORTEM_CALLS_PER_DAY = 60; // free pre-mortems (POST /api/v1/premortem) per caller IP per UTC day
export const DATA_CALLS_PER_DAY = 300; // free launch-data reads (odds, board, radar, autopsy) per caller IP per UTC day
export const DEFAULT_FACILITATOR = "https://facilitator.priors.trade";

export type Requirements = {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
};

export type VerifyResult = { isValid: boolean; invalidReason?: string; payer?: string };
export type SettleResult = { success: boolean; errorReason?: string; transaction?: string; network?: string; payer?: string };

export interface Facilitator {
  verify(paymentPayload: unknown, requirements: Requirements): Promise<VerifyResult>;
  settle(paymentPayload: unknown, requirements: Requirements): Promise<SettleResult>;
}

// Thrown when the facilitator cannot be reached or answers something we do not understand. Carries no upstream text.
export class FacilitatorUnavailable extends Error {}

// `amount` defaults to the price of one call; a batch of N tokens asks for N times that.
export function requirementsFor(payTo: string, amount: string = PRICE_AMOUNT): Requirements {
  return { scheme: "exact", network: NETWORK, amount, asset: USDG, payTo, maxTimeoutSeconds: 60, extra: { name: "Global Dollar", version: "1" } };
}

export const toBase64 = (value: unknown): string => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));

export function fromBase64(text: string): unknown {
  try {
    const bin = atob(text.trim());
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return undefined;
  }
}

export function paymentRequired(url: string, requirements: Requirements, error: string) {
  return {
    x402Version: X402_VERSION,
    error,
    resource: { url, description: "Reinkeep gate: one pre-payment check with a signed receipt", mimeType: "application/json" },
    accepts: [requirements],
  };
}

// The payload the buyer signed names the requirements it accepted. They must be exactly ours.
// Returns null when fine, else a short reason.
export function checkPayload(payload: unknown, ours: Requirements): string | null {
  if (typeof payload !== "object" || payload === null) return "payment payload is not an object";
  const p = payload as { x402Version?: unknown; accepted?: unknown };
  if (p.x402Version !== X402_VERSION) return "payment payload is not x402 version 2";
  const a = p.accepted as Record<string, unknown> | undefined;
  if (typeof a !== "object" || a === null) return "payment payload has no accepted requirements";
  const same = (x: unknown, y: string) => typeof x === "string" && x.toLowerCase() === y.toLowerCase();
  if (a.scheme !== ours.scheme) return "wrong scheme";
  if (a.network !== ours.network) return "wrong network";
  if (!same(a.asset, ours.asset)) return "wrong asset";
  if (a.amount !== ours.amount) return "wrong amount";
  if (!same(a.payTo, ours.payTo)) return "wrong payTo";
  // The buyer must echo the entry we issued verbatim; it is also exactly what the facilitator gets.
  const extra = a.extra as { name?: unknown; version?: unknown } | undefined;
  if (a.maxTimeoutSeconds !== ours.maxTimeoutSeconds || extra?.name !== ours.extra.name || extra?.version !== ours.extra.version) return "accepted terms differ from the offer";
  return null;
}

export function createFacilitator(opts: { url: string; apiKey: string; fetch: typeof fetch; timeoutMs?: number }): Facilitator {
  const base = opts.url.replace(/\/+$/, "");
  async function call(path: "/verify" | "/settle", paymentPayload: unknown, requirements: Requirements, marker: "isValid" | "success"): Promise<any> {
    let data: unknown;
    try {
      const res = await opts.fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({ x402Version: X402_VERSION, paymentPayload, paymentRequirements: requirements }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
      data = await res.json();
    } catch {
      throw new FacilitatorUnavailable("facilitator unreachable");
    }
    // A refusal can come with a 4xx status but the normal body; anything without the marker field is an outage.
    if (typeof data !== "object" || data === null || !(marker in data)) throw new FacilitatorUnavailable("facilitator answered unexpectedly");
    return data;
  }
  return {
    verify: (p, r) => call("/verify", p, r, "isValid"),
    settle: (p, r) => call("/settle", p, r, "success"),
  };
}
