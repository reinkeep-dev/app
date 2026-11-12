// Signed receipts kept in D1 (table `receipts`, see api/migrations/0001_receipts.sql) so one can be shown at /r/{id}
// and fetched at /api/v1/receipts/{id}. Every value goes in through a bound parameter.
// Saving is best effort: the gate answer never waits for it and never fails because of it (see saveReceipt).
import type { D1Like } from "../../collector/src/collector-store.ts";
import type { Receipt } from "./receipt-signing.ts";

export const RECEIPT_ID = /^rk_[0-9a-f]{16}$/;

export interface ReceiptStore {
  put(receipt: Receipt): Promise<void>;
  get(id: string): Promise<unknown | null>; // the stored receipt JSON, untrusted until verifyReceipt has looked at it
}

export class D1ReceiptStore implements ReceiptStore {
  private db: D1Like;
  constructor(db: D1Like) {
    this.db = db;
  }

  // The id is a hash of the signed body, so the same body is the same id: keep the first row, never rewrite it.
  async put(r: Receipt): Promise<void> {
    await this.db
      .prepare("INSERT OR IGNORE INTO receipts (id, decision, json, issued_at) VALUES (?, ?, ?, ?)")
      .bind(r.id, r.decision, JSON.stringify(r), r.issuedAt)
      .run();
  }

  async get(id: string): Promise<unknown | null> {
    if (!RECEIPT_ID.test(id)) return null;
    const row = await this.db.prepare("SELECT json FROM receipts WHERE id = ?").bind(id).first<{ json: string }>();
    if (!row) return null;
    try {
      return JSON.parse(row.json);
    } catch {
      return null;
    }
  }
}

// Starts the save and returns at once. With waitUntil (Workers) the runtime keeps the request alive until the write is
// done; without it (Node, tests) the write simply runs in the background. A failure is logged (kind only) and swallowed.
export function saveReceipt(store: ReceiptStore, receipt: Receipt, waitUntil?: (p: Promise<unknown>) => void): void {
  let pending: Promise<void>;
  try {
    pending = store.put(receipt).catch((err) => console.error("receipt save failed", err instanceof Error ? err.message : "unknown"));
  } catch (err) {
    console.error("receipt save failed", err instanceof Error ? err.message : "unknown");
    return;
  }
  try {
    waitUntil?.(pending);
  } catch {
    // waitUntil itself failing must not matter either
  }
}
