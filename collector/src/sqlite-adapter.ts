// Runs the collector's storage on a real SQLite file (or :memory:) using Node's built-in node:sqlite, through the
// same small D1 interface. Used by the local runner and the tests, so the SQL that ships to Cloudflare D1 is the SQL
// that was tested. Node only: do not import this from the Worker.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { D1Like, D1Statement } from "./collector-store.ts";

export type SqliteDb = D1Like & { raw: DatabaseSync; close(): void };

export function openSqlite(file: string): SqliteDb {
  // Foreign keys on, as they are on D1 (plain SQLite leaves them off unless asked).
  const raw = new DatabaseSync(file, { enableForeignKeyConstraints: true });
  raw.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));

  const statement = (sql: string, params: unknown[]): D1Statement => ({
    bind: (...values) => statement(sql, values),
    async run() {
      const r = raw.prepare(sql).run(...(params as any[]));
      // Like D1, report the file size after a write (pages in use plus free pages, times page size).
      const pages = Number((raw.prepare("PRAGMA page_count").get() as { page_count: number }).page_count);
      const pageSize = Number((raw.prepare("PRAGMA page_size").get() as { page_size: number }).page_size);
      return { meta: { changes: Number(r.changes), size_after: pages * pageSize } };
    },
    async first<T>() {
      return (raw.prepare(sql).get(...(params as any[])) as T | undefined) ?? null;
    },
    async all<T>() {
      return { results: raw.prepare(sql).all(...(params as any[])) as T[] };
    },
  });

  return { prepare: (sql) => statement(sql, []), raw, close: () => raw.close() };
}
