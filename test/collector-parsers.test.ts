import test from "node:test";
import assert from "node:assert/strict";
import { createGeckoClient, parsePools, POOL_ID } from "../collector/src/geckoterminal.ts";
import { normalizeTicker } from "../collector/src/ticker.ts";
import { fakeInternet, fixture, noSleep } from "./collector-fixtures.ts";

const real = parsePools(fixture("gecko-new-pools.json"));
const byName = (name: string) => real.rows.filter((r) => r.name.startsWith(name));
const pool = (over: Record<string, unknown> = {}, rel: Record<string, unknown> = {}) => ({
  attributes: { address: "0x" + "ab".repeat(20), name: "ABC / WETH 1%", pool_created_at: "2026-11-10T05:00:00Z", reserve_in_usd: "100.5", fdv_usd: "5000", volume_usd: { h24: "12.5" }, transactions: { h24: { buys: 3, sells: 2 } }, ...over },
  relationships: {
    base_token: { data: { id: "robinhood_0x" + "11".repeat(20) } },
    quote_token: { data: { id: "robinhood_0x" + "0".repeat(40) } },
    dex: { data: { id: "uniswap-v2-robinhood" } },
    ...rel,
  },
});

test("REAL data: all 20 recorded pools parse, none skipped", () => {
  assert.equal(real.rows.length, 20);
  assert.deepEqual(real.skipped, []);
});

test("REAL data: a known pool is read exactly", () => {
  const hyvo = byName("HYVO")[0];
  assert.equal(hyvo.symbol, "HYVO");
  assert.equal(hyvo.token, "0xeedc49c41ea7141e8fb1f1a3f106858c31c05a9a");
  assert.equal(hyvo.pool.length, 66, "a Uniswap v4 pool is identified by a 32-byte id");
  assert.equal(hyvo.dex, "uniswap-v4-robinhood");
  assert.equal(hyvo.createdMs, Date.parse("2026-11-10T05:39:59Z"));
  assert.deepEqual(hyvo.stats, { liquidityUsd: 22122.1888, volumeH24Usd: 588.6644530715, buysH24: 17, sellsH24: 6, fdvUsd: 22314.01061 });
});

test("REAL data: Uniswap v2 pools have a 20-byte id, and both lengths are accepted", () => {
  assert.ok(real.rows.some((r) => r.pool.length === 42));
  assert.ok(real.rows.every((r) => POOL_ID.test(r.pool)));
});

test("REAL data: a missing liquidity figure is null, not zero", () => {
  const nulls = real.rows.filter((r) => r.stats.liquidityUsd === null);
  assert.ok(nulls.length >= 1);
  assert.ok(real.rows.some((r) => r.stats.liquidityUsd === 0), "and a real zero stays zero");
});

test("REAL data: Metrion is ONE token in two pools; WIENER is FOUR different tokens", () => {
  assert.equal(new Set(byName("Metrion").map((r) => r.token)).size, 1);
  assert.equal(byName("Metrion").length, 2);
  assert.equal(new Set(byName("WIENER").map((r) => r.token)).size, 4);
});

test("REAL data: the other side of every pool is a base asset, never the token we judge", () => {
  const quotes = new Set(real.rows.map((r) => r.quote));
  assert.ok(quotes.has("0x5fc5360d0400a0fd4f2af552add042d716f1d168"), "USDG");
  assert.ok(quotes.has("0x0bd7d308f8e1639fab988df18a8011f41eacad73"), "WETH");
  assert.ok(quotes.has("0x0000000000000000000000000000000000000000") || quotes.has("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"), "native ETH");
  assert.equal(new Set(real.rows.map((r) => r.token)).size, 19);
});

test("a pool written the other way round (WETH / TOKEN) still judges TOKEN", () => {
  const swapped = pool(
    { name: "WETH / ZED 0.3%" },
    { base_token: { data: { id: "robinhood_0x0bd7d308f8e1639fab988df18a8011f41eacad73" } }, quote_token: { data: { id: "robinhood_0x" + "22".repeat(20) } } },
  );
  const r = parsePools({ data: [swapped] });
  assert.equal(r.rows[0].token, "0x" + "22".repeat(20));
  assert.equal(r.rows[0].symbol, "ZED");
  assert.equal(r.rows[0].quote, "0x0bd7d308f8e1639fab988df18a8011f41eacad73");
});

test("a pool with no new token in it (WETH / USDG) is skipped with a reason", () => {
  const both = pool(
    { name: "WETH / USDG" },
    { base_token: { data: { id: "robinhood_0x0bd7d308f8e1639fab988df18a8011f41eacad73" } }, quote_token: { data: { id: "robinhood_0x5fc5360d0400a0fd4f2af552add042d716f1d168" } } },
  );
  const r = parsePools({ data: [both] });
  assert.equal(r.rows.length, 0);
  assert.equal(r.skipped[0].reason, "no_new_token_in_pool");
});

