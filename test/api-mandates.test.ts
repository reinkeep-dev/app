// Mandates: watch a held token for 7 days, re-reading its contract every 30 minutes, with signed exit/watch/hold signals
// HMAC-signed webhooks and email alerts. Driven with a fake clock, a fake chain reader and a fake Durable Object storage. No network.
import assert from "node:assert/strict";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { ContractFacts } from "../collector/src/types.ts";
import type { TokenFacts } from "../collector/src/token-facts.ts";
import { MandateWatcher, TEST_GAP_MS, watcherFetch, type MandateStorage } from "../api/src/mandate-object.ts";
import { handleMandates, type MandateNamespace } from "../api/src/mandate-routes.ts";
import {
  CHECK_EVERY_MS, FIELD_ROLE, MANDATE_MS, MAX_EVENTS, checkWebhookUrl, chooseAction, diffContract, verifySignal, webhookSignature, type FreshRead,
} from "../api/src/mandate-service.ts";
import { FreeTier } from "../api/src/metering.ts";
import { MAX_EMAILS_PER_MANDATE, checkEmail, maskEmail, resendSender, type EmailMessage } from "../api/src/mandate-email.ts";
import { makeWorker } from "../api/src/worker.ts";

const T0 = 1_700_000_000_000;
const TOKEN = "0x00000000000000000000000000000000000000f1";
const OWNER = "0x00000000000000000000000000000000000000aa";
const HOOK = "https://agent.example.com/hooks/reinkeep";

const contract = (over: Partial<ContractFacts> = {}): ContractFacts => ({
  token: TOKEN, readAtMs: T0, scannerVersion: 2, isContract: true, codeSize: 4000, isProxy: false, implementation: null,
  hasMint: false, hasPause: false, hasBlacklist: false, hasUpgrade: false, hasOwnerFunction: true, owner: OWNER, ownerRenounced: false,
  mintWithLiveOwner: false, totalSupply: "1000000", decimals: 18, symbol: "CLEAN", ...over,
});
// The sheet the rules read, built the way buildTokenFacts would for a clean, liquid token.
const sheetOf = (c: ContractFacts, over: Partial<TokenFacts> = {}): TokenFacts => ({
  token: TOKEN, ticker: "CLEAN", facts_read_at_ms: c.readAtMs, is_contract: c.isContract, is_proxy: c.isProxy, has_mint: c.hasMint, has_pause: c.hasPause,
  has_blacklist: c.hasBlacklist, has_upgrade: c.hasUpgrade, has_owner_function: c.hasOwnerFunction, owner_renounced: c.ownerRenounced,
  mint_with_live_owner: c.mintWithLiveOwner, total_supply: c.totalSupply, decimals: c.decimals, pool_count: 1, seen_age_minutes: 5,
  seen_liquidity_usd: 25_000, seen_volume_usd: 100, seen_swaps: 10, liquidity_not_reported: false, ticker_uses: 1, ticker_clone_of_older: false, ...over,
});

function memoryStorage() {
  const map = new Map<string, unknown>();
  const alarms: (number | null)[] = [];
  const s: MandateStorage & { map: Map<string, unknown>; alarm: number | null; alarms: (number | null)[] } = {
    map, alarm: null, alarms,
    get: async <T>(k: string) => structuredClone(map.get(k)) as T | undefined,
    put: async (k, v) => void map.set(k, structuredClone(v)),
    delete: async (k) => map.delete(k),
    list: async <T>({ prefix, start, limit }: { prefix: string; start?: string; limit?: number }) => {
      const keys = [...map.keys()].filter((k) => k.startsWith(prefix) && (start === undefined || k >= start)).sort().slice(0, limit ?? Infinity);
      return new Map(keys.map((k) => [k, structuredClone(map.get(k)) as T]));
    },
    setAlarm: async (at) => void alarms.push((s.alarm = at)),
    deleteAlarm: async () => void alarms.push((s.alarm = null)),
  };
  return s;
}

