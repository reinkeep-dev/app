// The HTTP layer: routing, size limits, JSON in and out. No business logic here; that is gate-service.ts.
// It speaks only the standard Request/Response, so the same handler runs in Cloudflare Workers and in Node.
import { ApiError } from "./api-error.ts";
import { gate, gateBatch, type GateDeps } from "./gate-service.ts";
import { PRESETS, parseBatchBody, parseGateBody } from "./request-validation.ts";
import { RECEIPT_DOMAIN, RECEIPT_TYPES, verifyReceipt } from "./receipt-signing.ts";
import { RECEIPT_ID } from "./receipt-store.ts";
import { missingPage, sharePage } from "./share-page.ts";
import { verdict } from "./verdict.ts";
import { parseDraft, premortem } from "./premortem.ts";
import { autopsy, board, odds, radar } from "./launch-data.ts";

export const MAX_BODY_BYTES = 16 * 1024;

export const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "payment-required, payment-response, x-free-calls-left",
};

export const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: HEADERS });
export const fail = (status: number, code: string, message: string): Response => json(status, { error: { code, message } });

// Reads at most `max` bytes. A client that streams more is cut off instead of filling memory.
export async function readLimited(req: Request, max: number): Promise<string> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new ApiError(413, "body_too_large", `Body is larger than ${max} bytes.`);
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new ApiError(413, "body_too_large", `Body is larger than ${max} bytes.`);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

async function readJson(req: Request): Promise<unknown> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Send the body as application/json.");
  }
  const text = await readLimited(req, MAX_BODY_BYTES);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Body is not valid JSON.");
  }
}

// For the Cloudflare Worker: which payer a POST /api/v1/gate is for, so it can go to that payer's Durable Object.
// Reads the body once (same size limit) and hands back an identical request to pass on. Anything it cannot read
// cleanly gets payer null, and the normal handler then gives the proper error for it; a body over the limit is
// answered here (`refused`), since it cannot be passed on.
export async function peekPayer(req: Request): Promise<{ payer: string | null; req: Request; refused?: Response }> {
  const { pathname } = new URL(req.url);
  if (req.method !== "POST" || pathname.replace(/\/+$/, "") !== "/api/v1/gate") return { payer: null, req };
  let text: string;
  try {
    text = await readLimited(req, MAX_BODY_BYTES);
  } catch (err) {
    if (err instanceof ApiError) return { payer: null, req, refused: fail(err.status, err.code, err.message) };
    throw err;
  }
  const again = new Request(req.url, { method: "POST", headers: req.headers, body: text });
  let payer: unknown;
  try {
    payer = (JSON.parse(text) as { payer?: unknown } | null)?.payer;
  } catch {
    return { payer: null, req: again };
  }
  return { payer: typeof payer === "string" && /^0x[0-9a-fA-F]{40}$/.test(payer) ? payer.toLowerCase() : null, req: again };
}

// `run` is per request: the Workers execution context's waitUntil, so a receipt save can finish after the answer is sent.
export type RunContext = { waitUntil?: (p: Promise<unknown>) => void };

// The stored receipt with its signature checked again now, or null when no such receipt is stored.
async function storedReceipt(id: string, deps: GateDeps) {
  if (!deps.receipts) throw new ApiError(503, "receipts_unavailable", "Receipts are not stored on this server.");
  if (!RECEIPT_ID.test(id)) return null;
  const receipt = await deps.receipts.get(id);
  if (receipt === null) return null;
  return { receipt, check: await verifyReceipt(receipt, deps.account.address) };
}

// The launch-data tools need the collector's database; without it they say so instead of answering empty.
function needData(deps: GateDeps) {
  if (!deps.collector) throw new ApiError(503, "data_unavailable", "Launch data is not connected on this server.");
  return deps.collector;
}

// ?name=<whole number>, or the fallback when absent. Range checks are the tool's own.
function wholeParam(req: Request, name: string, fallback: number): number {
  const raw = new URL(req.url).searchParams.get(name);
  if (raw === null) return fallback;
  if (!/^\d{1,6}$/.test(raw)) throw new ApiError(400, `invalid_${name}`, `${name} must be a whole number.`);
  return Number(raw);
}

