// Pay for a Mandate in the Reinkeep token at half price; those tokens are burned (sent to 0x...dEaD).
// Same flow as Actuary's "pay a Mandate in $ACTUARY": the buyer approves Permit2 once, signs a PermitTransferFrom with
// our burner wallet as spender, and we submit Permit2.permitTransferFrom(to = dead) ourselves, paying the gas.
//
// Off until the owner sets, after the token launches:
//   BURN_TOKEN   var     the token's address
//   BURN_AMOUNT  var     tokens per mandate, in base units (whole number string, like HOLDER_MIN)
//   BURNER_KEY   secret  private key of a wallet used for nothing else, holding a little ETH for gas
//
// ponytail: fixed BURN_AMOUNT, not a market price. GeckoTerminal answers 429 to Cloudflare's addresses, so a live price
// is not reliable from the Worker. The owner re-sets BURN_AMOUNT when the price moves a lot; a price feed can come later.
// ponytail: two burns at the same instant use the same burner nonce and one fails (its buyer gets a 402, nothing is
// taken). Mandates are bought rarely; serialize through a Durable Object if that ever matters.
import { encodeFunctionData, parseAbi, verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { RpcClient } from "../../collector/src/contract-facts.ts";
import { NETWORK, X402_VERSION } from "./x402.ts";

export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export const DEAD = "0x000000000000000000000000000000000000dEaD";
export const BURN_SCHEME = "reinkeep-permit2";
export const CHAIN_ID = 4663;
export const BURN_TIMEOUT_S = 120; // a permit may be valid for at most 2 minutes
export const BURN_DISCOUNT_PCT = 50;

export type BurnEnv = { BURN_TOKEN?: string; BURN_AMOUNT?: string; BURNER_KEY?: string };
export type BurnConfig = { token: string; amount: string; account: PrivateKeyAccount };
export type BurnOffer = {
  scheme: typeof BURN_SCHEME; network: string; asset: string; amount: string; payTo: string; maxTimeoutSeconds: number;
  extra: { permit2: string; spender: string; percent: number; burn: true };
};
export type Permit = { owner: Hex; token: Hex; amount: bigint; nonce: bigint; deadline: bigint; signature: Hex };
export type SendResult = { ok: true; transaction: string } | { ok: false; reason: string };
export type TokenBurn = {
  offer: BurnOffer;
  check(payload: unknown, nowMs: number): Promise<Permit | string>;
  simulate(p: Permit): Promise<string | null>;
  send(p: Permit): Promise<SendResult>;
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const WHOLE = /^[1-9]\d{0,77}$/;
const KEY = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^\d{1,78}$/;
const HEX = /^0x[0-9a-fA-F]*$/;

export function burnConfig(env: BurnEnv): BurnConfig | null {
  const token = env.BURN_TOKEN?.trim() ?? "";
  const amount = env.BURN_AMOUNT?.trim() ?? "";
  // MetaMask's "export private key" shows 64 hex digits without 0x; accept both spellings.
  const raw = env.BURNER_KEY?.trim() ?? "";
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? "0x" + raw : raw;
  if (!ADDRESS.test(token) || !WHOLE.test(amount) || !KEY.test(key)) return null;
  try {
    return { token: token.toLowerCase(), amount, account: privateKeyToAccount(key as Hex) };
  } catch {
    return null;
  }
}

export const burnOffer = (cfg: BurnConfig): BurnOffer => ({
  scheme: BURN_SCHEME, network: NETWORK, asset: cfg.token, amount: cfg.amount, payTo: DEAD, maxTimeoutSeconds: BURN_TIMEOUT_S,
  extra: { permit2: PERMIT2, spender: cfg.account.address, percent: BURN_DISCOUNT_PCT, burn: true },
});

// True when the buyer chose the token option (the payload names our scheme), so metering takes this path.
export const isBurnPayload = (payload: unknown): boolean =>
  (payload as { accepted?: { scheme?: unknown } } | undefined)?.accepted?.scheme === BURN_SCHEME;

const PERMIT_TYPES = {
  PermitTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
} as const;
export const PERMIT2_DOMAIN = { name: "Permit2", chainId: CHAIN_ID, verifyingContract: PERMIT2 as Hex } as const;

// The typed data a buyer signs. Exported so tests (and docs) build exactly what we check.
export const permitTypedData = (p: { token: Hex; amount: bigint; spender: Hex; nonce: bigint; deadline: bigint }) => ({
  domain: PERMIT2_DOMAIN,
  types: PERMIT_TYPES,
  primaryType: "PermitTransferFrom" as const,
  message: { permitted: { token: p.token, amount: p.amount }, spender: p.spender, nonce: p.nonce, deadline: p.deadline },
});

const PERMIT2_ABI = parseAbi([
  "function permitTransferFrom(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount) transferDetails, address owner, bytes signature)",
]);

export const permitCallData = (p: Permit): Hex =>
  encodeFunctionData({
    abi: PERMIT2_ABI,
    functionName: "permitTransferFrom",
    args: [{ permitted: { token: p.token, amount: p.amount }, nonce: p.nonce, deadline: p.deadline }, { to: DEAD, requestedAmount: p.amount }, p.owner, p.signature],
  });

const short = (s: unknown) => String(s ?? "unknown").slice(0, 120);
const lower = (x: unknown) => (typeof x === "string" ? x.toLowerCase() : x);

// Everything that can be checked without the chain: the buyer echoed our offer, signed it for our burner, in time.
export async function checkBurnPayload(payload: unknown, offer: BurnOffer, nowMs: number): Promise<Permit | string> {
  if (typeof payload !== "object" || payload === null) return "payment payload is not an object";
  const p = payload as { x402Version?: unknown; accepted?: any; payload?: any };
  if (p.x402Version !== X402_VERSION) return "payment payload is not x402 version 2";
  const a = p.accepted;
  if (typeof a !== "object" || a === null) return "payment payload has no accepted option";
  if (a.scheme !== offer.scheme || a.network !== offer.network || lower(a.asset) !== offer.asset || a.amount !== offer.amount
    || lower(a.payTo) !== DEAD.toLowerCase() || a.maxTimeoutSeconds !== offer.maxTimeoutSeconds
    || lower(a.extra?.spender) !== offer.extra.spender.toLowerCase() || lower(a.extra?.permit2) !== PERMIT2.toLowerCase()) {
    return "accepted terms differ from the token offer";
  }
  const body = p.payload;
  const permit = body?.permit;
  const owner = body?.owner, sig = body?.signature;
  const token = permit?.permitted?.token, amount = permit?.permitted?.amount;
  const nonce = permit?.nonce, deadline = permit?.deadline;
  const uint = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) || (typeof v === "string" && UINT.test(v));
  if (!ADDRESS.test(String(owner)) || typeof sig !== "string" || !HEX.test(sig) || sig.length < 132) return "token payment needs owner, permit and signature";
  if (lower(token) !== offer.asset || String(amount) !== offer.amount) return "the permit is not for the offered token and amount";
  if (!uint(nonce) || !uint(deadline)) return "permit nonce and deadline must be whole numbers";
  const nowS = BigInt(Math.floor(nowMs / 1000));
  const dl = BigInt(deadline as string | number);
  if (dl <= nowS) return "the permit has expired";
  if (dl > nowS + BigInt(BURN_TIMEOUT_S) + 5n) return `the permit deadline is more than ${BURN_TIMEOUT_S} seconds away`;
  const out: Permit = { owner: owner as Hex, token: offer.asset as Hex, amount: BigInt(offer.amount), nonce: BigInt(nonce as string | number), deadline: dl, signature: sig as Hex };
  let valid = false;
  try {
    valid = await verifyTypedData({ address: out.owner, signature: out.signature, ...permitTypedData({ ...out, spender: offer.extra.spender as Hex }) });
  } catch {
    valid = false;
  }
  return valid ? out : "the permit signature is not the owner's, or was signed for another spender";
}

const RECEIPT_WAITS = [300, 500, 700, 1000, 1500, 2000]; // ms; Robinhood Chain makes blocks every ~0.25 s

export function createTokenBurn(rpc: RpcClient, cfg: BurnConfig, opts: { sleep?: (ms: number) => Promise<void> } = {}): TokenBurn {
  const offer = burnOffer(cfg);
  const from = cfg.account.address;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const call = async (method: string, params: unknown[]) => {
    const [r] = await rpc.batch([{ method, params }]);
    return r;
  };

  // An eth_estimateGas from our burner is the whole on-chain check: allowance, balance, used nonce and signature.
  async function simulate(p: Permit): Promise<string | null> {
    try {
      const r = await call("eth_estimateGas", [{ from, to: PERMIT2, data: permitCallData(p) }]);
      return r.ok ? null : `would fail on chain: ${short(r.message)}`;
    } catch {
      return "the chain node could not be reached";
    }
  }

  async function send(p: Permit): Promise<SendResult> {
    try {
      const data = permitCallData(p);
      const [nonce, price, gas] = await rpc.batch([
        { method: "eth_getTransactionCount", params: [from, "pending"] },
        { method: "eth_gasPrice", params: [] },
        { method: "eth_estimateGas", params: [{ from, to: PERMIT2, data }] },
      ]);
      if (!nonce.ok || !price.ok) return { ok: false, reason: "the chain node did not answer" };
      if (!gas.ok) return { ok: false, reason: `would fail on chain: ${short(gas.message)}` };
      if (typeof price.value !== "string" || !/^0x[0-9a-fA-F]+$/.test(price.value)) return { ok: false, reason: "the chain node did not answer" };
      const gasPrice = BigInt(price.value);
      const raw = await cfg.account.signTransaction({
        type: "eip1559", chainId: CHAIN_ID, nonce: Number(BigInt(String(nonce.value))), to: PERMIT2 as Hex, data, value: 0n,
        gas: (BigInt(String(gas.value)) * 12n) / 10n, maxFeePerGas: gasPrice * 2n + 1n, maxPriorityFeePerGas: 0n,
      });
      const sent = await call("eth_sendRawTransaction", [raw]);
      if (!sent.ok || typeof sent.value !== "string") return { ok: false, reason: `not sent: ${short(sent.ok ? "no hash" : sent.message)}` };
      const hash = sent.value;
      for (const wait of RECEIPT_WAITS) {
        await sleep(wait);
        const r = await call("eth_getTransactionReceipt", [hash]);
        const status = r.ok ? (r.value as { status?: unknown } | null)?.status : undefined;
        if (status === "0x1") return { ok: true, transaction: hash };
        if (status === "0x0") return { ok: false, reason: `the burn transaction failed on chain (${hash})` };
      }
      // Out but not confirmed within ~6 s: the signed permit is spent once it lands, so the buyer must not sign again.
      return { ok: true, transaction: hash };
    } catch (err) {
      console.error("token burn failed", err instanceof Error ? err.message.slice(0, 120) : "unknown");
      return { ok: false, reason: "the burn could not be sent" };
    }
  }

  return { offer, check: (payload, nowMs) => checkBurnPayload(payload, offer, nowMs), simulate, send };
}