type Hook = { url: string; headers: Headers; body: string };
function bench(o: { webhookStatus?: number; mail?: { status: number } } = {}) {
  const account = privateKeyToAccount(generatePrivateKey());
  const clock = { now: T0 };
  const chain = { facts: contract(), sheetOver: {} as Partial<TokenFacts>, fail: false as boolean | string };
  const hooks: Hook[] = [];
  const storage = memoryStorage();
  const readFresh = async (): Promise<FreshRead> => {
    if (chain.fail) throw new Error(typeof chain.fail === "string" ? chain.fail : "rpc down");
    const c = { ...chain.facts, readAtMs: clock.now };
    return { contract: c, sheet: sheetOf(c, chain.sheetOver) };
  };
  const fetchFn = (async (url: string, init: RequestInit) => {
    hooks.push({ url, headers: new Headers(init.headers), body: String(init.body) });
    return new Response("ok", { status: o.webhookStatus ?? 200 });
  }) as unknown as typeof fetch;
  const mails: EmailMessage[] = [];
  const sendEmail = o.mail ? async (msg: EmailMessage) => (mails.push(msg), { sent: o.mail!.status < 300, status: o.mail!.status }) : undefined;
  const w = new MandateWatcher({ storage, now: () => clock.now, account, readFresh, fetch: fetchFn, sendEmail });
  const tick = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      clock.now = storage.alarm ?? clock.now + CHECK_EVERY_MS;
      await w.alarm();
    }
  };
  return { w, account, clock, chain, hooks, storage, tick, mails, mail: o.mail };
}

const ID = "md_" + "ab".repeat(16);

test("create: first check right away, a signed HOLD for a clean token, alarm in 30 minutes, secret shown once", async () => {
  const b = bench();
  const r = await b.w.create(ID, { token: TOKEN, webhookUrl: HOOK });
  assert.equal(r.event.kind, "created");
  assert.equal(r.event.signal!.action, "hold");
  assert.equal(r.event.signal!.decision, "ALLOW");
  assert.match(r.webhookSecret!, /^whsec_[0-9a-f]{64}$/);
  assert.equal(b.storage.alarm, T0 + CHECK_EVERY_MS);
  assert.equal(r.mandate.expiresAt, new Date(T0 + MANDATE_MS).toISOString());
  const view = await b.w.get();
  assert.ok(!JSON.stringify(view).includes("whsec_"), "the secret never appears again");
  assert.equal(b.hooks.length, 1, "the first signal is pushed");
});

test("webhook: signed with HMAC-SHA256 over '<t>.<body>' with the mandate's secret; a receiver can check it", async () => {
  const b = bench();
  const { webhookSecret } = await b.w.create(ID, { token: TOKEN, webhookUrl: HOOK });
  const h = b.hooks[0];
  const sig = h.headers.get("reinkeep-signature")!;
  const t = Number(sig.match(/^t=(\d+),/)![1]);
  assert.equal(sig, await webhookSignature(webhookSecret!, t, h.body));
  assert.notEqual(sig, await webhookSignature("whsec_wrong", t, h.body));
  assert.notEqual(sig, await webhookSignature(webhookSecret!, t, h.body.replace("hold", "exit")), "a changed body fails");
  assert.equal(JSON.parse(h.body).type, "mandate.event");
});

test("a quiet token: later HOLDs are stored, not pushed (no spam), and checks are counted", async () => {
  const b = bench();
  await b.w.create(ID, { token: TOKEN, webhookUrl: HOOK });
  await b.tick(5);
  assert.equal(b.hooks.length, 1);
  assert.equal((await b.w.get()).checks, 6);
  const { events } = await b.w.events(0, 50);
  assert.deepEqual(events.map((e) => e.signal?.action), ["hold", "hold", "hold", "hold", "hold", "hold"]);
});

