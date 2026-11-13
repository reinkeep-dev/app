// Cloudflare Workers entry point for the gate API (wrangler.jsonc next to this folder).
// Secrets (set by the owner, never in code):  REINKEEP_SIGNER_KEY (receipt signing), RPC_URL (chain reads).
// Payer history: a POST /api/v1/gate that names a `payer` is passed to that payer's own Durable Object (PayerLedger,
// one instance worldwide per payer address). It runs the same handler with a store kept in its storage, so the
// daily cap, duplicate, rate and new-recipient rules see one history, and two parallel requests are queued, never
// both judged against an empty history. Everything else (no payer, presets, receipts) is answered right here.
// Metering (metering.ts): POST /api/v1/gate has 25 free calls per IP per day (FreeTier Durable Object), then x402 pay-per-call;
// POST /api/v1/gate/x402 is always paid. Env: X402_PAY_TO, PRIORS_API_KEY (secret), FACILITATOR_URL (optional), FREE.
// After the token launches: HOLDER_TOKEN + HOLDER_MIN (holder price, holder.ts), BURN_TOKEN + BURN_AMOUNT + BURNER_KEY
// (secret; mandates paid in the token at half price and burned, token-burn.ts).
// Remote MCP (mcp.ts): POST /mcp, stateless JSON-RPC; its tools call the metered REST API above.
// Explanation: every gate answer carries `explanation` (explain.ts), written by Workers AI (binding AI) or built from the rules.
// Receipts: every signed gate answer is also saved in D1 (receipt-store.ts, best effort via ctx.waitUntil); GET /r/{id} shows
// one, GET /api/v1/receipts/{id} returns it. GET /api/v1/verdict/{address} is the free token check (60 per IP per day),
// POST /api/v1/gate/batch checks up to 10 tokens, GET /api/status and /status report whether the gate is wired up.
// Token facts: the collector's D1 database (bound as DB) when it knows the token, else the contract is read live.
import { privateKeyToAccount } from "viem/accounts";
import type { D1Like } from "../../collector/src/collector-store.ts";
import { createRpcClient } from "../../collector/src/contract-facts.ts";
import { D1CollectorStore } from "../../collector/src/d1-store.ts";
import { aiExplainer, type AiRunner } from "./explain.ts";
import { aiJudge } from "./judge.ts";
import { holderBalance, holderCheck, holderConfig } from "./holder.ts";
import { burnConfig, createTokenBurn } from "./token-burn.ts";
import { StorageGateStore, type GateStore, type LedgerStorage } from "./gate-store.ts";
import { createHandler, peekPayer, type RunContext } from "./http-handler.ts";
import { D1ReceiptStore } from "./receipt-store.ts";
import { statusHtml, statusJson, statusReport, STATUS_TIMEOUT_MS } from "./status.ts";
import { discovery } from "./discovery.ts";
import { handleMcp } from "./mcp.ts";
import { FreeTier, meter, type MeterEnv } from "./metering.ts";
import { factsFresh, factsLive } from "./token-facts-source.ts";
import { DEFAULT_MAIL_FROM, resendSender } from "./mandate-email.ts";
import { MandateWatcher, watcherFetch, type MandateStorage } from "./mandate-object.ts";
import { handleMandates, isMandateRoute, type MandateNamespace } from "./mandate-routes.ts";

// The parts of the Durable Object API used here (typed locally so the Node tests and tsc need no Cloudflare types).
type PayerStub = { fetch(req: Request): Promise<Response> };
type PayerNamespace = { idFromName(name: string): unknown; get(id: unknown): PayerStub };
type Env = MeterEnv & { REINKEEP_SIGNER_KEY?: string; RPC_URL?: string; DB?: D1Like; PAYER?: PayerNamespace; AI?: AiRunner; MANDATES?: MandateNamespace; RESEND_API_KEY?: string; MAIL_FROM?: string };
// What the Workers runtime hands every request (and every Durable Object): only waitUntil is used.
type Ctx = { waitUntil?: (p: Promise<unknown>) => void };
const runOf = (ctx?: Ctx): RunContext => ({ waitUntil: ctx?.waitUntil ? (p) => ctx.waitUntil!(p) : undefined });

