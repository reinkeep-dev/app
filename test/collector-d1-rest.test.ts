import test from "node:test";
import assert from "node:assert/strict";
import { createD1Rest, D1RestError } from "../collector/src/d1-rest.ts";
import { D1CollectorStore } from "../collector/src/d1-store.ts";
import { openSqlite } from "../collector/src/sqlite-adapter.ts";

const ACCOUNT = "7a4c344a228f90412b1b09e956bc8662";
const DATABASE = "7e8716f6-9aa3-4d51-a02b-b34e57831738";
const TOKEN = "t".repeat(40);
const URL_OK = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}/query`;

// A stand-in for Cloudflare's D1 REST endpoint: it runs the statement on a real SQLite file, answers in D1's shape.
function fakeCloudflare() {
  const db = openSqlite(":memory:");
  const calls: { url: string; auth: string | null; body: { sql: string; params: unknown[] } }[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization"), body });
    try {
      const s = db.raw.prepare(body.sql);
      const isRead = /^\s*(select|pragma)/i.test(body.sql) || /\breturning\b/i.test(body.sql);
      let results: unknown[] = [];
      let changes = 0;
      if (isRead) results = s.all(...body.params);
      else changes = Number(s.run(...body.params).changes);
      return Response.json({ success: true, errors: [], result: [{ success: true, results, meta: { changes, size_after: 4096 } }] });
    } catch (e) {
      return Response.json({ success: false, errors: [{ code: 7500, message: String(e instanceof Error ? e.message : e) }], result: [] }, { status: 400 });
    }
  };
  return { db, calls, fetch: fetchFn };
}
const rest = (fetchFn: typeof fetch) => createD1Rest({ accountId: ACCOUNT, databaseId: DATABASE, apiToken: TOKEN, fetch: fetchFn });

test("a statement goes to the account's database URL with the bearer token and its bound values", async () => {
  const cf = fakeCloudflare();
  await rest(cf.fetch).prepare("INSERT INTO tokens (token, symbol, ticker) VALUES (?, ?, ?)").bind("0x" + "a".repeat(40), "AAA", "AAA").run();
  assert.equal(cf.calls.length, 1);
  assert.equal(cf.calls[0].url, URL_OK);
  assert.equal(cf.calls[0].auth, `Bearer ${TOKEN}`);
  assert.deepEqual(cf.calls[0].body.params, ["0x" + "a".repeat(40), "AAA", "AAA"]);
});

test("run reports how many rows changed, first gives one row or null, all gives every row", async () => {
  const cf = fakeCloudflare();
  const db = rest(cf.fetch);
  const ins = await db.prepare("INSERT OR IGNORE INTO tokens (token, symbol, ticker) VALUES (?, ?, ?)").bind("0x" + "b".repeat(40), "BBB", "BBB").run();
  assert.equal(ins.meta.changes, 1);
  const again = await db.prepare("INSERT OR IGNORE INTO tokens (token, symbol, ticker) VALUES (?, ?, ?)").bind("0x" + "b".repeat(40), "BBB", "BBB").run();
  assert.equal(again.meta.changes, 0);
  const one = await db.prepare("SELECT token FROM tokens WHERE token = ?").bind("0x" + "b".repeat(40)).first<{ token: string }>();
  assert.equal(one?.token, "0x" + "b".repeat(40));
  assert.equal(await db.prepare("SELECT token FROM tokens WHERE token = ?").bind("0x" + "c".repeat(40)).first(), null);
  const many = await db.prepare("SELECT token FROM tokens").all<{ token: string }>();
  assert.equal(many.results.length, 1);
});

test("INSERT ... RETURNING comes back as a row (the run note needs its id)", async () => {
  const cf = fakeCloudflare();
  const store = new D1CollectorStore(rest(cf.fetch));
  const id = await store.startRun(1_700_000_000_000);
  assert.equal(id, 1);
  await store.finishRun(id, 1_700_000_005_000, { ok: true });
  const row = cf.db.raw.prepare("SELECT started_ms, finished_ms, stats FROM collector_runs WHERE id = 1").get() as any;
  assert.equal(row.finished_ms, 1_700_000_005_000);
  assert.equal(row.stats, '{"ok":true}');
});

test("the real store works unchanged through the REST adapter: token, facts queue, cursor that only moves forward", async () => {
  const cf = fakeCloudflare();
  const store = new D1CollectorStore(rest(cf.fetch));
  await store.ensureToken("0x" + "d".repeat(40), "DDD", "ddd");
  assert.equal((await store.getToken("0x" + "d".repeat(40)))?.symbol, "DDD");
  assert.equal((await store.tokensNeedingFacts(3, 10)).length, 1);
  assert.equal(await store.getCursor("launches"), null);
  await store.setCursor("launches", 500);
  await store.setCursor("launches", 400);
  assert.equal(await store.getCursor("launches"), 500);
});

test("a rejected statement throws with Cloudflare's reason and the HTTP status", async () => {
  const cf = fakeCloudflare();
  await assert.rejects(
    rest(cf.fetch).prepare("SELECT nope FROM nowhere").run(),
    (e: unknown) => e instanceof D1RestError && e.status === 400 && /no such table/i.test(e.message),
  );
});

test("a wrong token (HTTP 403 with success:false) throws, never returns empty data", async () => {
  const fetchFn: typeof fetch = async () => Response.json({ success: false, errors: [{ code: 10000, message: "Authentication error" }], result: null }, { status: 403 });
  await assert.rejects(rest(fetchFn).prepare("SELECT 1").first(), (e: unknown) => e instanceof D1RestError && e.status === 403 && /Authentication error/.test(e.message));
});

test("an answer that is not JSON throws instead of looking like zero rows", async () => {
  const fetchFn: typeof fetch = async () => new Response("<html>Bad gateway</html>", { status: 502 });
  await assert.rejects(rest(fetchFn).prepare("SELECT 1").all(), (e: unknown) => e instanceof D1RestError && e.status === 502 && /not JSON/.test(e.message));
});

test("HTTP 200 with success:true but no result entry throws", async () => {
  const fetchFn: typeof fetch = async () => Response.json({ success: true, errors: [], result: [] });
  await assert.rejects(rest(fetchFn).prepare("SELECT 1").first(), /no result/);
});

test("a statement is sent once: a failed call is not retried (a retry could write twice)", async () => {
  let n = 0;
  const fetchFn: typeof fetch = async () => {
    n++;
    return Response.json({ success: false, errors: [{ message: "timeout" }] }, { status: 500 });
  };
  await assert.rejects(rest(fetchFn).prepare("INSERT INTO collector_runs (started_ms) VALUES (?)").bind(1).run());
  assert.equal(n, 1);
});

test("bad settings are refused at once, with no network call", () => {
  const f = (async () => { throw new Error("must not be called"); }) as unknown as typeof fetch;
  assert.throws(() => createD1Rest({ accountId: "short", databaseId: DATABASE, apiToken: TOKEN, fetch: f }), /accountId/);
  assert.throws(() => createD1Rest({ accountId: ACCOUNT, databaseId: "not-a-uuid", apiToken: TOKEN, fetch: f }), /databaseId/);
  assert.throws(() => createD1Rest({ accountId: ACCOUNT, databaseId: DATABASE, apiToken: "", fetch: f }), /apiToken/);
});

test("the API token never appears in an error message", async () => {
  const fetchFn: typeof fetch = async () => Response.json({ success: false, errors: [{ message: "denied" }] }, { status: 403 });
  await assert.rejects(rest(fetchFn).prepare("SELECT 1").first(), (e: unknown) => e instanceof Error && !e.message.includes(TOKEN));
});