test("the owner changes: EXIT, the change is named, and the webhook is told", async () => {
  const b = bench();
  await b.w.create(ID, { token: TOKEN, webhookUrl: HOOK });
  b.chain.facts = contract({ owner: "0x00000000000000000000000000000000000000bb" });
  await b.tick();
  const { events } = await b.w.events(1, 10);
  assert.equal(events[0].signal!.action, "exit");
  assert.deepEqual(events[0].changes, [{ field: "owner", before: OWNER, after: "0x00000000000000000000000000000000000000bb" }]);
  assert.equal(b.hooks.length, 2);
});

test("a power appears (mint): EXIT. A power going away is a change but not an exit", async () => {
  const b = bench();
  await b.w.create(ID, { token: TOKEN, webhookUrl: null });
  b.chain.facts = contract({ hasPause: true });
  await b.tick();
  assert.equal((await b.w.get()).signal!.action, "exit");
  b.chain.facts = contract({ hasPause: false });
  await b.tick();
  assert.equal((await b.w.get()).signal!.action, "watch", "pause went away: worth a look, not a sell");
});

test("only the supply changes: WATCH, not exit", async () => {
  const b = bench();
  await b.w.create(ID, { token: TOKEN, webhookUrl: null });
  b.chain.facts = contract({ totalSupply: "2000000" });
  await b.tick();
  const s = await b.w.get();
  assert.equal(s.signal!.action, "watch");
});

test("a BLOCK rule fires (mint with a live owner): EXIT even with no change between reads", async () => {
  const b = bench();
  b.chain.facts = contract({ hasMint: true, mintWithLiveOwner: true });
  const r = await b.w.create(ID, { token: TOKEN, webhookUrl: null });
  assert.equal(r.event.signal!.decision, "BLOCK");
  assert.equal(r.event.signal!.action, "exit");
});

test("the chain cannot be read: WATCH with the error, never HOLD; the last good read is kept for comparing", async () => {
  const b = bench();
  await b.w.create(ID, { token: TOKEN, webhookUrl: HOOK });
  b.chain.fail = "node said 503";
  await b.tick();
  const { events } = await b.w.events(1, 10);
  assert.equal(events[0].signal!.action, "watch");
  assert.equal(events[0].error, "node said 503");
  assert.equal(b.hooks.length, 2, "a failed read is pushed");
  b.chain.fail = false;
  await b.tick();
  const after = await b.w.events(2, 10);
  assert.deepEqual(after.events[0].changes, [], "compared with the read before the failure: nothing changed");
  assert.equal(after.events[0].signal!.action, "hold");
});

test("7 days later the mandate expires: an 'expired' event, and the alarm stops", async () => {
  const b = bench();
  await b.w.create(ID, { token: TOKEN, webhookUrl: null });
  b.clock.now = T0 + MANDATE_MS + 1;
  b.storage.alarm = null;
  await b.w.alarm();
  const { events } = await b.w.events(0, 10);
  assert.equal(events.at(-1)!.kind, "expired");
  assert.equal(b.storage.alarm, null);
  assert.equal((await b.w.get()).state, "expired");
});

test("the last alarm is never set past the expiry", async () => {
  const b = bench();
  await b.w.create(ID, { token: TOKEN, webhookUrl: null });
  b.clock.now = T0 + MANDATE_MS - 10 * 60_000;
  await b.w.alarm();
  assert.equal(b.storage.alarm, T0 + MANDATE_MS);
});

test("renew: adds 7 days; renewing an expired mandate restarts the alarm", async () => {
  const b = bench();
  await b.w.create(ID, { token: TOKEN, webhookUrl: null });
  b.clock.now = T0 + MANDATE_MS + 5;
  await b.w.alarm();
  const r = await b.w.renew();
  assert.equal(r.mandate.state, "active");
  assert.equal(r.mandate.expiresAt, new Date(T0 + MANDATE_MS + 5 + MANDATE_MS).toISOString());
  assert.equal(b.storage.alarm, b.clock.now + CHECK_EVERY_MS);
});

test("cancel: alarm removed, state cancelled, a later alarm does nothing, renew refused", async () => {
  const b = bench();
  await b.w.create(ID, { token: TOKEN, webhookUrl: null });
  await b.w.cancel();
  assert.equal(b.storage.alarm, null);
  assert.equal((await b.w.get()).state, "cancelled");
  const before = (await b.w.events(0, 100)).events.length;
  await b.w.alarm();
  assert.equal((await b.w.events(0, 100)).events.length, before);
  await assert.rejects(b.w.renew(), (e: any) => e.status === 409);
});

