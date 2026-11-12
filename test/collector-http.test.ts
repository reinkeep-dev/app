import test from "node:test";
import assert from "node:assert/strict";
import { BlockedError, BudgetExhausted, createBudget, HttpError, requestJson, USER_AGENT, type Fetcher } from "../collector/src/http-json.ts";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const scripted = (...steps: (Response | Error)[]) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: Fetcher = async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step.clone();
  };
  return { fetch, calls };
};
const sleeps = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
};
const URL1 = "https://api.example.test/x";

test("a normal answer is parsed and the request is honest about who is asking", async () => {
  const net = scripted(ok({ a: 1 }));
  const s = sleeps();
  assert.deepEqual(await requestJson(URL1, { method: "GET" }, { fetch: net.fetch, sleep: s.sleep }), { a: 1 });
  const headers = net.calls[0].init!.headers as Record<string, string>;
  assert.equal(headers["user-agent"], USER_AGENT);
  assert.match(USER_AGENT, /reinkeep-collector/);
  assert.doesNotMatch(USER_AGENT, /mozilla|chrome|safari/i, "never disguised as a browser");
  assert.deepEqual(s.waits, []);
});

test("'slow down' (429) is retried with a growing pause, then succeeds", async () => {
  const net = scripted(new Response("", { status: 429 }), new Response("", { status: 429 }), ok({ done: true }));
  const s = sleeps();
  assert.deepEqual(await requestJson(URL1, { method: "GET" }, { fetch: net.fetch, sleep: s.sleep }), { done: true });
  assert.equal(net.calls.length, 3);
  assert.deepEqual(s.waits, [2000, 4000]);
});

test("Retry-After is honoured, and capped so one answer cannot stall a run", async () => {
  const net = scripted(new Response("", { status: 429, headers: { "retry-after": "7" } }), new Response("", { status: 429, headers: { "retry-after": "9999" } }), ok({}));
  const s = sleeps();
  await requestJson(URL1, { method: "GET" }, { fetch: net.fetch, sleep: s.sleep, maxRetryAfterMs: 30_000 });
  assert.deepEqual(s.waits, [7000, 30_000]);
});

test("server errors and network failures are retried; giving up says why", async () => {
  const flaky = scripted(new Response("", { status: 503 }), new Error("socket hang up"), ok({ fine: 1 }));
  assert.deepEqual(await requestJson(URL1, { method: "GET" }, { fetch: flaky.fetch, sleep: sleeps().sleep }), { fine: 1 });

  const dead = scripted(new Response("", { status: 500 }));
  await assert.rejects(requestJson(URL1, { method: "GET" }, { fetch: dead.fetch, sleep: sleeps().sleep, tries: 3 }), (e: any) => e instanceof HttpError && /gave up after 3 tries \(HTTP 500\)/.test(e.message));
  assert.equal(dead.calls.length, 3);
});

test("a client error (404, 403 without a challenge) is NOT retried", async () => {
  for (const status of [400, 403, 404]) {
    const net = scripted(new Response("no", { status }));
    await assert.rejects(requestJson(URL1, { method: "GET" }, { fetch: net.fetch, sleep: sleeps().sleep }), (e: any) => e instanceof HttpError && e.status === status);
    assert.equal(net.calls.length, 1, `HTTP ${status} tried once`);
  }
});

test("a bot check is a hard stop: one request, no retry, no workaround", async () => {
  const net = scripted(new Response("<html>Just a moment...</html>", { status: 403, headers: { "cf-mitigated": "challenge", "content-type": "text/html" } }));
  const s = sleeps();
  await assert.rejects(requestJson(URL1, { method: "GET" }, { fetch: net.fetch, sleep: s.sleep }), (e: any) => e instanceof BlockedError && /human check/.test(e.message));
  assert.equal(net.calls.length, 1);
  assert.deepEqual(s.waits, [], "it did not even pause to try again");
});

test("an answer that is not JSON is an error that says so", async () => {
  const net = scripted(new Response("<html>oops</html>", { status: 200 }));
  await assert.rejects(requestJson(URL1, { method: "GET" }, { fetch: net.fetch, sleep: sleeps().sleep }), /did not return JSON/);
});

test("a spent budget stops the request at once: no retries, no waiting", async () => {
  const inner = scripted(ok({}));
  const b = createBudget(0, inner.fetch);
  const s = sleeps();
  await assert.rejects(requestJson(URL1, { method: "GET" }, { fetch: b.fetch, sleep: s.sleep }), BudgetExhausted);
  assert.deepEqual(s.waits, []);
  assert.equal(inner.calls.length, 0);
});

test("the request budget counts every request and refuses past the limit", async () => {
  const inner = scripted(ok({}));
  const b = createBudget(3, inner.fetch);
  assert.equal(b.left(), 3);
  await b.fetch("https://a.test/1");
  await b.fetch("https://a.test/2");
  assert.equal(b.used(), 2);
  assert.equal(b.left(), 1);
  await b.fetch("https://a.test/3");
  assert.throws(() => b.fetch("https://a.test/4"), /budget of 3 is used up/);
  assert.equal(inner.calls.length, 3, "the refused request never left");
  assert.equal(b.left(), 0);
});