test("odd pools are skipped and counted, and never stop the good ones", () => {
  const good = pool();
  const r = parsePools({
    data: [
      good,
      null,
      "text",
      { attributes: {}, relationships: {} },
      pool({ address: "0x123" }),
      pool({ address: "0X" + "AB".repeat(20) }), // upper-case is fine, it is lower-cased
      pool({ name: "no separator" }),
      pool({ name: " / WETH" }),
      pool({ pool_created_at: "yesterday" }),
      pool({}, { base_token: { data: { id: "robinhood_not-an-address" } } }),
      pool({}, { quote_token: undefined }),
    ],
  });
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.skipped.map((s) => s.reason).sort(), ["bad_created_time", "bad_name", "bad_name", "bad_pool_shape", "bad_pool_shape", "bad_pool_shape", "bad_pool_shape", "bad_token_ids", "bad_token_ids"]);
});

test("numbers from the source are checked: negatives, text and fractions become null", () => {
  const r = parsePools({ data: [pool({ reserve_in_usd: "-5", fdv_usd: "abc", volume_usd: { h24: null }, transactions: { h24: { buys: 1.5, sells: -2 } } })] });
  assert.deepEqual(r.rows[0].stats, { liquidityUsd: null, volumeH24Usd: null, buysH24: null, sellsH24: null, fdvUsd: null });
  const ok = parsePools({ data: [pool({ reserve_in_usd: 0, transactions: { h24: { buys: 0, sells: 0 } } })] });
  assert.equal(ok.rows[0].stats.liquidityUsd, 0);
  assert.equal(ok.rows[0].stats.buysH24, 0);
});

test("an answer with no data list is an error, not an empty success", () => {
  assert.throws(() => parsePools({}), /no data list/);
  assert.throws(() => parsePools({ data: "x" }), /no data list/);
  assert.throws(() => parsePools(null), /no data list/);
});

test("ticker normalisation: copies that differ only in case, spacing or punctuation match", () => {
  const a = normalizeTicker("Wiener");
  assert.equal(a, "WIENER");
  // W I E N E R, spelled with spaces, dots, dashes and full-width letters
  for (const copy of ["WIENER ", " wiener", "W.I.E.N.E.R", "W-i-e-n-e-r", "ＷＩＥＮＥＲ"]) assert.equal(normalizeTicker(copy), a, copy);
  assert.notEqual(normalizeTicker("WIENERS"), a);
});

test("ticker normalisation: unusable input is null, and other scripts survive", () => {
  assert.equal(normalizeTicker(""), null);
  assert.equal(normalizeTicker("...---"), null);
  assert.equal(normalizeTicker("x".repeat(33)), null);
  assert.equal(normalizeTicker("éclair"), "ÉCLAIR");
  assert.equal(normalizeTicker("比特币"), "比特币");
});

test("the client asks for the right URLs and only validated ids reach them", async () => {
  const net = fakeInternet();
  const gecko = createGeckoClient({ fetch: net.fetch, sleep: noSleep, now: () => 0, minIntervalMs: 0 });
  await gecko.newPools(2);
  assert.equal(net.calls[0].url, "https://api.geckoterminal.com/api/v2/networks/robinhood/new_pools?page=2");
  const ids = real.rows.slice(0, 2).map((r) => r.pool);
  await gecko.pools(ids);
  assert.equal(net.calls[1].url, `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/multi/${ids.join(",")}`);
  assert.throws(() => gecko.newPools(0), RangeError);
  assert.throws(() => gecko.newPools(11), RangeError);
  assert.throws(() => gecko.newPools(1.5), RangeError);
  assert.throws(() => gecko.pools([]), RangeError);
  assert.throws(() => gecko.pools(Array(31).fill(ids[0])), RangeError);
  assert.throws(() => gecko.pools(["../../etc/passwd"]), /not a pool id/);
  assert.throws(() => gecko.pools([ids[0] + "?x=1"]), /not a pool id/);
  assert.equal(net.calls.length, 2, "nothing invalid was sent");
});

test("the client keeps to the source's rate limit by waiting between calls", async () => {
  const net = fakeInternet();
  const waits: number[] = [];
  let clock = 1_000_000;
  const gecko = createGeckoClient({ fetch: net.fetch, sleep: async (ms) => void (waits.push(ms), (clock += ms)), now: () => clock, minIntervalMs: 2200 });
  await gecko.newPools(1);
  assert.deepEqual(waits, [], "the first call goes straight away");
  await gecko.newPools(2);
  assert.deepEqual(waits, [2200], "the second waits out the gap");
  clock += 5000;
  await gecko.newPools(3);
  assert.deepEqual(waits, [2200], "after a long pause there is nothing to wait for");
});