test("events page by seq with a next cursor; old events past the cap are dropped", async () => {
  const b = bench();
  await b.w.create(ID, { token: TOKEN, webhookUrl: null });
  await b.tick(4);
  const p1 = await b.w.events(0, 2);
  assert.deepEqual(p1.events.map((e) => e.seq), [1, 2]);
  assert.equal(p1.next, 2);
  const p2 = await b.w.events(p1.next!, 10);
  assert.deepEqual(p2.events.map((e) => e.seq), [3, 4, 5]);
  assert.equal(p2.next, null);
  const many = bench();
  await many.w.create(ID, { token: TOKEN, webhookUrl: null });
  for (let i = 0; i < MAX_EVENTS + 5; i++) await many.w.alarm();
  const keys = [...many.storage.map.keys()].filter((k) => k.startsWith("e:"));
  assert.equal(keys.length, MAX_EVENTS);
});

test("test webhook: sends the last signal as a 'test' event; a receiver that answers 500 shows delivered:false", async () => {
  const b = bench({ webhookStatus: 500 });
  await b.w.create(ID, { token: TOKEN, webhookUrl: HOOK });
  const r = await b.w.test();
  assert.equal(r.event.kind, "test");
  assert.deepEqual(r.event.webhook, { delivered: false, status: 500 });
  const quiet = bench();
  await quiet.w.create(ID, { token: TOKEN, webhookUrl: null });
  await assert.rejects(quiet.w.test(), (e: any) => e.status === 400 && e.code === "no_webhook");
  await assert.rejects(bench().w.test(), (e: any) => e.status === 404, "no mandate at all");
});

test("test webhook: at most one a minute, so the free route cannot flood someone else's URL", async () => {
  const b = bench();
  await b.w.create(ID, { token: TOKEN, webhookUrl: HOOK });
  await b.w.test();
  await assert.rejects(b.w.test(), (e: any) => e.status === 429 && e.code === "test_too_soon");
  b.clock.now += TEST_GAP_MS;
  assert.equal((await b.w.test()).event.kind, "test");
});

test("signals verify: genuine ok, expired after an hour, a changed action or another signer fails", async () => {
  const b = bench();
  const { event } = await b.w.create(ID, { token: TOKEN, webhookUrl: null });
  const s = event.signal!;
  const nowS = Math.floor(T0 / 1000);
  assert.deepEqual(await verifySignal(s, b.account.address, nowS), { valid: true, expired: false });
  assert.deepEqual(await verifySignal(s, b.account.address, nowS + 3601), { valid: true, expired: true });
  assert.equal((await verifySignal({ ...s, action: "exit" }, b.account.address, nowS)).valid, false);
  assert.deepEqual(await verifySignal(s, privateKeyToAccount(generatePrivateKey()).address, nowS), { valid: false, reason: "not_our_signature" });
  assert.deepEqual(await verifySignal("nope", b.account.address, nowS), { valid: false, reason: "malformed" });
});

test("every contract fact has a role, so a new fact cannot be silently ignored", () => {
  for (const [k, role] of Object.entries(FIELD_ROLE)) assert.ok(["power", "control", "info", "ignore"].includes(role), k);
  assert.deepEqual(diffContract(contract(), contract({ readAtMs: 5 })), [], "bookkeeping fields never count as a change");
  assert.equal(chooseAction("ALLOW", [], true), "watch");
  assert.equal(chooseAction("ALLOW", [{ field: "hasMint", before: null, after: true }], false), "exit", "unknown -> true counts as appearing");
});

