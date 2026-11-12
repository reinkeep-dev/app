// Append-only audit log. Each line carries the hash of the previous line, so editing or
// deleting an old entry breaks the chain and verify() says where.
// ponytail: a hash chain proves the file was not edited, not that it is complete
// (someone can drop the newest lines). Anchor the latest hash somewhere public to close that.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

export type AuditEntry = { seq: number; ts: number; kind: string; data: unknown; prev: string; hash: string };

const GENESIS = "0".repeat(64);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const body = (e: Omit<AuditEntry, "hash">) => JSON.stringify({ seq: e.seq, ts: e.ts, kind: e.kind, data: e.data, prev: e.prev });
const read = (file: string): AuditEntry[] =>
  existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

export function append(file: string, kind: string, data: unknown, ts = Date.now()): AuditEntry {
  const last = read(file).at(-1);
  const base = { seq: last ? last.seq + 1 : 0, ts, kind, data, prev: last ? last.hash : GENESIS };
  const entry: AuditEntry = { ...base, hash: sha(body(base)) };
  appendFileSync(file, JSON.stringify(entry) + "\n");
  return entry;
}

export function verify(file: string): { ok: boolean; badAt?: number } {
  let prev = GENESIS;
  for (const e of read(file)) {
    if (e.prev !== prev || e.hash !== sha(body(e))) return { ok: false, badAt: e.seq };
    prev = e.hash;
  }
  return { ok: true };
}
