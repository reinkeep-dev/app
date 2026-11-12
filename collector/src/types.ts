// Shared shapes for the token-data collector.
// Every fact that can be unknown is `null`, never a guess: "false" must mean "we looked and it is not there",
// "null" must mean "we could not tell". The gate treats null as REVIEW, never as safe.

export type Snapshot = {
  atMs: number; // when we looked
  liquidityUsd: number | null;
  volumeH24Usd: number | null;
  buysH24: number | null;
  sellsH24: number | null;
  fdvUsd: number | null;
};

// What the market-data source says about one pool, before we stamp the time on it.
export type PoolRow = {
  pool: string; // 0x + 40 hex (Uniswap v2/v3 style) or 0x + 64 hex (Uniswap v4 pool id), lowercase
  token: string; // the token we are judging, 0x + 40 hex, lowercase
  quote: string; // the other side of the pool
  name: string;
  symbol: string; // as written in the pool name, e.g. "WIENER"
  dex: string;
  createdMs: number;
  stats: Omit<Snapshot, "atMs">;
};

export type Outcome = Snapshot & { ageH: number; alive: boolean | null }; // null: the source gave nothing to judge by

export type PoolRecord = {
  pool: string;
  token: string;
  quote: string;
  name: string;
  symbol: string;
  dex: string;
  createdMs: number;
  first: Snapshot; // our first sighting
  outcome: Outcome | null; // the re-check 24 hours or more after creation
};

export type ContractFacts = {
  token: string;
  readAtMs: number;
  scannerVersion: number; // which version of the contract scanner produced this; see SCANNER_VERSION
  isContract: boolean;
  codeSize: number | null;
  isProxy: boolean | null;
  implementation: string | null;
  // powers, from the bytecode's function selectors (see contract-facts.ts: it finds the common names only)
  hasMint: boolean | null;
  hasPause: boolean | null;
  hasBlacklist: boolean | null;
  hasUpgrade: boolean | null;
  hasOwnerFunction: boolean | null;
  owner: string | null;
  ownerRenounced: boolean | null;
  mintWithLiveOwner: boolean | null;
  totalSupply: string | null; // base units, decimal string
  decimals: number | null;
  symbol: string | null;
};

export type TokenRecord = {
  token: string;
  symbol: string; // first seen in a pool name
  ticker: string | null; // normalised, for spotting copies; null when nothing usable is left
  firstCreatedMs: number; // the earliest pool created for this token
  poolCount: number;
  facts: ContractFacts | null;
  factsTries: number;
  lastError: string | null;
};
