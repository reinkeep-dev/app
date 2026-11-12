// Pay a mandate in the Reinkeep token at half price, burned (api/src/token-burn.ts + metering.ts), and the holder check
// endpoint. Permits are signed for real with viem keys and checked with the real EIP-712 code; the chain node is fake.
import assert from "node:assert/strict";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { meter, pricing } from "../api/src/metering.ts";
import { holderBalance, holderConfig } from "../api/src/holder.ts";
import {
  BURN_SCHEME, DEAD, PERMIT2, burnConfig, checkBurnPayload, createTokenBurn, isBurnPayload, permitCallData, permitTypedData,
  type Permit, type TokenBurn,
} from "../api/src/token-burn.ts";
import { fromBase64, toBase64 } from "../api/src/x402.ts";

const TOKEN = "0x" + "7".repeat(40);
const OWNER = "0x1111111111111111111111111111111111111111";
const NOW = Date.UTC(2026, 10, 12, 12);
const burnerKey = generatePrivateKey();
const buyer = privateKeyToAccount(generatePrivateKey());
const cfg = burnConfig({ BURN_TOKEN: TOKEN, BURN_AMOUNT: "2500000000000000000000", BURNER_KEY: burnerKey })!;

async function signed(over: { amount?: bigint; spender?: string; deadlineS?: number; nonce?: bigint; signer?: typeof buyer; accepted?: Record<string, unknown> } = {}) {
  const offer = createTokenBurn({ batch: async () => [] }, cfg).offer;
  const amount = over.amount ?? BigInt(offer.amount);
  const deadline = BigInt(over.deadlineS ?? Math.floor(NOW / 1000) + 90);
  const nonce = over.nonce ?? 42n;
  const signer = over.signer ?? buyer;
  const signature = await signer.signTypedData(permitTypedData({ token: TOKEN as `0x${string}`, amount, spender: (over.spender ?? offer.extra.spender) as `0x${string}`, nonce, deadline }));
  return {
    x402Version: 2,
    accepted: { ...offer, ...over.accepted },
    payload: { owner: buyer.address, permit: { permitted: { token: TOKEN, amount: String(amount) }, nonce: String(nonce), deadline: String(deadline) }, signature },
  };
}

test("config: off unless token, amount and a real key are all set", () => {
  assert.equal(burnConfig({}), null);
  assert.equal(burnConfig({ BURN_TOKEN: TOKEN, BURN_AMOUNT: "5" }), null, "no key");
  assert.equal(burnConfig({ BURN_TOKEN: TOKEN, BURN_AMOUNT: "1.5", BURNER_KEY: burnerKey }), null);
  assert.equal(burnConfig({ BURN_TOKEN: "0x12", BURN_AMOUNT: "5", BURNER_KEY: burnerKey }), null);
  assert.equal(burnConfig({ BURN_TOKEN: TOKEN, BURN_AMOUNT: "5", BURNER_KEY: "0x1234" }), null);
  assert.equal(cfg.account.address, privateKeyToAccount(burnerKey).address);
  const metamaskStyle = burnConfig({ BURN_TOKEN: TOKEN, BURN_AMOUNT: "5", BURNER_KEY: ` ${burnerKey.slice(2)}\n` });
  assert.equal(metamaskStyle?.account.address, cfg.account.address, "a key pasted from MetaMask (no 0x, stray spaces) works");
  const offer = createTokenBurn({ batch: async () => [] }, cfg).offer;
  assert.deepEqual(
    { scheme: offer.scheme, payTo: offer.payTo, permit2: offer.extra.permit2, burn: offer.extra.burn, timeout: offer.maxTimeoutSeconds },
    { scheme: BURN_SCHEME, payTo: DEAD, permit2: PERMIT2, burn: true, timeout: 120 },
  );
});

