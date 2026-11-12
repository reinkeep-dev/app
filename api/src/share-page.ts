// GET /r/{id}: one stored receipt as a small page a person can open from a link. The receipt came out of storage, so
// it is read defensively and every value is escaped (html.ts) before it is placed in the page.
import { esc, page, short, SITE_URL } from "./html.ts";
import type { Verification } from "./receipt-signing.ts";
import rules from "../../site/data/rules.json" with { type: "json" };

const PLAIN = new Map<string, string>(rules.map((r) => [r.code, r.plain]));
const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "unknown");

// "0.01" from "10000" and 6. Falls back to the raw units when the numbers are not what we expect.
function humanAmount(amount: unknown, decimals: unknown): string | null {
  if (typeof amount !== "string" || !/^\d+$/.test(amount) || typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 30) return null;
  const d = amount.padStart(decimals + 1, "0");
  const whole = d.slice(0, d.length - decimals).replace(/^0+(?=\d)/, "");
  const frac = d.slice(d.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

const row = (k: string, v: string) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;

export function sharePage(id: string, stored: unknown, check: Verification): Response {
  const r = isObj(stored) ? stored : {};
  const body = isObj(r.body) ? r.body : {};
  const req = isObj(body.request) ? body.request : {};
  const decision = ["ALLOW", "REVIEW", "BLOCK"].includes(r.decision) ? (r.decision as string) : "UNKNOWN";
  const codes: string[] = Array.isArray(body.reasons) ? body.reasons.filter((c: unknown): c is string => typeof c === "string") : [];
  const issued = typeof r.issuedAt === "number" && Number.isFinite(r.issuedAt) ? new Date(r.issuedAt * 1000).toISOString() : null;

  const reasons = codes.length
    ? `<ul>${codes.map((c) => `<li><code>${esc(c)}</code>${PLAIN.get(c) ? ` ${esc(PLAIN.get(c))}` : ""}</li>`).join("")}</ul>`
    : `<p class="muted">No rule objected.</p>`;

  const human = humanAmount(req.amount, req.decimals);
  const payment = [
    row("Amount", human ? `${esc(human)} <span class="muted">(${esc(text(req.amount))} base units, ${esc(text(req.decimals))} decimals)</span>` : esc(text(req.amount))),
    row("Pay to", `<code title="${esc(text(req.payTo))}">${esc(short(text(req.payTo)))}</code>`),
    row("Network", esc(text(req.network))),
    row("Resource", `<span class="mono">${esc(text(req.resourceUrl))}</span>`),
  ].join("");

  let token = "";
  if (isObj(body.buying)) {
    const facts = isObj(body.buying.facts) ? body.buying.facts : null;
    const lines = facts
      ? Object.entries(facts)
          .filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v))
          .map(([k, v]) => row(k, v === null ? `<span class="muted">unknown</span>` : esc(String(v))))
          .join("")
      : "";
    token = `<h2>Token it buys</h2><p class="mono">${esc(text(body.buying.token))}</p>${facts ? `<dl>${lines}</dl>` : `<p class="muted">No data on this token.</p>`}`;
  }

  let judge = "";
  if (isObj(body.judgement)) {
    const j = body.judgement;
    const cites: string[] = Array.isArray(j.cites) ? j.cites.filter((c: unknown): c is string => typeof c === "string") : [];
    const conf = typeof j.confidence === "number" && Number.isFinite(j.confidence) ? `${Math.round(j.confidence * 100)}%` : "unknown";
    judge =
      `<h2>AI Judge (advisory)</h2><p class="muted">A model's second opinion on this REVIEW. It did not change the decision above.</p>` +
      `<dl>${row("Leans", esc(text(j.lean)))}${row("Confidence", esc(conf))}${row("Rests on", cites.map((c) => `<code>${esc(c)}</code>`).join(" ") || `<span class="muted">none</span>`)}${row("Model", `<span class="mono">${esc(text(j.model))}</span>`)}</dl>` +
      (typeof j.note === "string" ? `<p>${esc(j.note)}</p>` : "");
  }

  const valid = check.valid
    ? `<span class="ok">Valid signature.</span> Signed by <code>${esc(check.signer)}</code>.`
    : `<span class="bad">Not valid:</span> ${esc(check.reason)}.`;

  const html = `
<h1>Reinkeep AI receipt</h1>
<p class="verdict ${esc(decision)}">${esc(decision)}</p>
<p class="muted">Answer to a check made before paying. Nothing was paid by this check.</p>
<h2>Why</h2>${reasons}
<h2>The payment that was checked</h2><dl>${payment}</dl>
${token}
${judge}
<h2>Receipt</h2>
<dl>${row("ID", `<code>${esc(id)}</code>`)}${row("Issued", issued ? esc(issued) : `<span class="muted">unknown</span>`)}${row("Signer", `<code>${esc(text(r.signer))}</code>`)}${row("Check", valid)}</dl>
<footer>
<a href="/api/v1/receipts/${esc(encodeURIComponent(id))}">Receipt as JSON</a> &middot; <a href="${SITE_URL}">Reinkeep AI</a>
<p class="muted">Rule-based. Reviewed by our team, no outside audit yet. Not financial advice.</p>
</footer>`;
  return page(`${decision} · Reinkeep AI receipt`, html, 200, { "cache-control": "public, max-age=60" });
}

export function missingPage(): Response {
  return page("Receipt not found · Reinkeep AI", `<h1>Reinkeep AI receipt</h1><p class="verdict">Not found</p><p class="muted">No receipt with this id is stored here.</p><footer><a href="${SITE_URL}">Reinkeep AI</a></footer>`, 404, { "cache-control": "no-store" });
}
