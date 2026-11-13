// One watcher per mandate. On Cloudflare it is a Durable Object (class MandateWatch, one instance worldwide per mandate
// id) that wakes itself with an alarm every 30 minutes until the mandate expires. The work is in MandateWatcher, which
// takes its storage, clock, chain reader and fetch as arguments, so the Node tests drive it with a fake clock.
//
// Internal routes (only the worker calls them, with the mandate id already checked):
//   POST /create {token, webhookUrl, email}   GET /get   GET /events?after=N&limit=N   POST /renew   POST /cancel   POST /test
import type { PrivateKeyAccount } from "viem/accounts";
import type { TokenFactSheet } from "../../engine/policy.ts";
import { ApiError } from "./api-error.ts";
import { BASE_URL } from "./discovery.ts";
import { MAX_EMAILS_PER_MANDATE, signalEmail, type EmailResult, type SendEmail } from "./mandate-email.ts";
import {
  CHECK_EVERY_MS, MANDATE_MS, MAX_EVENTS, chooseAction, diffContract, judgeSheet, newWebhookSecret, publicView, signSignal, webhookSignature,
  type Change, type EventKind, type FreshRead, type Mandate, type MandateEvent, type MandateInput, type Signal,
} from "./mandate-service.ts";

// The slice of Durable Object storage used here (a Map-backed fake implements it in the tests).
export type MandateStorage = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string; start?: string; limit?: number }): Promise<Map<string, T>>;
  setAlarm(atMs: number): Promise<void>;
  deleteAlarm(): Promise<void>;
};

export type WatcherDeps = {
  storage: MandateStorage;
  now: () => number;
  account: PrivateKeyAccount;
  readFresh: (token: string) => Promise<FreshRead>;
  fetch: typeof fetch;
  sendEmail?: SendEmail; // absent when RESEND_API_KEY is not set: email mandates are then refused
};