test("permit check: a real signature for our burner passes; every way of cheating is refused", async () => {
  const offer = createTokenBurn({ batch: async () => [] }, cfg).offer;
  const ok = await checkBurnPayload(await signed(), offer, NOW);
  assert.equal(typeof ok, "object", String(ok));
  assert.equal((ok as Permit).owner, buyer.address);

  const why = async (p: unknown) => (await checkBurnPayload(p, offer, NOW)) as string;
  assert.match(await why(await signed({ amount: 1n })), /not for the offered token and amount/);
  assert.match(await why(await signed({ spender: OWNER })), /signature/, "signed for someone else's spender");
  assert.match(await why(await signed({ signer: privateKeyToAccount(generatePrivateKey()) })), /signature/, "signed by another wallet than owner");
  assert.match(await why(await signed({ deadlineS: Math.floor(NOW / 1000) - 1 })), /expired/);
  assert.match(await why(await signed({ deadlineS: Math.floor(NOW / 1000) + 3600 })), /more than 120 seconds/);
  assert.match(await why(await signed({ accepted: { payTo: OWNER } })), /differ from the token offer/, "burn redirected to a wallet");
  assert.match(await why(await signed({ accepted: { amount: "1" } })), /differ from the token offer/);
  const tampered = await signed();
  // Change one hex digit inside r (the last byte, v, has equivalent spellings, so it is not a fair tamper).
  const sig = tampered.payload.signature;
  tampered.payload.signature = (sig.slice(0, 20) + (sig[20] === "a" ? "b" : "a") + sig.slice(21)) as `0x${string}`;
  assert.match(await why(tampered), /signature/);
  assert.match(await why({ x402Version: 1 }), /version 2/);
  assert.equal(isBurnPayload(await signed()), true);
  assert.equal(isBurnPayload({ accepted: { scheme: "exact" } }), false);
});

// ---- metering: mandates only, dry run before anything, burn after the mandate is made ----------------------------------

const noFree = { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ ok: false, left: 0 }) }) };

function setup(o: { simulate?: string | null; send?: { ok: true; transaction: string } | { ok: false; reason: string }; routeStatus?: number; env?: Record<string, unknown> } = {}) {
  const real = createTokenBurn({ batch: async () => [] }, cfg);
  const calls: string[] = [];
  const burn: TokenBurn = {
    offer: real.offer,
    check: real.check,
    simulate: async () => (calls.push("simulate"), o.simulate ?? null),
    send: async () => (calls.push("send"), o.send ?? { ok: true, transaction: "0xburn" }),
  };
  const route = async (r: Request) => (calls.push("route " + new URL(r.url).pathname), new Response("{}", { status: o.routeStatus ?? 200 }));
  const env = { FREE: noFree, X402_PAY_TO: OWNER, PRIORS_API_KEY: "k", ...o.env };
  const send = (path: string, headers: Record<string, string> = {}) =>
    meter(new Request("https://gate.test" + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" }), env as any, {
      route, fetch: (async () => { throw new Error("facilitator must not be called"); }) as any, burn, now: () => NOW,
    });
  return { send, calls };
}

test("402 for a mandate offers the token option next to USDG; a gate call does not", async () => {
  const s = setup();
  const m = await s.send("/api/v1/mandates");
  assert.equal(m!.status, 402);
  const body = fromBase64(m!.headers.get("payment-required")!) as any;
  assert.equal(body.accepts.length, 1, "USDG is still offered");
  assert.equal(body.token_option.scheme, BURN_SCHEME);
  assert.equal(body.token_option.payTo, DEAD);
  const g = await s.send("/api/v1/gate");
  assert.equal((fromBase64(g!.headers.get("payment-required")!) as any).token_option, undefined);
  assert.equal((await s.send("/api/v1/mandates/md_" + "0".repeat(32) + "/renew"))!.status, 402, "a renewal can be paid in the token too");
});

test("token payment: checked, dry-run, mandate made, then burned; payment-response names the burn", async () => {
  const s = setup();
  const r = await s.send("/api/v1/mandates", { "payment-signature": toBase64(await signed()) });
  assert.equal(r!.status, 200);
  assert.deepEqual(s.calls, ["simulate", "route /api/v1/mandates", "send"]);
  const pr = fromBase64(r!.headers.get("payment-response")!) as any;
  assert.deepEqual({ tx: pr.transaction, payer: pr.payer, to: pr.burned.to, amount: pr.burned.amount }, { tx: "0xburn", payer: buyer.address.toLowerCase(), to: DEAD, amount: cfg.amount });
});

