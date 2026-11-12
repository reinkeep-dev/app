// Pre-mortem: a launch draft in, the gate's own answer plus launch risks and what our data says out. Real SQL on an
// in-memory SQLite collector database; no network.
import assert from "node:assert/strict";
import test from "node:test";
import { D1CollectorStore } from "../collector/src/d1-store.ts";
import { openSqlite } from "../collector/src/sqlite-adapter.ts";
import { LIQUIDITY_BANDS, MIN_SAMPLE, cohortOf, parseDraft, premortem, type Draft } from "../api/src/premortem.ts";
import { makeApp } from "./api-fixture.ts";

const clean = (over: Omit<Partial<Draft>, "contract"> & { contract?: Partial<Draft["contract"]> } = {}): Draft => ({
  name: "Clean Coin", ticker: "CLEAN", buyTaxPct: 0, sellTaxPct: 0, teamAllocationPct: 5, liquidityUsd: 20_000, liquidityLockDays: 180,
  ...over,
  contract: { mint: false, ownerRenounced: true, pause: false, blacklist: false, upgradeable: false, ...over.contract },
});
const codes = (r: { risks: { code: string }[] }) => r.risks.map((x) => x.code);

let n = 0;
const addr = () => "0x" + (++n).toString(16).padStart(40, "0");
// A pool first seen with `liq` dollars, re-checked a day later as alive (true), dead (false) or no numbers (null).
async function pool(store: D1CollectorStore, o: { liq: number | null; alive?: boolean | null; ticker?: string; createdMs?: number }) {
  const token = addr();
  const sym = o.ticker ?? "T" + n;
  await store.ensureToken(token, sym, sym.toUpperCase());
  const p = addr();
  const stats = { liquidityUsd: o.liq, volumeH24Usd: 1, buysH24: 1, sellsH24: 1, fdvUsd: null };
  await store.addPool({ pool: p, token, quote: "0x" + "00".repeat(20), name: sym, symbol: sym, dex: "x", createdMs: o.createdMs ?? 1_000_000, first: { atMs: 1_000_100, ...stats }, outcome: null });
  if (o.alive !== undefined) await store.setOutcome(p, { atMs: 90_000_000, ageH: 24, ...stats, alive: o.alive });
}

test("a clean draft: the gate would ALLOW, no risks, nothing stored", async () => {
  const r = await premortem(clean(), {});
  assert.equal(r.gate.decision, "ALLOW");
  assert.deepEqual(r.risks, []);
  assert.equal(r.stored, false);
  assert.deepEqual(r.ticker, { checked: false, earlierTokens: null, firstSeen: null }, "no collector: the ticker is not checked, and says so");
  assert.equal(r.cohort, null);
});

test("mint with an owner who keeps it: the gate would BLOCK, with the gate's own words and a fix", async () => {
  const r = await premortem(clean({ contract: { mint: true, ownerRenounced: false } }), {});
  assert.equal(r.gate.decision, "BLOCK");
  const risk = r.risks.find((x) => x.code === "token_mint_live_owner")!;
  assert.equal(risk.severity, "high");
  assert.equal(risk.basis, "gate rule");
  assert.match(risk.fix, /renounce/);
  const renounced = await premortem(clean({ contract: { mint: true, ownerRenounced: true } }), {});
  assert.equal(renounced.gate.decision, "ALLOW", "mint with ownership renounced is not the BLOCK rule");
});

test("pause, upgradeable, low liquidity: REVIEW from the gate, each a medium risk", async () => {
  const r = await premortem(clean({ contract: { pause: true, upgradeable: true }, liquidityUsd: 500 }), {});
  assert.equal(r.gate.decision, "REVIEW");
  assert.deepEqual(codes(r).sort(), ["token_has_pause", "token_low_liquidity", "token_upgradeable"]);
  assert.ok(r.risks.every((x) => x.severity === "medium"));
});

test("launch rules of thumb: strongest per field only, labelled as rules of thumb, high risks first", async () => {
  const r = await premortem(clean({ sellTaxPct: 15, buyTaxPct: 2, teamAllocationPct: 12, liquidityLockDays: 0 }), {});
  assert.deepEqual(codes(r), ["sell_tax_high", "tax_gap", "liquidity_unlocked", "team_allocation_medium"]);
  assert.ok(r.risks.every((x) => x.basis === "rule of thumb"));
  assert.deepEqual(r.summary, { high: 3, medium: 1, low: 0 });
  const edge = await premortem(clean({ sellTaxPct: 5, teamAllocationPct: 10, liquidityLockDays: 30 }), {});
  assert.deepEqual(codes(edge), [], "exactly at a threshold does not fire");
});

test("ticker: an earlier token with the same ticker (case and symbols ignored) turns on the gate's copy rule", async () => {
  const store = new D1CollectorStore(openSqlite(":memory:"));
  await pool(store, { liq: 5000, ticker: "pepe", createdMs: 1_700_000_000_000 });
  const r = await premortem(clean({ ticker: "$PEPE" }), { collector: store });
  assert.deepEqual(r.ticker, { checked: true, earlierTokens: 1, firstSeen: new Date(1_700_000_000_000).toISOString() });
  assert.equal(r.gate.decision, "REVIEW");
  assert.ok(codes(r).includes("token_ticker_copy"));
  const fresh = await premortem(clean({ ticker: "NEWONE" }), { collector: store });
  assert.deepEqual([fresh.ticker.checked, fresh.ticker.earlierTokens, fresh.gate.decision], [true, 0, "ALLOW"]);
});