test("webhook URL: https public host only", () => {
  assert.equal(checkWebhookUrl(HOOK), HOOK);
  for (const bad of ["http://agent.example.com/x", "https://127.0.0.1/x", "https://[::1]/x", "https://localhost/x", "https://intranet/x", "https://box.internal/x", "https://u:p@agent.example.com/x", "https://agent.example.com:8443/x", "notaurl", 5]) {
    assert.throws(() => checkWebhookUrl(bad), (e: any) => e.code === "invalid_webhook", String(bad));
  }
});

// --- email alerts ---------------------------------------------------------------------------------------------

const MAIL = "Owner.Name@Example.COM";

test("email: a clean token sends nothing; turning EXIT sends one; staying EXIT sends no more; back to HOLD sends one", async () => {
  const b = bench({ mail: { status: 200 } });
  const r = await b.w.create(ID, { token: TOKEN, webhookUrl: null, email: checkEmail(MAIL) });
  assert.equal(r.event.email, undefined, "first check is HOLD: no email");
  assert.equal(r.mandate.email, "O***@example.com", "address shown masked");
  b.chain.facts = contract({ owner: "0x00000000000000000000000000000000000000bb" });
  await b.tick();
  assert.equal(b.mails.length, 1);
  assert.equal(b.mails[0].to, "Owner.Name@example.com", "local part kept, domain lower-cased");
  assert.match(b.mails[0].subject, /^Reinkeep: EXIT on 0x0000…00f1$/);
  assert.match(b.mails[0].text, /owner: 0x0+aa -> 0x0+bb/);
  assert.match(b.mails[0].text, new RegExp(`/api/v1/mandates/${ID}/events`));
  const { events } = await b.w.events(1, 10);
  assert.deepEqual(events[0].email, { sent: true, status: 200 });
  const bb = { owner: "0x00000000000000000000000000000000000000bb" };
  b.chain.facts = contract({ ...bb, hasMint: true, mintWithLiveOwner: true }); // a BLOCK rule: EXIT on every check
  await b.tick(3);
  assert.equal((await b.w.get()).signal!.action, "exit");
  assert.equal(b.mails.length, 1, "same action: no repeat email");
  b.chain.facts = contract(bb); // mint goes away: WATCH, then nothing changes: HOLD
  await b.tick(2);
  assert.equal((await b.w.get()).signal!.action, "hold");
  assert.deepEqual(b.mails.map((m) => m.subject.split(" ")[1]), ["EXIT", "WATCH", "HOLD"]);
});

test("email: a mandate that starts on EXIT emails at once; a failed send is retried next check; tries are capped", async () => {
  const b = bench({ mail: { status: 429 } });
  b.chain.facts = contract({ hasMint: true, mintWithLiveOwner: true });
  const r = await b.w.create(ID, { token: TOKEN, webhookUrl: null, email: "a@b.co" });
  assert.deepEqual(r.event.email, { sent: false, status: 429 });
  await b.tick();
  assert.equal(b.mails.length, 2, "not sent yet, so the next check tries again");
  assert.notEqual(b.mails[0].idempotencyKey, b.mails[1].idempotencyKey);
  await b.tick(MAX_EMAILS_PER_MANDATE + 5);
  assert.equal(b.mails.length, MAX_EMAILS_PER_MANDATE);
});

test("email: refused at creation when the server has no email set up; no email field means no email", async () => {
  const off = bench();
  await assert.rejects(off.w.create(ID, { token: TOKEN, webhookUrl: null, email: "a@b.co" }), (e: any) => e.code === "email_unavailable");
  const on = bench({ mail: { status: 200 } });
  on.chain.facts = contract({ hasMint: true, mintWithLiveOwner: true });
  const r = await on.w.create(ID, { token: TOKEN, webhookUrl: null });
  assert.equal(r.event.email, undefined);
  assert.equal(r.mandate.email, null);
});

test("email address: plain shape only", () => {
  assert.equal(checkEmail("x@Sub.Example.io"), "x@sub.example.io");
  assert.equal(maskEmail("bob@ex.com"), "b***@ex.com");
  for (const bad of ["", "nobody", "a@b", "a b@c.com", "a@b..com", "<a@b.com>", "a@b.com,c@d.com", "x".repeat(250) + "@b.com", 5, null]) {
    assert.throws(() => checkEmail(bad), (e: any) => e.code === "invalid_email", String(bad));
  }
});