test("token payment: a failing dry run takes nothing and makes no mandate", async () => {
  const s = setup({ simulate: "would fail on chain: TRANSFER_FROM_FAILED" });
  const r = await s.send("/api/v1/mandates", { "payment-signature": toBase64(await signed()) });
  assert.equal(r!.status, 402);
  assert.match((await r!.json()).error, /TRANSFER_FROM_FAILED.*Nothing was taken/);
  assert.deepEqual(s.calls, ["simulate"]);
});

test("token payment: a bad request is not burned; a failed burn is a 402", async () => {
  const bad = setup({ routeStatus: 400 });
  assert.equal((await bad.send("/api/v1/mandates", { "payment-signature": toBase64(await signed()) }))!.status, 400);
  assert.deepEqual(bad.calls, ["simulate", "route /api/v1/mandates"], "no burn for the caller's mistake");
  const failed = setup({ send: { ok: false, reason: "not sent: nonce too low" } });
  const r = await failed.send("/api/v1/mandates", { "payment-signature": toBase64(await signed()) });
  assert.equal(r!.status, 402);
  assert.match((await r!.json()).error, /nonce too low/);
});

test("token payment is for mandates only, and off means off", async () => {
  const s = setup();
  const g = await s.send("/api/v1/gate", { "payment-signature": toBase64(await signed()) });
  assert.equal(g!.status, 402, "a gate call never takes the token path");
  assert.match((await g!.json()).error, /wrong scheme/);
  assert.deepEqual(s.calls, []);
  // Token only (no USDG set up): the mandate quote still offers the token.
  const only = setup({ env: { X402_PAY_TO: undefined, PRIORS_API_KEY: undefined } });
  const q = await only.send("/api/v1/mandates");
  assert.equal(q!.status, 402);
  const body = fromBase64(q!.headers.get("payment-required")!) as any;
  assert.deepEqual(body.accepts, []);
  assert.equal(body.token_option.scheme, BURN_SCHEME);
  assert.equal((await only.send("/api/v1/gate"))!.status, 503, "gate calls still need USDG");
});

test("pricing lists the token option only when configured", async () => {
  assert.equal((await pricing({ X402_PAY_TO: OWNER }).json() as any).tokenBurn, null);
  const t = (await pricing({ X402_PAY_TO: OWNER, BURN_TOKEN: TOKEN, BURN_AMOUNT: cfg.amount, BURNER_KEY: burnerKey }).json() as any).tokenBurn;
  assert.deepEqual(t, { appliesTo: "mandates", token: TOKEN, amount: cfg.amount, discountPct: 50, payTo: DEAD, permit2: PERMIT2, spender: cfg.account.address });
});

// ---- the burner talking to a (fake) chain node ------------------------------------------------------------------------

function node(o: { estimate?: { ok: boolean; message?: string }; receipts?: (string | null)[]; sendError?: string } = {}) {
  const seen: { method: string; params: unknown[] }[] = [];
  const receipts = [...(o.receipts ?? ["0x1"])];
  return {
    seen,
    rpc: {
      batch: async (calls: { method: string; params: unknown[] }[]) => calls.map((c) => {
        seen.push(c);
        switch (c.method) {
          case "eth_estimateGas": return o.estimate && !o.estimate.ok ? { ok: false as const, code: 3, message: o.estimate.message ?? "execution reverted" } : { ok: true as const, value: "0x186a0" };
          case "eth_getTransactionCount": return { ok: true as const, value: "0x7" };
          case "eth_gasPrice": return { ok: true as const, value: "0x989680" };
          case "eth_sendRawTransaction": return o.sendError ? { ok: false as const, code: -32000, message: o.sendError } : { ok: true as const, value: "0xhash" };
          case "eth_getTransactionReceipt": { const s = receipts.shift(); return { ok: true as const, value: s === null || s === undefined ? null : { status: s } }; }
          default: return { ok: false as const, code: -1, message: "unexpected " + c.method };
        }
      }),
    },
  };
}

