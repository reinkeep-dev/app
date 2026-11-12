// Per-payer payment history, which the daily cap, duplicate, rate and new-recipient rules read.
//
// The whole check (read history, decide, record) must run as ONE step per payer. If two identical requests
// arrive together and each reads the history before either records, both see an empty history and both are
// allowed: a duplicate payment gets through. So the store exposes run(), which serialises work per payer.
import type { LedgerEntry } from "../../engine/policy.ts";

export type LedgerView = { entries: LedgerEntry[]; add: (e: LedgerEntry) => void };

export interface GateStore {
  run<T>(payer: string, now: number, fn: (ledger: LedgerView) => T | Promise<T>): Promise<T>;
}

const DAY_MS = 86_400_000;

// Where a ledger is kept. Matches the part of Cloudflare's Durable Object storage we use (values are structured
// clones there, so bigint amounts survive), and a plain Map for tests and the local dev server.
export type LedgerStorage = {
  get(key: string): Promise<LedgerEntry[] | undefined> | LedgerEntry[] | undefined;
  put(key: string, value: LedgerEntry[]): Promise<void> | void;
};

// Serialises run() per payer with a promise chain, then reads, decides and writes back. On Cloudflare each payer has
// its own Durable Object (one instance worldwide), so this chain is the only queue that payer needs.
export class StorageGateStore implements GateStore {
  private tails = new Map<string, Promise<unknown>>();
  private storage: LedgerStorage;
  constructor(storage: LedgerStorage) {
    this.storage = storage;
  }

  run<T>(payer: string, now: number, fn: (ledger: LedgerView) => T | Promise<T>): Promise<T> {
    const key = payer.toLowerCase();
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(async () => {
      // Entries older than a day can no longer affect any rule, so they are dropped.
      const entries = ((await this.storage.get(key)) ?? []).filter((e) => now - e.ts < DAY_MS);
      const view: LedgerView = { entries, add: (e) => void entries.push(e) };
      const value = await fn(view);
      await this.storage.put(key, entries);
      return value;
    });
    // A failed step must not block this payer's next request.
    this.tails.set(key, result.catch(() => undefined));
    return result;
  }
}

// In memory, one process only, forgotten on restart. Tests and `npm run api:dev`.
export class MemoryGateStore extends StorageGateStore {
  constructor() {
    const map = new Map<string, LedgerEntry[]>();
    super({ get: (k) => map.get(k), put: (k, v) => void map.set(k, v) });
  }
}
