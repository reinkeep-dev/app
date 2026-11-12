// Shared setup for the API tests. A fresh app has its own random signing key, an in-memory payer history
// and a clock the test controls, so nothing depends on real time or on a key written anywhere.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MemoryGateStore, type GateStore } from "../api/src/gate-store.ts";
import { createHandler } from "../api/src/http-handler.ts";
import type { GateDeps } from "../api/src/gate-service.ts";

export const T0 = 1_700_000_000_000; // ms
export const PAY_TO = "0xAbCdEf0000000000000000000000000000000001";
export const PAYER = "0x00000000000000000000000000000000000000a1";
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

  const gate = (request: Record<string, unknown>, extra: Record<string, unknown> = {}) => send("POST", "/api/v1/gate", { request, ...extra });
  return { key, account, clock, handle, send, gate };
}