test("outcomesByLiquidity: right bands, open top band, unknown liquidity and un-rechecked pools left out", async () => {
  const store = new D1CollectorStore(openSqlite(":memory:"));
  await pool(store, { liq: 999.99, alive: false });
  await pool(store, { liq: 1000, alive: true }); // exactly on an edge: the upper band
  await pool(store, { liq: 5000, alive: null }); // re-checked, no numbers: counted in n, neither alive nor dead
  await pool(store, { liq: 250_000, alive: true });
  await pool(store, { liq: null, alive: true }); // liquidity never known: in no band
  await pool(store, { liq: 50_000 }); // not re-checked yet
  const bands = await store.outcomesByLiquidity(LIQUIDITY_BANDS);
  assert.deepEqual(bands, [
    { minUsd: 0, maxUsd: 1000, n: 1, alive: 0, dead: 1 },
    { minUsd: 1000, maxUsd: 10_000, n: 2, alive: 1, dead: 0 },
    { minUsd: 10_000, maxUsd: 100_000, n: 0, alive: 0, dead: 0 },
    { minUsd: 100_000, maxUsd: null, n: 1, alive: 1, dead: 0 },
  ]);
  await assert.rejects(store.outcomesByLiquidity([10, 5]), RangeError);
});

test("cohort: no share under the minimum sample (and it says how many), a real share from it on", async () => {
  const few = cohortOf([{ minUsd: 0, maxUsd: null, n: 12, alive: 4, dead: 8 }], 50);
  assert.equal(few.stillTradingPct, null);
  assert.match(few.note, /Not enough data yet: 12 tokens/);
  const enough = cohortOf([{ minUsd: 0, maxUsd: null, n: MIN_SAMPLE + 5, alive: 9, dead: MIN_SAMPLE - 9 }], 50);
  assert.equal(enough.stillTradingPct, Math.round((9 / MIN_SAMPLE) * 100), "share of the judged ones only (alive + dead), not of n");
  assert.match(enough.note, /not a prediction/);
});

test("the cohort is picked by the draft's liquidity, from the real database", async () => {
  const store = new D1CollectorStore(openSqlite(":memory:"));
  for (let i = 0; i < MIN_SAMPLE; i++) await pool(store, { liq: 20_000, alive: i < 21 });
  for (let i = 0; i < 3; i++) await pool(store, { liq: 200, alive: false });
  const r = await premortem(clean({ liquidityUsd: 20_000 }), { collector: store });
  assert.deepEqual([r.cohort!.minUsd, r.cohort!.n, r.cohort!.stillTradingPct], [10_000, MIN_SAMPLE, 70]);
  const low = await premortem(clean({ liquidityUsd: 300 }), { collector: store });
  assert.deepEqual([low.cohort!.minUsd, low.cohort!.n, low.cohort!.stillTradingPct], [0, 3, null]);
});

test("input: every field checked, unknown fields refused, numbers in range", () => {
  const ok = { ticker: "X", contract: { mint: false, ownerRenounced: true, pause: false, blacklist: false, upgradeable: false }, buyTaxPct: 0, sellTaxPct: 0, teamAllocationPct: 0, liquidityUsd: 1, liquidityLockDays: 0 };
  assert.equal(parseDraft(ok).name, null);
  const bad: [unknown, string][] = [
    [{ ...ok, extra: 1 }, "unknown_field"],
    [{ ...ok, contract: { ...ok.contract, owner: true } }, "unknown_field"],
    [{ ...ok, contract: { ...ok.contract, mint: "no" } }, "invalid_draft"],
    [{ ...ok, ticker: "$$$" }, "invalid_draft"],
    [{ ...ok, sellTaxPct: 101 }, "invalid_draft"],
    [{ ...ok, liquidityLockDays: 1.5 }, "invalid_draft"],
    [{ ...ok, liquidityUsd: -1 }, "invalid_draft"],
    [[], "invalid_body"],
  ];
  for (const [raw, code] of bad) assert.throws(() => parseDraft(raw), (e: any) => e.code === code, JSON.stringify(raw));
});

test("HTTP: POST /api/v1/premortem answers with the collector wired in; GET is 405", async () => {
  const store = new D1CollectorStore(openSqlite(":memory:"));
  const app = makeApp({ collector: store });
  const body = { ticker: "ABC", contract: { mint: false, ownerRenounced: true, pause: false, blacklist: true, upgradeable: false }, buyTaxPct: 0, sellTaxPct: 0, teamAllocationPct: 0, liquidityUsd: 5000, liquidityLockDays: 365 };
  const r = await app.send("POST", "/api/v1/premortem", body);
  assert.equal(r.status, 200);
  assert.equal(r.data.gate.decision, "BLOCK");
  assert.equal(r.data.ticker.checked, true);
  assert.equal(r.data.cohort.n, 0);
  assert.equal((await app.send("GET", "/api/v1/premortem")).status, 405);
  assert.equal((await app.send("POST", "/api/v1/premortem", { ...body, ticker: 5 })).status, 400);
});
