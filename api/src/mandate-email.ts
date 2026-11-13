// Email alerts for mandates, sent through Resend (https://resend.com). Optional: without RESEND_API_KEY the worker
// passes no sender and a mandate that asks for email is refused at creation (400 email_unavailable), before it costs
// anything. The watcher decides WHEN to email (mandate-object.ts); this file only checks addresses, writes the
// message and sends it.
import { ApiError } from "./api-error.ts";
import type { Change, Signal } from "./mandate-service.ts";

export const MAX_EMAILS_PER_MANDATE = 20; // 7 days of flips between exit/watch/hold rarely needs more
export const DEFAULT_MAIL_FROM = "Reinkeep <alerts@reinkeep.xyz>";
const RESEND_URL = "https://api.resend.com/emails";
const EMAIL_TIMEOUT_MS = 5000;

export type EmailMessage = { to: string; subject: string; text: string; idempotencyKey: string };
export type EmailResult = { sent: boolean; status: number | null };
export type SendEmail = (msg: EmailMessage) => Promise<EmailResult>;

// Plain shape check, no lookups. Lower-cases the domain only (the local part can be case-sensitive).
const EMAIL = /^[^\s@<>()",;:\\[\]]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
export function checkEmail(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 254 || !EMAIL.test(raw)) throw new ApiError(400, "invalid_email", "email must be a plain address like name@example.com.");
  const at = raw.lastIndexOf("@");
  return raw.slice(0, at) + "@" + raw.slice(at + 1).toLowerCase();
}

// What GET /mandates/{id} shows: enough to recognise your own address, not enough to harvest it.
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return email[0] + "***" + email.slice(at);
}

const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const MEANING: Record<Signal["action"], string> = {
  exit: "EXIT: a blocking rule fired or the contract gained a power or changed hands. Consider selling or stopping.",
  watch: "WATCH: something changed or needs a closer look (or the chain could not be read).",
  hold: "HOLD: the token passes the rules again and nothing changed.",
};

export function signalEmail(to: string, s: Signal, changes: Change[], apiBase: string): EmailMessage {
  const lines = [
    MEANING[s.action],
    "",
    `Token: ${s.token}`,
    `Decision: ${s.decision}`,
    ...(s.reasons.length ? [`Rules: ${s.reasons.join(", ")}`] : []),
    ...(changes.length ? ["Changes:", ...changes.map((c) => `  ${c.field}: ${String(c.before)} -> ${String(c.after)}`)] : []),
    "",
    `Signed signal and full history: ${apiBase}/api/v1/mandates/${s.mandate}/events`,
    `Stop these emails: DELETE ${apiBase}/api/v1/mandates/${s.mandate}`,
    "",
    "Reinkeep never trades for you. You get at most one email each time the signal changes.",
  ];
  return { to, subject: `Reinkeep: ${s.action.toUpperCase()} on ${short(s.token)}`, text: lines.join("\n"), idempotencyKey: `${s.mandate}-${s.issuedAt}` };
}

// One attempt, 5 s, like webhooks. A failure is recorded on the event and the watcher tries again on the next check.
export function resendSender(apiKey: string, from: string, fetchFn: typeof fetch): SendEmail {
  return async (msg) => {
    try {
      const res = await fetchFn(RESEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": msg.idempotencyKey },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
        signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
      });
      await res.body?.cancel().catch(() => {});
      return { sent: res.status >= 200 && res.status < 300, status: res.status };
    } catch {
      return { sent: false, status: null };
    }
  };
}
