// Where the gate gets a token's fact sheet.
//  1. The collector's database, when the collector has seen the token (adds liquidity and ticker copies).
//  2. The chain itself, read at the moment of the request, when the collector never saw the token or has not read
//     its contract yet. Uses the collector's own readContractFacts(), so a contract is judged the same way on both
//     paths. Market facts are then unknown (null), which the rules turn into REVIEW, never ALLOW.
// Why live reads (2026-11-11): finding every launch in advance needs eth_getLogs, which no free source served from
// Cloudflare (see collector/DATA-MODEL.md); reading one contract on demand works on the free Chainstack plan.
import type { CollectorStore } from "../../collector/src/collector-store.ts";
import { readContractFacts, type RpcClient } from "../../collector/src/contract-facts.ts";
import { buildTokenFacts, type TokenFacts } from "../../collector/src/token-facts.ts";
import type { ContractFacts, TokenRecord } from "../../collector/src/types.ts";

export function factsFromCollector(store: CollectorStore): (token: string) => Promise<TokenFacts | null> {
  return async (token) => {
    const record = await store.getToken(token);
    if (!record) return null;
    const [pools, sameTicker] = await Promise.all([store.poolsOfToken(token), record.ticker ? store.tokensWithTicker(record.ticker) : Promise.resolve([])]);
    return buildTokenFacts(record, pools, sameTicker);
  };
}

type LiveDeps = { rpc: RpcClient; now: () => number; store?: CollectorStore };

// Reads the contract now and merges it with what the collector knows about the market (pools, ticker copies).
async function readNow(o: LiveDeps, token: string): Promise<{ contract: ContractFacts; sheet: TokenFacts }> {
  const contract = await readContractFacts(o.rpc, token, o.now());
  const stored = o.store ? await o.store.getToken(token) : null;
  // Never seen by the collector: no pools, no ticker, so copies and liquidity stay unknown.
  const record: TokenRecord = stored
    ? { ...stored, facts: contract }
    : { token, symbol: contract.symbol ?? "?", ticker: null, firstCreatedMs: 0, poolCount: 0, facts: contract, factsTries: 0, lastError: null };
  const pools = o.store ? await o.store.poolsOfToken(token) : [];
  const sameTicker = o.store && record.ticker ? await o.store.tokensWithTicker(record.ticker) : [];
  return { contract, sheet: buildTokenFacts(record, pools, sameTicker) };
}

// The collector's sheet when it is complete; otherwise the contract is read live and merged in.
export function factsLive(o: LiveDeps): (token: string) => Promise<TokenFacts | null> {
  const fromCollector = o.store ? factsFromCollector(o.store) : null;
  return async (token) => {
    const known = fromCollector ? await fromCollector(token) : null;
    if (known && known.facts_read_at_ms !== null) return known;
    return (await readNow(o, token)).sheet;
  };
}

// Always a fresh read of the contract, never the collector's stored copy: mandates exist to notice a CHANGE.
// Returns the raw contract facts too, so two reads can be compared field by field.
export function factsFresh(o: LiveDeps): (token: string) => Promise<{ contract: ContractFacts; sheet: TokenFacts }> {
  return (token) => readNow(o, token);
}