test("burner: dry run is an eth_estimateGas from our burner to Permit2 with the burn call", async () => {
  const permit = (await checkBurnPayload(await signed(), createTokenBurn({ batch: async () => [] }, cfg).offer, NOW)) as Permit;
  const n = node();
  assert.equal(await createTokenBurn(n.rpc, cfg).simulate(permit), null);
  const call = n.seen[0].params[0] as { from: string; to: string; data: string };
  assert.deepEqual({ from: call.from, to: call.to, data: call.data }, { from: cfg.account.address, to: PERMIT2, data: permitCallData(permit) });
  const reverted = node({ estimate: { ok: false, message: "execution reverted: TRANSFER_FROM_FAILED" } });
  assert.match((await createTokenBurn(reverted.rpc, cfg).simulate(permit))!, /TRANSFER_FROM_FAILED/);
});

test("burner: signs a transaction for chain 4663 from its own nonce, waits for the receipt", async () => {
  const permit = (await checkBurnPayload(await signed(), createTokenBurn({ batch: async () => [] }, cfg).offer, NOW)) as Permit;
  const n = node({ receipts: [null, "0x1"] });
  const r = await createTokenBurn(n.rpc, cfg, { sleep: async () => {} }).send(permit);
  assert.deepEqual(r, { ok: true, transaction: "0xhash" });
  const raw = n.seen.find((c) => c.method === "eth_sendRawTransaction")!.params[0] as string;
  const { parseTransaction, recoverTransactionAddress } = await import("viem");
  const tx = parseTransaction(raw as `0x${string}`);
  assert.deepEqual({ chainId: tx.chainId, nonce: tx.nonce, to: tx.to?.toLowerCase(), data: tx.data }, { chainId: 4663, nonce: 7, to: PERMIT2.toLowerCase(), data: permitCallData(permit) });
  assert.equal(await recoverTransactionAddress({ serializedTransaction: raw as any }), cfg.account.address);

  assert.deepEqual(await createTokenBurn(node({ receipts: ["0x0"] }).rpc, cfg, { sleep: async () => {} }).send(permit), { ok: false, reason: "the burn transaction failed on chain (0xhash)" });
  assert.match((await createTokenBurn(node({ sendError: "nonce too low" }).rpc, cfg, { sleep: async () => {} }).send(permit) as any).reason, /nonce too low/);
});

// ---- holder check endpoint -----------------------------------------------------------------------------------------------

test("GET /gate/holder: balance and verdict for a wallet; off before launch; bad address is a 400", async () => {
  const env = { HOLDER_TOKEN: TOKEN, HOLDER_MIN: "1000000" };
  const balances: Record<string, bigint | null> = { [OWNER]: 1_000_000n, ["0x" + "b".repeat(40)]: 5n, ["0x" + "c".repeat(40)]: null };
  const get = (q: string, e: Record<string, unknown> = env, withBalance = true) =>
    meter(new Request("https://gate.test/api/v1/gate/holder" + q), e as any, {
      route: async () => new Response("no"), fetch: fetch, holderBalance: withBalance ? async (a) => (a.toLowerCase() in balances ? balances[a.toLowerCase()] : 0n) : undefined,
    });
  const yes = await (await get("?address=" + OWNER))!.json() as any;
  assert.deepEqual(yes, { token: TOKEN, network: "eip155:4663", discountPct: 50, minBalance: "1000000", address: OWNER, balance: "1000000", holder: true });
  assert.equal((await (await get("?address=0x" + "b".repeat(40)))!.json() as any).holder, false);
  assert.equal((await get("?address=0x" + "c".repeat(40)))!.status, 502, "a failed read is said, never guessed");
  assert.equal((await get("?address=me"))!.status, 400);
  assert.equal((await get("?address=" + OWNER, {}, false))!.status, 404);

  const rpc = { batch: async () => [{ ok: true as const, value: "0x" + (1234).toString(16) }] };
  assert.equal(await holderBalance(rpc, holderConfig(env)!)(OWNER), 1234n);
  assert.equal(await holderBalance({ batch: async () => [{ ok: false as const, code: 1, message: "x" }] }, holderConfig(env)!)(OWNER), null);
});