const KEY = /^0x[0-9a-fA-F]{64}$/;
const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";

const notConfigured = () =>
  // Say what is wrong, never echo the value.
  new Response(JSON.stringify({ error: { code: "not_configured", message: "The signer key is not set on this server." } }), {
    status: 503,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Not `fetch` directly: calling a detached fetch in Workers throws "Illegal invocation".
const chainRpc = (env: Env) => createRpcClient({ url: env.RPC_URL ?? PUBLIC_RPC, fetch: (i, init) => fetch(i, init), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });

function buildHandler(env: Env, key: string, store?: GateStore): (req: Request, run?: RunContext) => Promise<Response> {
  const rpc = chainRpc(env);
  const collector = env.DB ? new D1CollectorStore(env.DB) : undefined;
  const tokenFacts = factsLive({ rpc, now: Date.now, store: collector });
  // Short AI note on every answer when the AI binding exists (wrangler.jsonc "ai"); otherwise the rules text (explain.ts).
  const explain = env.AI ? aiExplainer(env.AI) : undefined;
  // AI Judge, only when a caller asks on a REVIEW (judge.ts). Same binding, bigger model.
  const judge = env.AI ? aiJudge(env.AI) : undefined;
  return createHandler({ account: privateKeyToAccount(key as `0x${string}`), now: Date.now, store, tokenFacts, explain, judge, receipts: env.DB ? new D1ReceiptStore(env.DB) : undefined, collector });
}

let cached: { key: string; handle: (req: Request, run?: RunContext) => Promise<Response> } | undefined;

// Payer routing for one gate request: the body is read once here (peekPayer), then it goes to the payer's ledger or is
// answered locally. `handle` is the stateless handler.
async function routeGate(req: Request, env: Env, key: string, run: RunContext): Promise<Response> {
  if (env.PAYER) {
    const peek = await peekPayer(req);
    if (peek.refused) return peek.refused;
    if (peek.payer) return env.PAYER.get(env.PAYER.idFromName(peek.payer)).fetch(peek.req);
    req = peek.req;
  }
  if (cached?.key !== key) cached = { key, handle: buildHandler(env, key) };
  return cached.handle(req, run);
}

// GET /api/status and /status. Answered before the signer key check: it is most useful when something is not set.
async function statusResponse(req: Request, env: Env, fetchImpl: typeof fetch): Promise<Response | null> {
  if (req.method !== "GET") return null;
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  if (path !== "/api/status" && path !== "/status") return null;
  // No retries and a hard timeout: a slow node is reported as down, never waited for.
  const rpc = createRpcClient({
    url: env.RPC_URL ?? PUBLIC_RPC,
    fetch: (i, init) => fetchImpl(i, init),
    sleep: () => Promise.reject(new Error("no retry")),
  });
  const report = await statusReport(env, { rpc, fetch: fetchImpl, now: Date.now, timeoutMs: STATUS_TIMEOUT_MS });
  return path === "/status" ? statusHtml(report) : statusJson(report);
}

// `fetchImpl` is what talks to the payment facilitator; tests hand in a fake.
export function makeWorker(fetchImpl: typeof fetch = (i, init) => fetch(i, init), sleep?: (ms: number) => Promise<void>) {
  return {
    async fetch(req: Request, env: Env, ctx?: Ctx): Promise<Response> {
      // Agent discovery documents (discovery.ts): served even before the signer key is set.
      const found = discovery(req, env);
      if (found) return found;
      const status = await statusResponse(req, env, fetchImpl);
      if (status) return status;
      const key = env.REINKEEP_SIGNER_KEY;
      if (!key || !KEY.test(key)) return notConfigured();
      const run = runOf(ctx);
      // The REST API with metering; the remote MCP server's tools call it too, so MCP calls use the same free tier.
      // Mandates (mandate-routes.ts) go to their own watcher; everything else to the gate.
      const route = (x: Request): Promise<Response> =>
        isMandateRoute(new URL(x.url).pathname.replace(/\/+$/, ""))
          ? handleMandates(x, { ns: env.MANDATES, signer: privateKeyToAccount(key as `0x${string}`).address, now: Date.now })
          : routeGate(x, env, key, run);
      const rpc = chainRpc(env);
      const holderCfg = holderConfig(env);
      const isHolder = holderCfg ? holderCheck(rpc, holderCfg) : undefined;
      const balanceOf = holderCfg ? holderBalance(rpc, holderCfg) : undefined;
      // Pay-in-token for mandates (token-burn.ts). The burner must be its own wallet: never the receipt signer.
      const burnCfg = burnConfig(env);
      const sameAsSigner = burnCfg !== null && burnCfg.account.address === privateKeyToAccount(key as `0x${string}`).address;
      if (sameAsSigner) console.error("BURNER_KEY is the receipt signer key: token payments stay off until it is a separate wallet");
      const burn = burnCfg && !sameAsSigner ? createTokenBurn(rpc, burnCfg, { sleep }) : undefined;
      const api = async (r: Request): Promise<Response> => (await meter(r, env, { route, fetch: fetchImpl, sleep, isHolder, holderBalance: balanceOf, burn })) ?? route(r);
      if (new URL(req.url).pathname.replace(/\/+$/, "") === "/mcp") return handleMcp(req, api);
      return api(req);
    },
  };
}

export default makeWorker();

// Free-call counter, one per caller IP (see metering.ts).
export { FreeTier };

// One per mandate id: watches one token for 7 days, waking itself with an alarm every 30 minutes (mandate-object.ts).
export class MandateWatch {
  private watcher?: { key: string; w: MandateWatcher };
  private storage: MandateStorage;
  private env: Env;

  constructor(ctx: { storage: MandateStorage }, env: Env) {
    this.storage = ctx.storage;
    this.env = env;
  }

  private get(): MandateWatcher | null {
    const key = this.env.REINKEEP_SIGNER_KEY;
    if (!key || !KEY.test(key)) return null;
    if (this.watcher?.key !== key) {
      const readFresh = factsFresh({ rpc: chainRpc(this.env), now: Date.now, store: this.env.DB ? new D1CollectorStore(this.env.DB) : undefined });
      const sendEmail = this.env.RESEND_API_KEY ? resendSender(this.env.RESEND_API_KEY, this.env.MAIL_FROM ?? DEFAULT_MAIL_FROM, (i, init) => fetch(i, init)) : undefined;
      const w = new MandateWatcher({ storage: this.storage, now: Date.now, account: privateKeyToAccount(key as `0x${string}`), readFresh, fetch: (i, init) => fetch(i, init), sendEmail });
      this.watcher = { key, w };
    }
    return this.watcher.w;
  }

  async fetch(req: Request): Promise<Response> {
    const w = this.get();
    return w ? watcherFetch(w, req) : notConfigured();
  }

  async alarm(): Promise<void> {
    // Without the key no signal can be signed; the alarm is dropped and the mandate's events show no checks.
    await this.get()?.alarm();
  }
}

// One per payer address. Its storage holds that payer's last day of ALLOWed payments under the payer's key.
// Cloudflare runs at most one instance of it at a time, and StorageGateStore queues the requests inside it.
export class PayerLedger {
  private handle?: { key: string; fn: (req: Request, run?: RunContext) => Promise<Response> };
  private store: StorageGateStore;
  private env: Env;

  private run: RunContext;

  constructor(ctx: { storage: LedgerStorage } & Ctx, env: Env) {
    this.env = env;
    this.run = runOf(ctx);
    this.store = new StorageGateStore(ctx.storage);
  }

  async fetch(req: Request): Promise<Response> {
    const key = this.env.REINKEEP_SIGNER_KEY;
    if (!key || !KEY.test(key)) return notConfigured();
    if (this.handle?.key !== key) this.handle = { key, fn: buildHandler(this.env, key, this.store) };
    return this.handle.fn(req, this.run);
  }
}
