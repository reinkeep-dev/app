// Holder price (api/src/holder.ts + metering.ts): half price for wallets holding enough of the Reinkeep token.
// Fake facilitator and fake balance reader, no network.
import assert from "node:assert/strict";
import test from "node:test";
import { meter, pricing } from "../api/src/metering.ts";
import { holderAmount, holderCheck, holderConfig, payerOf } from "../api/src/holder.ts";
import { fromBase64, toBase64 } from "../api/src/x402.ts";
import { USDG } from "./api-fixture.ts";

const OWNER = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x" + "7".repeat(40);
const WHALE = "0x" + "a".repeat(40);
const OTHER = "0x" + "b".repeat(40);
const env = { X402_PAY_TO: OWNER, PRIORS_API_KEY: "k", HOLDER_TOKEN: TOKEN, HOLDER_MIN: "1000000" };

const payload = (amount: string, from = WHALE) => ({
  x402Version: 2,
  accepted: { scheme: "exact", network: "eip155:4663", asset: USDG, amount, payTo: OWNER, maxTimeoutSeconds: 60, extra: { name: "Global Dollar", version: "1" } },
  payload: { signature: "0xsig", authorization: { from } },
});

function setup(holders: string[], verifiedPayer?: string) {
  const routed: string[] = [];
  const settled: any[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const b = JSON.parse(String(init.body));
    if (path === "/verify") return Response.json({ isValid: true, ...(verifiedPayer ? { payer: verifiedPayer } : {}) });
    settled.push(b.paymentRequirements ?? b);
    return Response.json({ success: true, transaction: "0xabc", network: "eip155:4663" });
  }) as unknown as typeof globalThis.fetch;
  const reads: string[] = [];
  const isHolder = async (a: string) => (reads.push(a), holders.includes(a));
  const route = async (r: Request) => (routed.push(new URL(r.url).pathname), Response.json({ ok: true }));
  const send = (headers: Record<string, string>, e: Record<string, string> = env) =>
    meter(new Request("https://gate.test/api/v1/gate/x402", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" }), e as any, { route, fetch, isHolder });
  return { send, routed, settled, reads };
}

const quote = async (res: Response | null) => (fromBase64(res!.headers.get("payment-required")!) as any).accepts[0].amount;

test("config: off unless both a token address and a whole minimum are set", () => {
  assert.equal(holderConfig({}), null);
  assert.equal(holderConfig({ HOLDER_TOKEN: TOKEN }), null);
  assert.equal(holderConfig({ HOLDER_TOKEN: "0x12", HOLDER_MIN: "5" }), null);
  assert.equal(holderConfig({ HOLDER_TOKEN: TOKEN, HOLDER_MIN: "1.5" }), null);
  assert.deepEqual(holderConfig({ HOLDER_TOKEN: TOKEN.toUpperCase().replace("0X", "0x"), HOLDER_MIN: "1000000" }), { token: TOKEN, minBalance: 1_000_000n });
  assert.equal(holderAmount("10000"), "5000");
  assert.equal(holderAmount("50000"), "25000");
});

test("quote: a holder is offered half, anyone else (or a bad header) the full price", async () => {
  const s = setup([WHALE]);
  assert.equal(await quote(await s.send({ "x-holder": WHALE })), "5000");
  assert.equal(await quote(await s.send({ "x-holder": OTHER })), "10000");
  assert.equal(await quote(await s.send({ "x-holder": "me" })), "10000");
  assert.equal(await quote(await s.send({})), "10000");
  assert.deepEqual(s.reads, [WHALE, OTHER], "no balance read without a valid claim");
  assert.equal(await quote(await s.send({ "x-holder": WHALE }, { X402_PAY_TO: OWNER, PRIORS_API_KEY: "k" })), "10000", "off without HOLDER_TOKEN");
});

test("paid: half price settles only when the payer is the holder; a borrowed whale address gets nothing run", async () => {
  const s = setup([WHALE], WHALE);
  const ok = await s.send({ "x-holder": WHALE, "payment-signature": toBase64(payload("5000")) });
  assert.equal(ok!.status, 200);
  assert.equal(s.routed.length, 1);

  const thief = setup([WHALE], OTHER);
  const r = await thief.send({ "x-holder": WHALE, "payment-signature": toBase64(payload("5000", OTHER)) });
  assert.equal(r!.status, 402);
  assert.match((await r!.json()).error, /only for payments from/);
  assert.equal(await quote(r), "10000", "the refusal quotes the full price");
  assert.deepEqual([thief.routed.length, thief.settled.length], [0, 0], "gate not run, nothing settled");

  const noWord = setup([WHALE]); // facilitator names no payer: the signed authorization's from is used
  assert.equal((await noWord.send({ "x-holder": WHALE, "payment-signature": toBase64(payload("5000", WHALE)) }))!.status, 200);
  assert.equal(payerOf({ payload: { authorization: {} } }), null);
});

test("paid: a holder who sold between quote and payment is asked for the full price", async () => {
  const s = setup([], WHALE);
  const r = await s.send({ "x-holder": WHALE, "payment-signature": toBase64(payload("5000")) });
  assert.equal(r!.status, 402);
  assert.equal(await quote(r), "10000");
});

test("balance read: enough, too little, failed read and junk all decided without guessing", async () => {
  const rpc = (value: unknown, ok = true) => ({ batch: async (calls: any[]) => (calls.length && calls[0].params[0].to === TOKEN ? [ok ? { ok: true as const, value } : { ok: false as const, code: -32000, message: "x" }] : []) });
  const cfg = holderConfig(env)!;
  assert.equal(await holderCheck(rpc("0x" + (1_000_000).toString(16)), cfg)(WHALE), true);
  assert.equal(await holderCheck(rpc("0x" + (999_999).toString(16)), cfg)(WHALE), false);
  assert.equal(await holderCheck(rpc(null, false), cfg)(WHALE), false);
  assert.equal(await holderCheck(rpc("hello"), cfg)(WHALE), false);
  assert.equal(await holderCheck({ batch: async () => { throw new Error("down"); } }, cfg)(WHALE), false);
});

test("pricing shows the holder price only when configured", async () => {
  assert.equal((await pricing({ X402_PAY_TO: OWNER }).json() as any).holder, null);
  const h = (await pricing(env).json() as any).holder;
  assert.deepEqual(h, { token: TOKEN, minBalance: "1000000", discountPct: 50, amount: "5000", header: "x-holder" });
});
