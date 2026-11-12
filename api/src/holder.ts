// Holder price: wallets holding at least HOLDER_MIN of the Reinkeep token pay half for paid calls (gate, batch, mandates).
// Off until the owner sets HOLDER_TOKEN (the token's address) and HOLDER_MIN (whole base units, as a string), since
// the token is not launched yet. The free tier is the same for everyone.
//
// How a caller claims it: send header `x-holder: <your address>`. We read balanceOf(address) on the token, live, on the
// 402 quote and again on the paid retry, and quote half when it is enough. The payment must then come from that same
// address (the payer the facilitator reports, else the signed authorization's `from`), or anyone could name a whale's
// wallet and pay half. A failed balance read is "not a holder": full price, never a guess.
//
// Anyone can check a wallet first: GET /api/v1/gate/holder?address=0x... (same as Actuary's).
// Paying a mandate in the token at half price, burned, is token-burn.ts.
import { encodeFunctionData, parseAbi } from "viem";
import type { RpcClient } from "../../collector/src/contract-facts.ts";

export const HOLDER_DISCOUNT_PCT = 50;
export const HOLDER_HEADER = "x-holder";
export type HolderConfig = { token: string; minBalance: bigint };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const WHOLE = /^[1-9]\d{0,77}$/;

export function holderConfig(env: { HOLDER_TOKEN?: string; HOLDER_MIN?: string }): HolderConfig | null {
  const token = env.HOLDER_TOKEN?.trim() ?? "";
  const min = env.HOLDER_MIN?.trim() ?? "";
  if (!ADDRESS.test(token) || !WHOLE.test(min)) return null;
  return { token: token.toLowerCase(), minBalance: BigInt(min) };
}

export const claimedHolder = (req: Request): string | null => {
  const v = req.headers.get(HOLDER_HEADER)?.trim() ?? "";
  return ADDRESS.test(v) ? v.toLowerCase() : null;
};

export const holderAmount = (amount: string): string => String((BigInt(amount) * BigInt(100 - HOLDER_DISCOUNT_PCT)) / 100n);

const BALANCE_OF = parseAbi(["function balanceOf(address) view returns (uint256)"]);

// The token balance in base units, read live; null when the read failed or made no sense.
export function holderBalance(rpc: RpcClient, cfg: HolderConfig): (address: string) => Promise<bigint | null> {
  return async (address) => {
    try {
      const data = encodeFunctionData({ abi: BALANCE_OF, functionName: "balanceOf", args: [address as `0x${string}`] });
      const [r] = await rpc.batch([{ method: "eth_call", params: [{ to: cfg.token, data }, "latest"] }]);
      if (!r.ok || typeof r.value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(r.value)) return null;
      return BigInt(r.value);
    } catch (err) {
      console.error("holder balance read failed", err instanceof Error ? err.message : "unknown");
      return null;
    }
  };
}

// true when the balance is at least the minimum; false when lower, or when the read failed or made no sense.
export function holderCheck(rpc: RpcClient, cfg: HolderConfig): (address: string) => Promise<boolean> {
  const balance = holderBalance(rpc, cfg);
  return async (address) => {
    const b = await balance(address);
    return b !== null && b >= cfg.minBalance;
  };
}

// Who paid: the facilitator's word first, else the `from` of the signed EIP-3009 authorization in the payload.
export function payerOf(payload: unknown, verifiedPayer?: string): string | null {
  if (typeof verifiedPayer === "string" && ADDRESS.test(verifiedPayer)) return verifiedPayer.toLowerCase();
  const from = (payload as { payload?: { authorization?: { from?: unknown } } } | undefined)?.payload?.authorization?.from;
  return typeof from === "string" && ADDRESS.test(from) ? from.toLowerCase() : null;
}
