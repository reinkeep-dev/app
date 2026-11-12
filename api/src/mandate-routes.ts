// Public HTTP routes for mandates. Each mandate lives in its own watcher (MandateWatch Durable Object, keyed by id);
// these routes check the input, then pass the call on. The mandate id is long and random: knowing it is what lets
// you read or change that mandate, so treat it like a password.
//
//   POST   /api/v1/mandates                 {token, webhookUrl?}  -> 201-style body, 200 status; costs 5 gate calls
//   GET    /api/v1/mandates/{id}            state, expiry, latest signed signal
//   GET    /api/v1/mandates/{id}/events     ?after=<seq>&limit=<1..100>
//   POST   /api/v1/mandates/{id}/renew      +7 days; costs 5 gate calls
//   POST   /api/v1/mandates/{id}/test       send the last signal to the webhook as a "test" event
//   DELETE /api/v1/mandates/{id}            stop watching
//   POST   /api/v1/signals/verify           {signal} -> { valid, expired } or { valid:false, reason }
import type { Address } from "viem";
import { ApiError } from "./api-error.ts";
import { HEADERS, fail, json, readLimited, MAX_BODY_BYTES } from "./http-handler.ts";
import { MANDATE_ID, newMandateId, parseMandateBody, verifySignal } from "./mandate-service.ts";

type Stub = { fetch(req: Request): Promise<Response> };
export type MandateNamespace = { idFromName(name: string): unknown; get(id: unknown): Stub };

export const MANDATES_PATH = "/api/v1/mandates";
export const SIGNAL_VERIFY_PATH = "/api/v1/signals/verify";

// Which requests cost gate calls (metering.ts asks this).
export function isMandatePurchase(method: string, path: string): boolean {
  if (method !== "POST") return false;
  if (path === MANDATES_PATH) return true;
  const m = path.match(/^\/api\/v1\/mandates\/([^/]+)\/renew$/);
  return m !== null && MANDATE_ID.test(m[1]);
}

export const isMandateRoute = (path: string) => path === MANDATES_PATH || path.startsWith(MANDATES_PATH + "/") || path === SIGNAL_VERIFY_PATH;

async function readBody(req: Request): Promise<unknown> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) throw new ApiError(415, "unsupported_media_type", "Send the body as application/json.");
  const text = await readLimited(req, MAX_BODY_BYTES);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Body is not valid JSON.");
  }
}

// Passes the watcher's answer on with our standard headers; a 201 from the watcher becomes 200 so metering (which
// charges only on success) and clients see one success code.
async function relay(res: Response): Promise<Response> {
  const body = await res.json().catch(() => ({ error: { code: "internal", message: "Something went wrong on our side." } }));
  return json(res.status === 201 ? 200 : res.status, body);
}

export async function handleMandates(req: Request, deps: { ns?: MandateNamespace; signer: Address; now: () => number }): Promise<Response> {
  try {
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...HEADERS, "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-allow-headers": "content-type, payment-signature", "access-control-max-age": "86400" },
      });
    }
    if (path === SIGNAL_VERIFY_PATH) {
      if (req.method !== "POST") throw new ApiError(405, "method_not_allowed", "Use POST.");
      const body = await readBody(req);
      if (typeof body !== "object" || body === null || !("signal" in body)) throw new ApiError(400, "missing_signal", "Body needs a signal object.");
      return json(200, await verifySignal((body as { signal: unknown }).signal, deps.signer, Math.floor(deps.now() / 1000)));
    }
    if (!deps.ns) throw new ApiError(503, "mandates_unavailable", "Mandates are not set up on this server.");
    const ns = deps.ns;
    const to = (id: string, method: string, route: string, body?: unknown) =>
      ns.get(ns.idFromName(id)).fetch(new Request("https://mandate" + route, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

    if (path === MANDATES_PATH) {
      if (req.method !== "POST") throw new ApiError(405, "method_not_allowed", "Use POST to create a mandate.");
      const input = parseMandateBody(await readBody(req));
      const id = newMandateId();
      return relay(await to(id, "POST", "/create", { id, input }));
    }

    const rest = path.slice(MANDATES_PATH.length + 1).split("/");
    const id = rest[0];
    if (!MANDATE_ID.test(id) || rest.length > 2) throw new ApiError(404, "mandate_not_found", "No mandate with this id.");
    const action = rest[1] ?? "";
    const key = `${req.method} ${action}`;
    switch (key) {
      case "GET ":
        return relay(await to(id, "GET", "/get"));
      case "DELETE ":
        return relay(await to(id, "POST", "/cancel"));
      case "GET events": {
        const q = new URL(req.url).searchParams;
        const after = q.get("after") ?? "0";
        const limit = q.get("limit") ?? "50";
        if (!/^\d{1,9}$/.test(after) || !/^\d{1,3}$/.test(limit)) throw new ApiError(400, "invalid_query", "after and limit must be whole numbers.");
        return relay(await to(id, "GET", `/events?after=${after}&limit=${limit}`));
      }
      case "POST renew":
        return relay(await to(id, "POST", "/renew"));
      case "POST test":
        return relay(await to(id, "POST", "/test"));
      default: {
        const known = action === "" || action === "events" || action === "renew" || action === "test";
        if (known) throw new ApiError(405, "method_not_allowed", `${req.method} is not allowed on ${path}.`);
        throw new ApiError(404, "not_found", `No such endpoint: ${path}.`);
      }
    }
  } catch (e) {
    if (e instanceof ApiError) return fail(e.status, e.code, e.message);
    console.error("mandate route error", e);
    return fail(500, "internal", "Something went wrong on our side.");
  }
}