const WEBHOOK_TIMEOUT_MS = 5000;
export const TEST_GAP_MS = 60_000;
const eventKey = (seq: number) => "e:" + String(seq).padStart(8, "0");
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export class MandateWatcher {
  private d: WatcherDeps;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(deps: WatcherDeps) {
    this.d = deps;
  }

  // One operation at a time per mandate: a check and a renew never interleave their read-modify-write.
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const step = this.tail.then(fn);
    this.tail = step.catch(() => undefined);
    return step;
  }

  private load = () => this.d.storage.get<Mandate>("m");
  private async need(): Promise<Mandate> {
    const m = await this.load();
    if (!m) throw new ApiError(404, "mandate_not_found", "No mandate with this id.");
    return m;
  }

  create(id: string, input: MandateInput) {
    return this.serial(async () => {
      if (await this.load()) throw new ApiError(409, "mandate_exists", "A mandate with this id already exists.");
      if (input.email && !this.d.sendEmail) throw new ApiError(400, "email_unavailable", "Email alerts are not set up on this server; use webhookUrl or poll the events.");
      const now = this.d.now();
      const m: Mandate = {
        id, token: input.token, webhookUrl: input.webhookUrl, webhookSecret: input.webhookUrl ? newWebhookSecret() : null,
        email: input.email ?? null, emailedAction: "hold", emailsSent: 0,
        createdAt: now, expiresAt: now + MANDATE_MS, cancelled: false, checks: 0, last: null, lastSignal: null, nextSeq: 1,
      };
      const event = await this.check(m, "created");
      await this.d.storage.setAlarm(now + CHECK_EVERY_MS);
      // The secret is in this answer and nowhere else, ever.
      return { mandate: publicView(m, now), webhookSecret: m.webhookSecret, event };
    });
  }

  get() {
    return this.serial(async () => publicView(await this.need(), this.d.now()));
  }

  async events(after: number, limit: number): Promise<{ events: MandateEvent[]; next: number | null }> {
    await this.need();
    const n = Math.min(Math.max(1, limit), 100);
    const found = await this.d.storage.list<MandateEvent>({ prefix: "e:", start: eventKey(Math.max(0, after) + 1), limit: n + 1 });
    const all = [...found.values()];
    const events = all.slice(0, n);
    return { events, next: all.length > n ? events[events.length - 1].seq : null };
  }

  renew() {
    return this.serial(async () => {
      const m = await this.need();
      if (m.cancelled) throw new ApiError(409, "mandate_cancelled", "This mandate was cancelled; create a new one.");
      const now = this.d.now();
      const wasExpired = now >= m.expiresAt;
      m.expiresAt = Math.max(m.expiresAt, now) + MANDATE_MS;
      const event = await this.append(m, { kind: "renewed", changes: [] });
      await this.d.storage.put("m", m);
      if (wasExpired) await this.d.storage.setAlarm(now + CHECK_EVERY_MS); // the alarm had stopped at expiry
      return { mandate: publicView(m, now), event };
    });
  }

  cancel() {
    return this.serial(async () => {
      const m = await this.need();
      if (!m.cancelled) {
        m.cancelled = true;
        await this.append(m, { kind: "cancelled", changes: [] });
        await this.d.storage.put("m", m);
        await this.d.storage.deleteAlarm();
      }
      return { mandate: publicView(m, this.d.now()) };
    });
  }

  // Sends the last signal to the webhook as a "test" event, so the receiver can check its signature code.
  test() {
    return this.serial(async () => {
      const m = await this.need();
      if (!m.webhookUrl) throw new ApiError(400, "no_webhook", "This mandate has no webhookUrl.");
      // One test a minute: this route is free, so without a pause it could be looped to flood someone else's URL.
      const last = (await this.d.storage.get<number>("lastTest")) ?? 0;
      if (this.d.now() - last < TEST_GAP_MS) throw new ApiError(429, "test_too_soon", "One webhook test a minute. Try again shortly.");
      await this.d.storage.put("lastTest", this.d.now());
      const event = await this.append(m, { kind: "test", changes: [], signal: m.lastSignal ?? undefined }, true);
      await this.d.storage.put("m", m);
      return { event };
    });
  }

  // The scheduled wake-up.
  alarm() {
    return this.serial(async () => {
      const m = await this.load();
      if (!m || m.cancelled) return;
      const now = this.d.now();
      if (now >= m.expiresAt) {
        await this.append(m, { kind: "expired", changes: [] }, true);
        await this.d.storage.put("m", m);
        return; // no further alarm
      }
      await this.check(m, "check");
      await this.d.storage.setAlarm(Math.min(now + CHECK_EVERY_MS, m.expiresAt));
    });
  }

  // Read, judge, compare, sign, store. A failed read is recorded (watch), never treated as "nothing changed".
  private async check(m: Mandate, kind: EventKind): Promise<MandateEvent> {
    const now = this.d.now();
    let sheet: TokenFactSheet | null = null;
    let changes: Change[] = [];
    let error: string | undefined;
    try {
      const fresh = await this.d.readFresh(m.token);
      sheet = fresh.sheet;
      if (m.last) changes = diffContract(m.last, fresh.contract);
      m.last = fresh.contract;
    } catch (e) {
      error = message(e);
    }
    const { decision, reasons } = judgeSheet(m.token, sheet);
    const action = chooseAction(decision, changes, error !== undefined);
    const signal = await signSignal(this.d.account, { mandate: m.id, token: m.token, action, decision, reasons, sheet, nowMs: now });
    // Tell the webhook when something happened: the first check, any change, a different action, or a failed read.
    // A repeat "hold" with no change is only stored (agents can poll), so a quiet token does not spam its owner.
    const notify = kind === "created" || changes.length > 0 || error !== undefined || m.lastSignal?.action !== action;
    m.checks++;
    m.lastSignal = signal;
    const email = await this.mail(m, signal, changes);
    const event = await this.append(m, { kind, changes, error, signal, ...(email && { email }) }, notify);
    await this.d.storage.put("m", m);
    return event;
  }

  private async append(m: Mandate, e: Omit<MandateEvent, "seq" | "at">, notify = false): Promise<MandateEvent> {
    const event: MandateEvent = { seq: m.nextSeq++, at: new Date(this.d.now()).toISOString(), ...e };
    if (notify && m.webhookUrl && m.webhookSecret) event.webhook = await this.deliver(m, event);
    await this.d.storage.put(eventKey(event.seq), event);
    const drop = event.seq - MAX_EVENTS;
    if (drop > 0) await this.d.storage.delete(eventKey(drop));
    return event;
  }

  // Email is stricter than the webhook: only when the action differs from the last email that went out (starting
  // from "hold", so a clean token sends nothing), at most MAX_EMAILS_PER_MANDATE tries. A failed send leaves
  // emailedAction as it was, so the next check tries again.
  // ponytail: no global daily cap here (each watcher only sees itself); Resend's own limit (free plan 100/day) is the
  // ceiling. Add a shared counter (FreeTier-style Durable Object) if email mandates ever get abused.
  private async mail(m: Mandate, signal: Signal, changes: Change[]): Promise<EmailResult | undefined> {
    if (!m.email || !this.d.sendEmail) return undefined;
    if (signal.action === (m.emailedAction ?? "hold") || (m.emailsSent ?? 0) >= MAX_EMAILS_PER_MANDATE) return undefined;
    m.emailsSent = (m.emailsSent ?? 0) + 1;
    const r = await this.d.sendEmail(signalEmail(m.email, signal, changes, BASE_URL));
    if (r.sent) m.emailedAction = signal.action;
    return r;
  }

  // One attempt, 5 s. A receiver that is down misses the push, never the event: it stays in /events.
  private async deliver(m: Mandate, event: MandateEvent): Promise<{ delivered: boolean; status: number | null }> {
    const body = JSON.stringify({ type: "mandate.event", mandate: m.id, token: m.token, event });
    const t = Math.floor(this.d.now() / 1000);
    try {
      const res = await this.d.fetch(m.webhookUrl!, {
        method: "POST",
        headers: { "content-type": "application/json", "reinkeep-signature": await webhookSignature(m.webhookSecret!, t, body), "user-agent": "Reinkeep-Mandates/1" },
        body,
        redirect: "manual", // a redirect could point anywhere; the receiver must answer at the URL it gave
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      await res.body?.cancel().catch(() => {});
      return { delivered: res.status >= 200 && res.status < 300, status: res.status };
    } catch {
      return { delivered: false, status: null };
    }
  }
}

// The HTTP face the worker talks to. Errors come back as { error: {code, message} } with the right status.
export async function watcherFetch(w: MandateWatcher, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const reply = (status: number, body: unknown) => Response.json(body, { status });
  try {
    switch (`${req.method} ${url.pathname}`) {
      case "POST /create": {
        const body = (await req.json()) as { id: string; input: MandateInput };
        return reply(201, await w.create(body.id, body.input));
      }
      case "GET /get":
        return reply(200, await w.get());
      case "GET /events": {
        const num = (k: string, d: number) => (Number.isSafeInteger(Number(url.searchParams.get(k))) && url.searchParams.get(k) !== null ? Number(url.searchParams.get(k)) : d);
        return reply(200, await w.events(num("after", 0), num("limit", 50)));
      }
      case "POST /renew":
        return reply(200, await w.renew());
      case "POST /cancel":
        return reply(200, await w.cancel());
      case "POST /test":
        return reply(200, await w.test());
      default:
        return reply(404, { error: { code: "not_found", message: "Unknown watcher route." } });
    }
  } catch (e) {
    if (e instanceof ApiError) return reply(e.status, { error: { code: e.code, message: e.message } });
    console.error("mandate watcher error", e);
    return reply(500, { error: { code: "internal", message: "Something went wrong on our side." } });
  }
}
