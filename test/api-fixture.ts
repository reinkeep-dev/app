// Shared setup for the API tests. A fresh app has its own random signing key, an in-memory payer history
// and a clock the test controls, so nothing depends on real time or on a key written anywhere.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MemoryGateStore, type GateStore } from "../api/src/gate-store.ts";
import { createHandler } from "../api/src/http-handler.ts";
import type { GateDeps } from "../api/src/gate-service.ts";
import { payerMessage } from "../api/src/payer-proof.ts";

export const T0 = 1_700_000_000_000; // ms
export const PAY_TO = "0xAbCdEf0000000000000000000000000000000001";
// Test payers are real keys (fixed, test-only), because a payer's history needs the payer's own signature (payer-proof.ts).
const PAYER_KEYS = ["0x" + "a1".repeat(32), "0x" + "b2".repeat(32), "0x" + "c3".repeat(32)] as const;
const PAYER_ACCOUNTS = PAYER_KEYS.map((k) => privateKeyToAccount(k as `0x${string}`));
export const [PAYER, PAYER_B, PAYER_C] = PAYER_ACCOUNTS.map((a) => a.address.toLowerCase());

// Adds payerSignature + issuedAt to a gate body whose payer is one of the test payers (any letter case), unless the
// body already has them or the payer is not ours. nowMs is the server clock the request will be judged at.
export async function withProof(body: Record<string, any>, nowMs: number): Promise<Record<string, any>> {
  if (typeof body.payer !== "string" || body.payerSignature !== undefined || typeof body.request !== "object") return body;
  const account = PAYER_ACCOUNTS.find((a) => a.address.toLowerCase() === body.payer.toLowerCase());
  if (!account) return body;
  const issuedAt = Math.floor(nowMs / 1000);
  const payerSignature = await account.signMessage({ message: payerMessage(body.payer, body.request, issuedAt) });
  return { ...body, issuedAt, payerSignature };
}
export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

export const goodRequest = (over: Record<string, unknown> = {}) => ({
  network: "eip155:4663",
  asset: USDG,
  amount: "10000", // $0.01
  decimals: 6,
  payTo: PAY_TO,
  resourceUrl: "https://api.example.com/v1/data",
  validForSeconds: 90,
  quotedAmount: "10000",
  ...over,
});

// A policy that already knows the recipient, so a small payment is a clean ALLOW.
export const knownPolicy = { allowPayTo: [PAY_TO] };

export type Reply = { status: number; headers: Headers; text: string; data: any };

export function makeApp(opts: { store?: GateStore | null; tokenFacts?: GateDeps["tokenFacts"]; collector?: GateDeps["collector"]; judge?: GateDeps["judge"] } = {}) {
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  const clock = { now: T0 };
  const store = opts.store === null ? undefined : (opts.store ?? new MemoryGateStore());
  const handle = createHandler({ account, now: () => clock.now, store, tokenFacts: opts.tokenFacts, collector: opts.collector, judge: opts.judge });

  async function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const init: RequestInit = { method, headers: { ...headers } };
    if (body !== undefined) {
      (init.headers as Record<string, string>)["content-type"] ??= "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const res = await handle(new Request("http://gate.test" + path, init));
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    return { status: res.status, headers: res.headers, text, data };
  }

  const gate = async (request: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    send("POST", "/api/v1/gate", await withProof({ request, ...extra }, clock.now));
  return { key, account, clock, handle, send, gate };
}
