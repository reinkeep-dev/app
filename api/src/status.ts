// GET /api/status (JSON) and GET /status (HTML): is the gate wired up? Each check is { ok, detail, critical }.
// Overall ok = every critical check ok. The checks run in parallel, each cut off after 3 seconds.
// Nothing secret or revealing is ever printed: the signer is shown by public address only, the RPC and facilitator by
// "reachable" (never their URLs), keys and the payout address only as "set". Errors are never copied into a detail.
import { privateKeyToAccount } from "viem/accounts";
import type { D1Like } from "../../collector/src/collector-store.ts";
import type { RpcClient } from "../../collector/src/contract-facts.ts";
import { esc, page } from "./html.ts";
import { json } from "./http-handler.ts";
import { DEFAULT_FACILITATOR } from "./x402.ts";

export const STATUS_TIMEOUT_MS = 3000;
const KEY = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export type StatusEnv = {
  REINKEEP_SIGNER_KEY?: string;
  DB?: D1Like;
  AI?: unknown;
  FREE?: unknown;
  X402_PAY_TO?: string;
  PRIORS_API_KEY?: string;
  FACILITATOR_URL?: string;
};
export type Check = { ok: boolean; detail: string; critical: boolean };
export type StatusReport = { ok: boolean; checkedAt: string; checks: Record<string, Check> };

// A check that throws or takes too long is a failed check with a fixed sentence, never the error text.
async function guarded(critical: boolean, ms: number, run: () => Promise<{ ok: boolean; detail: string }>): Promise<Check> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const slow = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), ms);
    });
    return { ...(await Promise.race([run(), slow])), critical };
  } catch (err) {
    return { ok: false, critical, detail: err instanceof Error && err.message === "timeout" ? `no answer within ${ms / 1000} s` : "check failed" };
  } finally {
    clearTimeout(timer);
  }
}

export async function statusReport(env: StatusEnv, deps: { rpc: RpcClient; fetch: typeof fetch; now: () => number; timeoutMs?: number }): Promise<StatusReport> {
  const ms = deps.timeoutMs ?? STATUS_TIMEOUT_MS;

  const signer = guarded(true, ms, async () => {
    const key = env.REINKEEP_SIGNER_KEY;
    if (!key) return { ok: false, detail: "not set" };
    if (!KEY.test(key)) return { ok: false, detail: "set but not a valid key" };
    return { ok: true, detail: `address ${privateKeyToAccount(key as `0x${string}`).address}` };
  });

  const d1 = guarded(true, ms, async () => {
    if (!env.DB) return { ok: false, detail: "not bound" };
    const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return row?.ok === 1 ? { ok: true, detail: "reachable" } : { ok: false, detail: "unexpected answer" };
  });

  const chain = guarded(true, ms, async () => {
    const [res] = await deps.rpc.batch([{ method: "eth_blockNumber", params: [] }]);
    if (!res.ok || typeof res.value !== "string" || !/^0x[0-9a-fA-F]+$/.test(res.value)) return { ok: false, detail: "node answered with an error" };
    return { ok: true, detail: `reachable, block ${Number.parseInt(res.value, 16)}` };
  });

  const payments = guarded(false, ms, async () => {
    const problems: string[] = [];
    if (!ADDRESS.test(env.X402_PAY_TO ?? "")) problems.push("payout address not set");
    if (!env.PRIORS_API_KEY) problems.push("facilitator key not set");
    const base = (env.FACILITATOR_URL || DEFAULT_FACILITATOR).replace(/\/+$/, "");
    let up = false;
    try {
      up = (await deps.fetch(base + "/health", { signal: AbortSignal.timeout(ms) })).ok;
    } catch {
      up = false;
    }
    if (!up) problems.push("facilitator not reachable");
    return problems.length ? { ok: false, detail: problems.join(", ") } : { ok: true, detail: "payout address set, facilitator key set, facilitator reachable" };
  });

  const ai = guarded(false, ms, async () => (env.AI ? { ok: true, detail: "Workers AI bound" } : { ok: false, detail: "not bound (explanations use the rule text)" }));
  const freeTier = guarded(false, ms, async () => (env.FREE ? { ok: true, detail: "bound" } : { ok: false, detail: "not bound (the gate is not metered)" }));

  const names = ["signer", "d1", "chainRpc", "payments", "ai", "freeTier"];
  const results = await Promise.all([signer, d1, chain, payments, ai, freeTier]);
  const checks = Object.fromEntries(names.map((n, i) => [n, results[i]]));
  return { ok: results.every((c) => c.ok || !c.critical), checkedAt: new Date(deps.now()).toISOString(), checks };
}

const LABEL: Record<string, string> = { signer: "Receipt signer", d1: "Database (D1)", chainRpc: "Chain RPC", payments: "Payments (x402)", ai: "Workers AI", freeTier: "Free tier counter" };

export function statusJson(report: StatusReport): Response {
  return json(report.ok ? 200 : 503, report);
}

export function statusHtml(report: StatusReport): Response {
  const rows = Object.entries(report.checks)
    .map(([name, c]) => `<li><strong class="${c.ok ? "ok" : "bad"}">${c.ok ? "OK" : c.critical ? "DOWN" : "NOT SET"}</strong> ${esc(LABEL[name] ?? name)}${c.critical ? "" : ` <span class="muted">(optional)</span>`}<br><span class="muted">${esc(c.detail)}</span></li>`)
    .join("");
  const body = `<h1>Reinkeep AI gate status</h1><p class="verdict ${report.ok ? "ALLOW" : "BLOCK"}">${report.ok ? "OK" : "Down"}</p><p class="muted">Checked ${esc(report.checkedAt)}</p><ul>${rows}</ul><footer><a href="/api/status">As JSON</a></footer>`;
  return page("Status · Reinkeep AI", body, report.ok ? 200 : 503, { "cache-control": "no-store" });
}