export function createHandler(base: GateDeps): (req: Request, run?: RunContext) => Promise<Response> {
  return async (req, run) => {
    const deps: GateDeps = run?.waitUntil ? { ...base, waitUntil: run.waitUntil } : base;
    try {
      const { pathname } = new URL(req.url);
      const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: { ...HEADERS, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, payment-signature", "access-control-max-age": "86400" },
        });
      }

      const route = (method: string) => {
        if (req.method !== method) throw new ApiError(405, "method_not_allowed", `Use ${method} for ${path}.`);
      };

      switch (path) {
        case "/api/v1/gate": {
          route("POST");
          const input = parseGateBody(await readJson(req));
          return json(200, await gate(input, deps));
        }
        case "/api/v1/gate/batch": {
          route("POST");
          return json(200, await gateBatch(parseBatchBody(await readJson(req)), deps));
        }
        case "/api/v1/premortem": {
          route("POST");
          return json(200, await premortem(parseDraft(await readJson(req)), { collector: deps.collector }));
        }
        case "/api/v1/odds":
          route("GET");
          return json(200, await odds(needData(deps)));
        case "/api/v1/board":
          route("GET");
          return json(200, await board(needData(deps), wholeParam(req, "days", 7), deps.now()));
        case "/api/v1/radar":
          route("GET");
          return json(200, await radar(needData(deps), wholeParam(req, "hours", 24), deps.now()));
        case "/api/v1/gate/presets":
          route("GET");
          return json(200, { presets: PRESETS });
        case "/api/v1/receipts/signer":
          route("GET");
          return json(200, { signer: deps.account.address, domain: RECEIPT_DOMAIN, types: RECEIPT_TYPES, primaryType: "Receipt" });
        case "/api/v1/receipts/verify": {
          route("POST");
          const body = await readJson(req);
          if (typeof body !== "object" || body === null || Array.isArray(body) || !("receipt" in body)) {
            throw new ApiError(400, "missing_receipt", "Body needs a receipt object.");
          }
          return json(200, await verifyReceipt((body as { receipt: unknown }).receipt, deps.account.address));
        }
        default: {
          const addressOf = path.startsWith("/api/v1/verdict/") ? path.slice("/api/v1/verdict/".length) : null;
          if (addressOf !== null && !addressOf.includes("/")) {
            route("GET");
            return json(200, await verdict(addressOf, deps));
          }
          const autopsyOf = path.startsWith("/api/v1/autopsy/") ? path.slice("/api/v1/autopsy/".length) : null;
          if (autopsyOf !== null && !autopsyOf.includes("/")) {
            route("GET");
            return json(200, await autopsy(needData(deps), autopsyOf, deps.now()));
          }
          const receiptId = path.startsWith("/api/v1/receipts/") ? path.slice("/api/v1/receipts/".length) : null;
          if (receiptId !== null && !receiptId.includes("/")) {
            route("GET");
            const found = await storedReceipt(receiptId, deps);
            if (!found) return fail(404, "receipt_not_found", "No receipt with this id is stored here.");
            // valid + signer from verifyReceipt; signer is always this server's address, the one the receipt is checked against.
            return json(200, { receipt: found.receipt, valid: found.check.valid, signer: deps.account.address, ...(found.check.valid ? {} : { reason: found.check.reason }) });
          }
          const shareId = path.startsWith("/r/") ? path.slice(3) : null;
          if (shareId !== null && !shareId.includes("/")) {
            route("GET");
            const found = deps.receipts && RECEIPT_ID.test(shareId) ? await storedReceipt(shareId, deps) : null;
            return found ? sharePage(shareId, found.receipt, found.check) : missingPage();
          }
          return fail(404, "not_found", `No such endpoint: ${path}.`);
        }
      }
    } catch (err) {
      if (err instanceof ApiError) return fail(err.status, err.code, err.message);
      // Anything else is our fault. Log it for us, tell the caller nothing about it.
      console.error("gate api error", err);
      return fail(500, "internal", "Something went wrong on our side.");
    }
  };
}