test("resendSender: POSTs to Resend with the key, idempotency key and a text body; a network error is sent:false", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const ok = resendSender("re_test", "Reinkeep <alerts@reinkeep.xyz>", (async (url: string, init: RequestInit) => (seen.push({ url, init }), new Response('{"id":"x"}'))) as unknown as typeof fetch);
  const msg = { to: "a@b.co", subject: "s", text: "t", idempotencyKey: "md_1-2" };
  assert.deepEqual(await ok(msg), { sent: true, status: 200 });
  const h = new Headers(seen[0].init.headers);
  assert.equal(seen[0].url, "https://api.resend.com/emails");
  assert.equal(h.get("authorization"), "Bearer re_test");
  assert.equal(h.get("idempotency-key"), "md_1-2");
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), { from: "Reinkeep <alerts@reinkeep.xyz>", to: ["a@b.co"], subject: "s", text: "t" });
  const down = resendSender("re_test", "x <a@b.co>", (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
  assert.deepEqual(await down(msg), { sent: false, status: null });
});

// --- HTTP routes ---------------------------------------------------------------------------------------------

function routes() {
  const b = bench();
  const watchers = new Map<string, MandateWatcher>();
  const ns: MandateNamespace = {
    idFromName: (n) => n,
    get: (id) => ({
      fetch: (req) => {
        const key = id as string;
        if (!watchers.has(key)) {
          watchers.set(key, new MandateWatcher({ storage: memoryStorage(), now: () => b.clock.now, account: b.account, readFresh: async () => ({ contract: contract(), sheet: sheetOf(contract()) }), fetch: (async () => new Response("ok")) as unknown as typeof fetch }));
        }
        return watcherFetch(watchers.get(key)!, req);
      },
    }),
  };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await handleMandates(new Request("https://gate.test" + path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), { ns, signer: b.account.address, now: () => b.clock.now });
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
  };
  return { call, b };
}

test("HTTP: create, read, events, renew, delete, verify the signal", async () => {
  const { call } = routes();
  const c = await call("POST", "/api/v1/mandates", { token: TOKEN.toUpperCase().replace("0X", "0x"), webhookUrl: HOOK });
  assert.equal(c.status, 200);
  const id = c.data.mandate.id;
  assert.match(id, /^md_[0-9a-f]{32}$/);
  assert.equal(c.data.mandate.token, TOKEN, "address stored lower case");
  assert.equal((await call("GET", `/api/v1/mandates/${id}`)).data.state, "active");
  assert.equal((await call("GET", `/api/v1/mandates/${id}/events?after=0&limit=5`)).data.events.length, 1);
  assert.equal((await call("POST", `/api/v1/mandates/${id}/renew`)).status, 200);
  const v = await call("POST", "/api/v1/signals/verify", { signal: c.data.event.signal });
  assert.deepEqual(v.data, { valid: true, expired: false });
  assert.equal((await call("DELETE", `/api/v1/mandates/${id}`)).data.mandate.state, "cancelled");
});

test("HTTP: bad input is a clear 4xx, an unknown id is 404, a wrong method is 405, OPTIONS allows DELETE", async () => {
  const { call } = routes();
  assert.equal((await call("POST", "/api/v1/mandates", { token: "0x12" })).data.error.code, "invalid_token");
  assert.equal((await call("POST", "/api/v1/mandates", { token: TOKEN, extra: 1 })).data.error.code, "unknown_field");
  assert.equal((await call("POST", "/api/v1/mandates", { token: TOKEN, email: "nope" })).data.error.code, "invalid_email");
  assert.equal((await call("POST", "/api/v1/mandates", { token: TOKEN, webhookUrl: "http://x.example.com" })).data.error.code, "invalid_webhook");
  assert.equal((await call("GET", "/api/v1/mandates/md_" + "0".repeat(32))).status, 404);
  assert.equal((await call("GET", "/api/v1/mandates/not-an-id")).status, 404);
  assert.equal((await call("GET", "/api/v1/mandates")).status, 405);
  const id = (await call("POST", "/api/v1/mandates", { token: TOKEN })).data.mandate.id;
  assert.equal((await call("GET", `/api/v1/mandates/${id}/renew`)).status, 405);
  assert.equal((await call("GET", `/api/v1/mandates/${id}/events?after=-1`)).status, 400);
  const o = await call("OPTIONS", "/api/v1/mandates/" + id);
  assert.equal(o.status, 204);
  assert.match(o.headers.get("access-control-allow-methods")!, /DELETE/);
});

