// Market data for Robinhood Chain pools from GeckoTerminal's public API (no key).
// Shapes were checked against real responses recorded on 2026-11-10 (test/fixtures). The parser trusts nothing:
// a pool with an odd shape is skipped and counted, never half-read.
import { USDG_ROBINHOOD } from "../../engine/policy.ts";
import { requestJson, HttpError, type Fetcher, type Sleep } from "./http-json.ts";
import type { PoolRow } from "./types.ts";

const ZERO = "0x0000000000000000000000000000000000000000";
const NATIVE_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"; // GeckoTerminal's other spelling of native ETH
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"; // symbol() on chain returned "WETH", checked 2026-11-10

// The "money" side of a pool. A pool is about the OTHER token.
export const BASE_ASSETS: ReadonlySet<string> = new Set([ZERO, NATIVE_SENTINEL, WETH, USDG_ROBINHOOD.toLowerCase()]);

export const POOL_ID = /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/; // v4 pools are identified by a 32-byte id, not an address
export const TOKEN_ADDRESS = /^0x[0-9a-f]{40}$/;

export type Skipped = { reason: string; pool?: string };
export type ParsedPools = { rows: PoolRow[]; skipped: Skipped[] };

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

function money(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function count(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

function tokenId(rel: unknown): string | null {
  const id = isObj(rel) && isObj(rel.data) ? rel.data.id : undefined;
  if (typeof id !== "string") return null;
  const address = id.slice(id.indexOf("_") + 1).toLowerCase();
  return TOKEN_ADDRESS.test(address) ? address : null;
}

// "HYVO / WETH 0.01%" -> ["HYVO", "WETH"]
function splitName(name: string): [string, string] | null {
  const parts = name.split(" / ");
  if (parts.length !== 2) return null;
  const left = parts[0].trim();
  const right = parts[1].replace(/\s+[\d.]+%$/, "").trim();
  return left && right ? [left, right] : null;
}

export function parsePools(json: unknown): ParsedPools {
  if (!isObj(json) || !Array.isArray(json.data)) throw new HttpError(200, "GeckoTerminal answer has no data list");
  const rows: PoolRow[] = [];
  const skipped: Skipped[] = [];
  for (const item of json.data) {
    const a = isObj(item) && isObj(item.attributes) ? item.attributes : null;
    const rel = isObj(item) && isObj(item.relationships) ? item.relationships : null;
    const pool = a && typeof a.address === "string" ? a.address.toLowerCase() : "";
    if (!a || !rel || !POOL_ID.test(pool)) {
      skipped.push({ reason: "bad_pool_shape", pool: pool || undefined });
      continue;
    }
    const base = tokenId(rel.base_token);
    const quote = tokenId(rel.quote_token);
    const names = typeof a.name === "string" && a.name.length <= 200 ? splitName(a.name) : null;
    const createdMs = typeof a.pool_created_at === "string" ? Date.parse(a.pool_created_at) : NaN;
    if (!base || !quote) { skipped.push({ reason: "bad_token_ids", pool }); continue; }
    if (!names) { skipped.push({ reason: "bad_name", pool }); continue; }
    if (!Number.isFinite(createdMs)) { skipped.push({ reason: "bad_created_time", pool }); continue; }
    const baseIsAsset = BASE_ASSETS.has(base);
    if (baseIsAsset && BASE_ASSETS.has(quote)) { skipped.push({ reason: "no_new_token_in_pool", pool }); continue; }
    const token = baseIsAsset ? quote : base;
    const symbol = (baseIsAsset ? names[1] : names[0]).slice(0, 64);
    const dex = isObj(rel.dex) && isObj(rel.dex.data) && typeof rel.dex.data.id === "string" ? rel.dex.data.id.slice(0, 64) : "unknown";
    const h24 = isObj(a.transactions) && isObj(a.transactions.h24) ? a.transactions.h24 : {};
    rows.push({
      pool,
      token,
      quote: baseIsAsset ? base : quote,
      name: a.name,
      symbol,
      dex,
      createdMs,
      stats: {
        liquidityUsd: money(a.reserve_in_usd),
        volumeH24Usd: money(isObj(a.volume_usd) ? a.volume_usd.h24 : undefined),
        buysH24: count(h24.buys),
        sellsH24: count(h24.sells),
        fdvUsd: money(a.fdv_usd),
      },
    });
  }
  return { rows, skipped };
}

export type GeckoClient = {
  newPools(page: number): Promise<ParsedPools>;
  pools(ids: string[]): Promise<ParsedPools>;
};

export function createGeckoClient(o: { fetch: Fetcher; sleep: Sleep; now: () => number; baseUrl?: string; minIntervalMs?: number }): GeckoClient {
  const base = o.baseUrl ?? "https://api.geckoterminal.com/api/v2/networks/robinhood";
  const gap = o.minIntervalMs ?? 2200; // the public API allows about 30 calls a minute
  let lastAt = -Infinity;

  async function get(path: string): Promise<ParsedPools> {
    const wait = lastAt + gap - o.now();
    if (wait > 0) await o.sleep(wait);
    lastAt = o.now();
    return parsePools(await requestJson(base + path, { method: "GET" }, { fetch: o.fetch, sleep: o.sleep }));
  }

  return {
    newPools(page) {
      if (!Number.isInteger(page) || page < 1 || page > 10) throw new RangeError("page must be a whole number from 1 to 10");
      return get(`/new_pools?page=${page}`);
    },
    pools(ids) {
      if (ids.length < 1 || ids.length > 30) throw new RangeError("ask for 1 to 30 pools at a time");
      // Only validated ids ever reach the URL.
      for (const id of ids) if (!POOL_ID.test(id)) throw new RangeError(`not a pool id: ${id.slice(0, 20)}`);
      return get(`/pools/multi/${ids.join(",")}`);
    },
  };
}
