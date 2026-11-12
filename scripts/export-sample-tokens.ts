// Writes site/data/sample-tokens.json: REAL fact sheets from a collector database, for the website demo and the
// Check page's example buttons.
// Run against PRODUCTION data (what the live gate answers from), so an example never answers differently on the site:
//   cd api && npx wrangler d1 export reinkeep-collector --remote --output /tmp/prod.sql
//   sqlite3 /tmp/prod.sqlite < /tmp/prod.sql
//   node scripts/export-sample-tokens.ts /tmp/prod.sqlite --verify https://reinkeep-gate.reinkeep.workers.dev
// With no path it reads the laptop's collector/data/collector.sqlite (2026-11-12 bug: samples picked there were
// unknown to the live gate, so every example answered REVIEW on the site). --verify asks the live gate for each pick
// and refuses to write when its answer differs from the one the sample is meant to show.
// The samples are chosen by what the facts say, not by hand: the busiest token the rules let through, the busiest
// upgradeable one, and the busiest one under the default liquidity line. Each is judged by the real engine here, and
// the script refuses to write a sample whose answer is not the one it was picked to show.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultPolicy, evaluate, ROBINHOOD_CHAIN, USDG_ROBINHOOD, type TokenFactSheet } from "../engine/policy.ts";
import { D1CollectorStore } from "../collector/src/d1-store.ts";
import { openSqlite } from "../collector/src/sqlite-adapter.ts";
import { factsFromCollector } from "../api/src/token-facts-source.ts";

const args = process.argv.slice(2);
const verifyAt = args.includes("--verify") ? args[args.indexOf("--verify") + 1] : null;
const dbArg = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--verify");
const dbFile = dbArg ?? fileURLToPath(new URL("../collector/data/collector.sqlite", import.meta.url));
const db = openSqlite(dbFile);
const facts = factsFromCollector(new D1CollectorStore(db));
const tokens = (db.raw.prepare("SELECT token FROM tokens WHERE read_at_ms IS NOT NULL").all() as { token: string }[]).map((r) => r.token);

// A payment that passes every spend rule, so only the token decides.
const KNOWN = "0x1111111111111111111111111111111111111111";
const cleanPay = { network: ROBINHOOD_CHAIN, asset: USDG_ROBINHOOD, amount: "30000", decimals: 6, payTo: KNOWN, resourceUrl: "https://api.example-vendor.com/swap", validForSeconds: 60, now: 0 };
const judge = (f: TokenFactSheet) => evaluate(cleanPay, { ...defaultPolicy, allowPayTo: [KNOWN] }, [], { token: "", facts: f });

// Tickers that copy real companies or stocks. A demo that shows ALLOW next to one reads as us vouching for an
// impersonation, so they are never picked as examples (they are still checked normally by the gate).
const NOT_AN_EXAMPLE = new Set(["ANTHROPIC", "OPENAI", "GOOGLE", "APPLE", "AAPL", "AMD", "NVDA", "NVIDIA", "TSLA", "TESLA", "NIO", "MSFT", "META", "AMZN", "ROBINHOOD", "HOOD", "COINBASE", "BTC", "ETH", "USDC", "USDT", "USDG"]);

const sheets = [];
for (const t of tokens) {
  const f = await facts(t);
  if (f && !NOT_AN_EXAMPLE.has((f.ticker ?? "").toUpperCase())) sheets.push({ token: t, facts: f, result: judge(f) });
}
const busiest = (want: (codes: string[]) => boolean) =>
  sheets.filter((s) => want(s.result.reasons)).sort((a, b) => (b.facts.seen_liquidity_usd ?? -1) - (a.facts.seen_liquidity_usd ?? -1))[0];

const picks = [
  { why: "passes the token rules", pick: busiest((c) => c.length === 0), expect: "token-clean" },
  { why: "upgradeable proxy", pick: busiest((c) => c.includes("token_upgradeable")), expect: "token_upgradeable" },
  { why: "under the liquidity line", pick: busiest((c) => c.includes("token_low_liquidity")), expect: "token_low_liquidity" },
];
const out = picks.map(({ why, pick, expect }) => {
  if (!pick) throw new Error(`no token in the data shows: ${why}`);
  const codes = pick.result.reasons;
  if (expect === "token-clean" ? codes.length !== 0 : !codes.includes(expect)) throw new Error(`sample for "${why}" answered ${codes.join(",")}`);
  return { token: pick.token, ticker: pick.facts.ticker, facts: pick.facts };
});
if (verifyAt) {
  // The live gate reads its own data; it must agree with what each sample is meant to show.
  for (const [i, s] of out.entries()) {
    const res = await fetch(`${verifyAt}/api/v1/verdict/${s.token}`);
    const live = (await res.json()) as { decision?: string; reasons?: { code: string }[] };
    const codes = (live.reasons ?? []).map((r) => r.code);
    const want = picks[i].expect;
    const ok = want === "token-clean" ? live.decision === "ALLOW" : codes.includes(want) && !codes.includes("token_facts_unknown");
    if (!ok) throw new Error(`live gate answers ${live.decision} ${codes.join(",")} for the "${picks[i].why}" sample ${s.token}; not writing`);
    console.log(`live check ok: ${s.ticker} ${live.decision} ${codes.join(",") || "(no rule fired)"}`);
  }
}
const readAt = Math.max(...out.map((s) => s.facts.facts_read_at_ms ?? 0));
writeFileSync(
  fileURLToPath(new URL("../site/data/sample-tokens.json", import.meta.url)),
  JSON.stringify({ note: "Real fact sheets read from Robinhood Chain by the Reinkeep collector.", readAtMs: readAt, tokens: out }, null, 2) + "\n",
);
console.log(`wrote ${out.length} samples: ${out.map((s) => `${s.ticker} ${s.token.slice(0, 10)}`).join(", ")} (from ${sheets.length} tokens with facts)`);
db.close();