// --- metering through the real worker entry -------------------------------------------------------------------

function worker() {
  const env: any = { REINKEEP_SIGNER_KEY: generatePrivateKey() };
  const free = new Map<string, FreeTier>();
  const storage = (m: Map<string, any>) => ({ get: async (k: string) => m.get(k), put: async (k: string, v: any) => void m.set(k, structuredClone(v)) });
  env.FREE = { idFromName: (n: string) => n, get: (id: string) => ({ fetch: (req: Request) => (free.has(id) || free.set(id, new FreeTier({ storage: storage(new Map()) })), free.get(id)!.fetch(req)) }) };
  const watchers = new Map<string, MandateWatcher>();
  const account = privateKeyToAccount(env.REINKEEP_SIGNER_KEY);
  env.MANDATES = {
    idFromName: (n: string) => n,
    get: (id: string) => ({
      fetch: (req: Request) => {
        // Real time here: the worker checks signals against Date.now, so a fake clock would make every signal "expired".
        if (!watchers.has(id)) watchers.set(id, new MandateWatcher({ storage: memoryStorage(), now: Date.now, account, readFresh: async () => ({ contract: contract(), sheet: sheetOf(contract()) }), fetch: (async () => new Response("ok")) as unknown as typeof fetch }));
        return watcherFetch(watchers.get(id)!, req);
      },
    }),
  };
  const w = makeWorker((async () => new Response("{}")) as unknown as typeof fetch);
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await w.fetch(new Request("https://gate.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const text = await res.text();
    return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : null };
  };
  return { send };
}

test("a mandate costs 5 of the 25 free calls; a refused one costs nothing; past the free calls it asks for payment", async () => {
  const { send } = worker();
  const ok = await send("POST", "/api/v1/mandates", { token: TOKEN });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("x-free-calls-left"), "20");
  const bad = await send("POST", "/api/v1/mandates", { token: "nope" });
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get("x-free-calls-left"), "20", "refunded");
  for (let i = 0; i < 4; i++) assert.equal((await send("POST", "/api/v1/mandates", { token: TOKEN })).status, 200);
  const over = await send("POST", "/api/v1/mandates", { token: TOKEN });
  assert.equal(over.status, 503, "free calls used and payments not configured in this test env");
  assert.equal(over.data.error.code, "payment_not_configured");
  // Reading a mandate is free.
  const id = ok.data.mandate.id;
  assert.equal((await send("GET", `/api/v1/mandates/${id}`)).status, 200);
});

test("MCP: create_mandate, get_mandate and verify_signal work end to end through the worker", async () => {
  const { send } = worker();
  const rpc = (id: number, name: string, args: unknown) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const created = await send("POST", "/mcp", rpc(1, "create_mandate", { token: TOKEN }));
  assert.equal(created.status, 200);
  const r = created.data.result;
  assert.ok(!r.isError, JSON.stringify(r));
  assert.match(r.content[0].text, /^Mandate md_[0-9a-f]{32} watches/);
  const id = r.structuredContent.mandate.id;
  const got = (await send("POST", "/mcp", rpc(2, "get_mandate", { id }))).data.result;
  assert.match(got.content[0].text, /active, 1 checks/);
  const v = (await send("POST", "/mcp", rpc(3, "verify_signal", { signal: r.structuredContent.event.signal }))).data.result;
  assert.equal(v.content[0].text, "Valid and current.");
});
