// Cloudflare D1 over its REST API, behind the same small interface the Worker binding has (D1Like).
// Used by the GitHub Actions runner (ci/run-ci.ts): outside Cloudflare there is no `env.DB`, so each statement is one
// HTTPS call to  POST /accounts/{account}/d1/database/{database}/query  with { sql, params }.
// The SQL that runs is the SQL d1-store.ts already ships and tests; only the transport differs.
import type { D1Like, D1Statement } from "./collector-store.ts";

export type D1RestConfig = {
  accountId: string;
  databaseId: string;
  apiToken: string;
  fetch?: typeof fetch;
};

type Reply = {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: { success?: boolean; results?: unknown[]; meta?: { changes?: number; size_after?: number } }[];
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export class D1RestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function createD1Rest(cfg: D1RestConfig): D1Like {
  if (!/^[0-9a-f]{32}$/i.test(cfg.accountId)) throw new Error("D1 REST: accountId must be 32 hex characters");
  if (!/^[0-9a-f-]{36}$/i.test(cfg.databaseId)) throw new Error("D1 REST: databaseId must be a UUID");
  if (cfg.apiToken.length < 20) throw new Error("D1 REST: apiToken is missing or too short");
  const doFetch = cfg.fetch ?? ((input, init) => fetch(input, init));
  const url = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/d1/database/${cfg.databaseId}/query`;

  async function query(sql: string, params: unknown[]) {
    // Only ever ONE attempt per statement: a retry after a lost answer could write twice (a plain INSERT, a counter).
    const res = await doFetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new D1RestError(`D1 REST: HTTP ${res.status}, answer was not JSON`, res.status);
    }
    const reply = (isObj(body) ? body : {}) as Reply;
    if (!res.ok || reply.success !== true) {
      const why = reply.errors?.map((e) => e.message).filter(Boolean).join("; ") || "no reason given";
      throw new D1RestError(`D1 REST: HTTP ${res.status}: ${why.slice(0, 300)}`, res.status);
    }
    const first = reply.result?.[0];
    if (!first || first.success === false) throw new D1RestError("D1 REST: answer had no result for the statement", res.status);
    return { results: (first.results ?? []) as Record<string, unknown>[], meta: first.meta ?? {} };
  }

  const statement = (sql: string, params: unknown[]): D1Statement => ({
    bind: (...values) => statement(sql, values),
    async run() {
      const r = await query(sql, params);
      return { meta: { changes: Number(r.meta.changes ?? 0), size_after: r.meta.size_after } };
    },
    async first<T>() {
      const r = await query(sql, params);
      return (r.results[0] as T | undefined) ?? null;
    },
    async all<T>() {
      const r = await query(sql, params);
      return { results: r.results as T[] };
    },
  });

  return { prepare: (sql) => statement(sql, []) };
}
