// The "fact sheet" for one token: what the gate's token rules will read. Plain snake_case fields, like the policy facts.
// null always means "unknown", never "no". A rule that reads a null fact must send the token to REVIEW, not ALLOW.
import type { PoolRecord, TokenRecord } from "./types.ts";

export type TokenFacts = {
  token: string;
  ticker: string | null;
  // from the chain (null until the contract has been read)
  facts_read_at_ms: number | null;
  is_contract: boolean | null;
  is_proxy: boolean | null;
  has_mint: boolean | null;
  has_pause: boolean | null;
  has_blacklist: boolean | null;
  has_upgrade: boolean | null;
  has_owner_function: boolean | null;
  owner_renounced: boolean | null;
  mint_with_live_owner: boolean | null;
  total_supply: string | null;
  decimals: number | null;
  // from our first look at its pools
  pool_count: number;
  seen_age_minutes: number | null; // how old the earliest pool was when we first saw it
  seen_liquidity_usd: number | null; // the largest first-seen liquidity across its pools
  seen_volume_usd: number | null;
  seen_swaps: number | null;
  liquidity_not_reported: boolean | null;
  // copies
  ticker_uses: number | null; // how many different tokens carry this ticker (this one included)
  ticker_clone_of_older: boolean | null; // an older token already used the same ticker
};

const sum = (xs: (number | null)[]): number | null => {
  const known = xs.filter((x): x is number => x !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};

export function buildTokenFacts(token: TokenRecord, pools: PoolRecord[], sameTicker: TokenRecord[]): TokenFacts {
  const c = token.facts;
  const earliest = pools.length ? pools.reduce((a, b) => (b.createdMs < a.createdMs ? b : a)) : null;
  const liquidity = pools.map((p) => p.first.liquidityUsd).filter((x): x is number => x !== null);
  const others = sameTicker.filter((t) => t.token !== token.token);
  const swapsPerPool = pools.map((p) => (p.first.buysH24 === null || p.first.sellsH24 === null ? null : p.first.buysH24 + p.first.sellsH24));

  return {
    token: token.token,
    ticker: token.ticker,
    facts_read_at_ms: c?.readAtMs ?? null,
    is_contract: c?.isContract ?? null,
    is_proxy: c?.isProxy ?? null,
    has_mint: c?.hasMint ?? null,
    has_pause: c?.hasPause ?? null,
    has_blacklist: c?.hasBlacklist ?? null,
    has_upgrade: c?.hasUpgrade ?? null,
    has_owner_function: c?.hasOwnerFunction ?? null,
    owner_renounced: c?.ownerRenounced ?? null,
    mint_with_live_owner: c?.mintWithLiveOwner ?? null,
    total_supply: c?.totalSupply ?? null,
    decimals: c?.decimals ?? null,
    pool_count: pools.length,
    seen_age_minutes: earliest ? Math.max(0, Math.round((earliest.first.atMs - earliest.createdMs) / 60_000)) : null,
    seen_liquidity_usd: liquidity.length ? Math.max(...liquidity) : null,
    seen_volume_usd: sum(pools.map((p) => p.first.volumeH24Usd)),
    seen_swaps: sum(swapsPerPool),
    liquidity_not_reported: pools.length ? pools.every((p) => p.first.liquidityUsd === null) : null,
    ticker_uses: token.ticker === null ? null : others.length + 1,
    ticker_clone_of_older: token.ticker === null ? null : others.some((t) => t.firstCreatedMs < token.firstCreatedMs),
  };
}
