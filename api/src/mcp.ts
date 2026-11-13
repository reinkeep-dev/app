// Remote MCP server for the gate API: "Streamable HTTP" transport at /mcp, stateless.
// Every POST gets one application/json JSON-RPC answer (no sessions, no SSE). GET and DELETE are 405.
// Spec checked: modelcontextprotocol.io/specification/2025-11-25/basic/transports (latest) and the 2025-06-18 changelog.
// Batching was removed in 2025-06-18 but older clients (2025-03-26, 2024-11-05) still send it, so arrays are answered.
// Tools call the REST API through `callApi` (same origin) and pass cf-connecting-ip on, so the free tier counts the
// real caller. Nothing here decides anything: the decision always comes from /api/v1/gate.

export const MAX_MCP_BODY_BYTES = 64 * 1024;
export const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_VERSION = "0.1.0";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id, accept",
  "access-control-expose-headers": "mcp-session-id",
  "access-control-max-age": "86400",
};
const JSON_HEADERS = { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

type Id = string | number | null;
type Msg = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  pattern?: string;
  description?: string;
};
type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: unknown; isError?: boolean };

const str: Schema = { type: "string" };
const num: Schema = { type: "number" };

const REQUEST_SCHEMA: Schema = {
  type: "object",
  description: "The payment you are about to make, as the 402 quote described it.",
  properties: {
    network: { type: "string", description: "CAIP-2 network, e.g. eip155:4663" },
    asset: { type: "string", description: "Token contract address you will pay with" },
    amount: { type: "string", description: "Amount in base units, integer string (6 decimals: 10000 = $0.01)" },
    decimals: num,
    payTo: { type: "string", description: "Recipient address" },
    resourceUrl: { type: "string", description: "https URL of the thing you are paying for" },
    validForSeconds: num,
    quotedAmount: { type: "string", description: "Amount from the first 402 quote, if different calls were made" },
  },
  required: ["network", "asset", "amount", "decimals", "payTo", "resourceUrl", "validForSeconds"],
  additionalProperties: false,
};

const TOOLS: { name: string; description: string; inputSchema: Schema }[] = [
  {
    name: "gate_check",
    description:
      "Ask before you pay: returns ALLOW, REVIEW or BLOCK for a payment (and optionally the token it buys) with the rule codes that decided it and a signed receipt. Call it before every payment and pay only the exact amount to the exact recipient you checked. 25 calls per day are free, then $0.01 in USDG via x402 (pass payment_signature).",
    inputSchema: {
      type: "object",
      properties: {
        request: REQUEST_SCHEMA,
        policy: { type: ["string", "object"], description: "Preset name (see list_presets) or a policy object. Omit for the default." },
        payer: { type: "string", description: "Your wallet address. Turns on your history: daily cap, duplicates, rate limit, new recipient. Needs payerSignature and issuedAt." },
        payerSignature: { type: "string", description: "personal_sign by payer of the 8-line message in llms.txt (Payer proof). Required with payer." },
        issuedAt: { type: "integer", description: "Unix seconds when payerSignature was made; within 5 minutes of now. Required with payer." },
        token: { type: "string", description: "Address of the token this payment buys. Turns on the token rules (mint, blacklist, liquidity)." },
        judge: { type: "boolean", description: "On a REVIEW, add the AI Judge's second opinion (lean, confidence, cites). Advisory: the decision stays REVIEW." },
        payment_signature: { type: "string", pattern: "^[A-Za-z0-9+/=_-]+$", description: "Base64 x402 payment payload. Only needed after the free calls are used up." },
      },
      required: ["request"],
      additionalProperties: false,
    },
  },
  {
    name: "verify_receipt",
    description: "Re-check a receipt returned by gate_check: valid true plus the signer, or valid false plus the reason. Does not need payment.",
    inputSchema: { type: "object", properties: { receipt: { type: "object", description: "The receipt object exactly as gate_check returned it" } }, required: ["receipt"], additionalProperties: false },
  },
  {
    name: "get_pricing",
    description: "Free calls per day, price per call, and the asset, network and payTo address for paying after that.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_presets",
    description: "The built-in policies you can pass as the policy of gate_check.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_signer",
    description: "The receipt signer address with the EIP-712 domain and types, everything needed to check a receipt yourself.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "check_token",
    description:
      "Free check of one token before buying it: ALLOW, REVIEW or BLOCK from the token rules only (mint with a live owner, blacklist, pause, upgradeable, ticker copy, low liquidity), with the reasons, the facts read and a short plain-English note. No payment and no receipt. Limited to 60 per day per caller.",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "Address of the token contract" } },
      required: ["address"],
      additionalProperties: false,
    },
  },
  {
    name: "get_receipt",
    description: "Fetch a stored gate receipt by id (the id gate_check returned, like rk_0123456789abcdef) with a fresh signature check: { receipt, valid, signer }. Free.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", pattern: "^rk_[0-9a-f]{16}$", description: "Receipt id from gate_check" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_mandate",
    description:
      "After you buy a token, ask Reinkeep to keep watching it for 7 days: the contract is re-read every 30 minutes and each check gives a signed signal, exit (sell or stop), watch (look closer) or hold. Optional webhookUrl gets HMAC-signed pushes; optional email gets one email each time the signal changes away from hold (or back). Costs 5 calls (free calls first, then $0.05 via x402: pass payment_signature). Keep the returned mandate id; it is the only key.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "Token you hold" },
        webhookUrl: { type: "string", description: "Optional https URL on a public host for pushed events" },
        email: { type: "string", description: "Optional address for an email when the signal turns exit or watch, and when it returns to hold" },
        payment_signature: { type: "string", pattern: "^[A-Za-z0-9+/=_-]+$", description: "Base64 x402 payment payload, only after the free calls are used up" },
      },
      required: ["token"],
      additionalProperties: false,
    },
  },
  {
    name: "get_mandate",
    description: "A mandate's state (active, expired, cancelled), expiry, checks so far and the latest signed signal. Free.",
    inputSchema: { type: "object", properties: { id: { type: "string", pattern: "^md_[0-9a-f]{32}$", description: "Mandate id" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "mandate_events",
    description: "Every check, change and failed read of a mandate, oldest first. Pass after (a seq) to get only newer events. Free.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", pattern: "^md_[0-9a-f]{32}$", description: "Mandate id" }, after: { type: "number", description: "Only events with seq above this" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "premortem",
    description:
      "For builders, before a launch: send the draft (ticker, contract powers, taxes, team share, liquidity and lock days) and get the decision the Reinkeep gate will give agents buying it, the risks with fixes (high first, each labelled gate rule or rule of thumb), whether the ticker is taken, and how launches with similar liquidity did after a day. Free, nothing stored.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        ticker: { type: "string" },
        contract: {
          type: "object",
          properties: { mint: { type: "boolean" }, ownerRenounced: { type: "boolean" }, pause: { type: "boolean" }, blacklist: { type: "boolean" }, upgradeable: { type: "boolean" } },
          required: ["mint", "ownerRenounced", "pause", "blacklist", "upgradeable"],
          additionalProperties: false,
        },
        buyTaxPct: { type: "number" },
        sellTaxPct: { type: "number" },
        teamAllocationPct: { type: "number" },
        liquidityUsd: { type: "number" },
        liquidityLockDays: { type: "number" },
      },
      required: ["ticker", "contract", "buyTaxPct", "sellTaxPct", "teamAllocationPct", "liquidityUsd", "liquidityLockDays"],
      additionalProperties: false,
    },
  },
  {
    name: "verify_signal",
    description: "Check that a mandate signal (exit/watch/hold) was signed by Reinkeep and whether it is still within its one-hour validity. Free.",
    inputSchema: { type: "object", properties: { signal: { type: "object", description: "The signal object exactly as received" } }, required: ["signal"], additionalProperties: false },
  },
  {
    name: "launch_odds",
    description: "Out of the launches our collector saw, how many still traded a day later, grouped by liquidity and by swaps when first seen. A share only from 30 judged pools. A record of past tokens, not a prediction. Free.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "launch_board",
    description: "Per UTC day: pools seen, re-checked after a day, alive, dead and the share still trading. Free.",
    inputSchema: { type: "object", properties: { days: { type: "number", description: "Whole number of days, 1 to 30 (default 7)" } }, additionalProperties: false },
  },
  {
    name: "ticker_radar",
    description: "Tickers reused by 2 or more tokens lately (often a wave of copies), with the earliest and the busiest token for each. Free.",
    inputSchema: { type: "object", properties: { hours: { type: "number", description: "Whole number of hours, 1 to 168 (default 24)" } }, additionalProperties: false },
  },
  {
    name: "token_autopsy",
    description: "What happened to one token a day after launch: still trading, liquidity pulled, faded or never lived, with the numbers when first seen and a day later. Free.",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "Address of the token contract" } },
      required: ["address"],
      additionalProperties: false,
    },
  },
];

const pct = (v: unknown) => (typeof v === "number" ? `${v}%` : "not enough data");

function signalText(s: any): string {
  const what = s?.action === "exit" ? "EXIT: a rule blocks this token or its contract changed in a way that matters. Consider selling or stopping."
    : s?.action === "watch" ? "WATCH: something needs a closer look (a review rule, a minor change, or the chain could not be read)."
    : s?.action === "hold" ? "HOLD: nothing changed and no rule objects."
    : "No signal yet.";
  return `${what} Decision ${s?.decision ?? "?"}${Array.isArray(s?.reasons) && s.reasons.length ? ` (${s.reasons.join(", ")})` : ""}.`;
}

const ok = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result });
const err = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

// Minimal JSON Schema check for the shapes above. Returns a message for the first problem, else null.
function typeOf(v: unknown): string {
  return v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
}
function check(schema: Schema, v: unknown, path: string): string | null {
  if (schema.type) {
    const want = Array.isArray(schema.type) ? schema.type : [schema.type];
    const got = typeOf(v);
    if (!want.includes(got)) return `${path} must be ${want.join(" or ")}`;
  }
  if (typeof v === "string" && schema.pattern && !new RegExp(schema.pattern).test(v)) return `${path} has an invalid format`;
  if (schema.properties && typeof v === "object" && v !== null && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const k of schema.required ?? []) if (o[k] === undefined) return `${path}.${k} is required`;
    for (const [k, val] of Object.entries(o)) {
      const sub = schema.properties[k];
      if (!sub) {
        if (schema.additionalProperties === false) return `${path}.${k} is not allowed`;
        continue;
      }
      const bad = check(sub, val, `${path}.${k}`);
      if (bad) return bad;
    }
  }
  return null;
}

async function readLimited(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
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
      return null;
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

const toolText = (text: string, structuredContent?: unknown, isError = false): ToolResult => ({
  content: [{ type: "text", text }],
  ...(structuredContent !== undefined ? { structuredContent } : {}),
  ...(isError ? { isError: true } : {}),
});

// What the REST API answered, parsed once. `data` is undefined when the body was not JSON.
async function readReply(res: Response): Promise<{ status: number; data: any; text: string }> {
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text), text };
  } catch {
    return { status: res.status, data: undefined, text };
  }
}

function apiError(r: { status: number; data: any }): ToolResult {
  const e = r.data?.error;
  const code = typeof e?.code === "string" ? e.code : `http_${r.status}`;
  const message = typeof e?.message === "string" ? e.message : "The API refused the call.";
  return toolText(`Error ${r.status} ${code}: ${message}`, r.data ?? { error: { code, message } }, true);
}

function payInstructions(body: any): string {
  const a = Array.isArray(body?.accepts) ? body.accepts[0] : undefined;
  const why = typeof body?.error === "string" ? body.error : "Payment required.";
  if (!a) return `${why} Payment is required but the terms were not readable.`;
  return (
    `${why} To continue, pay ${a.amount} base units of asset ${a.asset} to ${a.payTo} on ${a.network} (x402 v2, scheme ${a.scheme}). ` +
    `Sign the payment with the terms in structuredContent.accepts[0], then call gate_check again with the same arguments plus payment_signature (the base64 payment payload). ` +
    `You are charged only when the gate answers.`
  );
}

function gateText(d: any): string {
  const reasons = Array.isArray(d?.reasons) ? d.reasons : [];
  const lines = reasons.map((r: any) => `- ${r.code}${r.plain ? `: ${r.plain}` : ""}`);
  const next =
    d?.decision === "ALLOW" ? "Allowed. Pay only this exact amount to this exact recipient."
    : d?.decision === "REVIEW" ? "Do not pay yet. A human should review the reasons above."
    : "Blocked. Do not pay.";
  const j = d?.judgement;
  const judge = j?.ran
    ? [`AI Judge (advisory, decision unchanged): leans ${j.lean} at ${Math.round(j.confidence * 100)}% confidence, citing ${j.cites.join(", ")}.${j.note ? ` ${j.note}` : ""}`]
    : j ? [`AI Judge did not run (${j.why}).`] : [];
  return [`${d?.decision ?? "UNKNOWN"} (receipt ${d?.id ?? "?"})`, ...(lines.length ? lines : ["- no rule fired"]), ...judge, next].join("\n");
}

function verdictText(d: any): string {
  const reasons = Array.isArray(d?.reasons) ? d.reasons : [];
  const lines = reasons.map((r: any) => `- ${r.code}${r.plain ? `: ${r.plain}` : ""}`);
  const next =
    d?.decision === "ALLOW" ? "No token rule objected. That is not a promise that the token is safe."
    : d?.decision === "REVIEW" ? "A human should look at this token before anyone buys it."
    : "Do not buy this token.";
  return [`${d?.decision ?? "UNKNOWN"} (token ${d?.token ?? "?"})`, ...(lines.length ? lines : ["- no rule fired"]), next].join("\n");
}

async function callTool(name: string, args: Record<string, any>, req: Request, callApi: (r: Request) => Promise<Response>): Promise<ToolResult> {
  const origin = new URL(req.url).origin;
  const ip = req.headers.get("cf-connecting-ip");
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { ...extra };
    if (ip) headers["cf-connecting-ip"] = ip;
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    try {
      return await readReply(await callApi(new Request(origin + path, init)));
    } catch (e) {
      console.error("mcp upstream call failed", e);
      return { status: 502, data: undefined, text: "" };
    }
  };

  switch (name) {
    case "gate_check": {
      const body: Record<string, unknown> = { request: args.request };
      for (const k of ["policy", "payer", "payerSignature", "issuedAt", "token", "judge"]) if (args[k] !== undefined) body[k] = args[k];
      const sig = typeof args.payment_signature === "string" ? args.payment_signature : undefined;
      const r = await call("POST", "/api/v1/gate", body, sig ? { "payment-signature": sig } : {});
      if (r.status === 200 && r.data) return toolText(gateText(r.data), r.data);
      if (r.status === 402) return toolText(payInstructions(r.data), r.data, true);
      return apiError(r);
    }
    case "verify_receipt": {
      const r = await call("POST", "/api/v1/receipts/verify", { receipt: args.receipt });
      if (r.status !== 200 || !r.data) return apiError(r);
      return toolText(r.data.valid ? `Valid. Signed by ${r.data.signer}.` : `Not valid: ${r.data.reason ?? "unknown reason"}.`, r.data);
    }
    case "check_token": {
      const r = await call("GET", `/api/v1/verdict/${args.address}`);
      if (r.status !== 200 || !r.data) return apiError(r);
      return toolText(verdictText(r.data), r.data);
    }
    case "get_receipt": {
      const r = await call("GET", `/api/v1/receipts/${args.id}`);
      if (r.status !== 200 || !r.data) return apiError(r);
      const note = r.data.valid ? `Valid signature, signed by ${r.data.signer}.` : `Signature not valid: ${r.data.reason ?? "unknown reason"}.`;
      return toolText(`Receipt ${r.data.receipt?.id ?? args.id}: ${r.data.receipt?.decision ?? "UNKNOWN"}. ${note}`, r.data);
    }
    case "create_mandate": {
      const body: Record<string, unknown> = { token: args.token };
      if (args.webhookUrl !== undefined) body.webhookUrl = args.webhookUrl;
      if (args.email !== undefined) body.email = args.email;
      const sig = typeof args.payment_signature === "string" ? args.payment_signature : undefined;
      const r = await call("POST", "/api/v1/mandates", body, sig ? { "payment-signature": sig } : {});
      if (r.status === 200 && r.data) {
        const secret = r.data.webhookSecret ? ` Webhook secret (shown only now, store it): ${r.data.webhookSecret}.` : "";
        return toolText(`Mandate ${r.data.mandate?.id} watches ${r.data.mandate?.token} until ${r.data.mandate?.expiresAt}. First check: ${signalText(r.data.event?.signal)}${secret}`, r.data);
      }
      if (r.status === 402) return toolText(payInstructions(r.data).replace("call gate_check again", "call create_mandate again"), r.data, true);
      return apiError(r);
    }
    case "get_mandate": {
      const r = await call("GET", `/api/v1/mandates/${args.id}`);
      if (r.status !== 200 || !r.data) return apiError(r);
      return toolText(`Mandate ${r.data.id}: ${r.data.state}, ${r.data.checks} checks, expires ${r.data.expiresAt}. Latest: ${signalText(r.data.signal)}`, r.data);
    }
    case "mandate_events": {
      const after = Number.isSafeInteger(args.after) && args.after >= 0 ? args.after : 0;
      const r = await call("GET", `/api/v1/mandates/${args.id}/events?after=${after}&limit=50`);
      if (r.status !== 200 || !r.data) return apiError(r);
      const lines = (r.data.events ?? []).map((e: any) => `#${e.seq} ${e.at} ${e.kind}${e.signal ? ` ${e.signal.action}` : ""}${e.changes?.length ? ` changed: ${e.changes.map((c: any) => c.field).join(", ")}` : ""}${e.error ? ` (read failed: ${e.error})` : ""}`);
      return toolText(lines.length ? lines.join("\n") : "No events after that seq.", r.data);
    }
    case "premortem": {
      const r = await call("POST", "/api/v1/premortem", args);
      if (r.status !== 200 || !r.data) return apiError(r);
      const d = r.data;
      const lines = (d.risks ?? []).map((x: any) => `- [${x.severity}, ${x.basis}] ${x.plain} Fix: ${x.fix}`);
      const cohort = d.cohort ? d.cohort.note : "Launch data not available here.";
      return toolText([`The gate would say ${d.gate?.decision} for this draft.`, ...(lines.length ? lines : ["- no risk found by our rules"]), cohort].join("\n"), d);
    }
    case "verify_signal": {
      const r = await call("POST", "/api/v1/signals/verify", { signal: args.signal });
      if (r.status !== 200 || !r.data) return apiError(r);
      return toolText(r.data.valid ? (r.data.expired ? "Genuine, but expired: fetch a fresh signal." : "Valid and current.") : `Not valid: ${r.data.reason}.`, r.data);
    }
    case "launch_odds": {
      const r = await call("GET", "/api/v1/odds");
      if (r.status !== 200 || !r.data) return apiError(r);
      const band = (b: any, unit: string) => `- ${unit}${b.minUsd}${b.maxUsd === null ? "+" : `-${b.maxUsd}`}: ${b.n} pools, still trading ${pct(b.stillTradingPct)}`;
      const lines = [
        "By liquidity when first seen (USD):", ...(r.data.byFirstLiquidityUsd ?? []).map((b: any) => band(b, "$")),
        "By swaps in the first 24h:", ...(r.data.byFirstSwaps ?? []).map((b: any) => band(b, "")),
        r.data.coverage?.note ?? "",
      ];
      return toolText(lines.join("\n"), r.data);
    }
    case "launch_board": {
      const days = Number.isSafeInteger(args.days) ? args.days : 7;
      const r = await call("GET", `/api/v1/board?days=${days}`);
      if (r.status !== 200 || !r.data) return apiError(r);
      const lines = (r.data.days ?? []).map((d: any) => `- ${d.day}: ${d.pools} pools, ${d.outcomes} re-checked, still trading ${pct(d.stillTradingPct)}`);
      return toolText(lines.length ? lines.join("\n") : "No pools in that window.", r.data);
    }
    case "ticker_radar": {
      const hours = Number.isSafeInteger(args.hours) ? args.hours : 24;
      const r = await call("GET", `/api/v1/radar?hours=${hours}`);
      if (r.status !== 200 || !r.data) return apiError(r);
      const lines = (r.data.waves ?? []).map((w: any) => `- ${w.ticker}: ${w.recentTokens} recent tokens (${w.totalTokens} in all), earliest ${w.first?.token ?? "?"}, busiest ${w.busiest?.token ?? "?"}`);
      return toolText(lines.length ? [...lines, r.data.note].join("\n") : "No reused tickers in that window.", r.data);
    }
    case "token_autopsy": {
      const r = await call("GET", `/api/v1/autopsy/${args.address}`);
      if (r.status !== 200 || !r.data) return apiError(r);
      return toolText(`${r.data.symbol ?? args.address}: ${r.data.pattern}. ${r.data.plain}`, r.data);
    }
    case "get_pricing":
    case "list_presets":
    case "get_signer": {
      const path = name === "get_pricing" ? "/api/v1/gate/pricing" : name === "list_presets" ? "/api/v1/gate/presets" : "/api/v1/receipts/signer";
      const r = await call("GET", path);
      if (r.status !== 200 || !r.data) return apiError(r);
      return toolText(JSON.stringify(r.data), r.data);
    }
  }
  throw new RpcError(-32602, `Unknown tool: ${name}`);
}

// One JSON-RPC message. Returns null for notifications and responses (nothing to answer).
async function handleMessage(raw: unknown, req: Request, callApi: (r: Request) => Promise<Response>): Promise<object | null> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return err(null, -32600, "Invalid Request");
  const msg = raw as Msg;
  const hasId = msg.id !== undefined;
  const id: Id = typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null;
  if (hasId && msg.id !== null && typeof msg.id !== "string" && typeof msg.id !== "number") return err(null, -32600, "Invalid Request");
  if (msg.jsonrpc !== "2.0") return err(id, -32600, "Invalid Request: jsonrpc must be \"2.0\"");
  if (typeof msg.method !== "string") {
    // A response from the client (id plus result/error, no method): nothing to do. Anything else is malformed.
    if (hasId && ("result" in msg || "error" in msg)) return null;
    return err(id, -32600, "Invalid Request: method is required");
  }
  if (!hasId) return null; // notification (notifications/initialized, notifications/cancelled, ...)

  const params = msg.params;
  if (params !== undefined && (typeof params !== "object" || params === null)) return err(id, -32602, "params must be an object");
  const p = (params ?? {}) as Record<string, any>;

  try {
    switch (msg.method) {
      case "initialize": {
        const asked = p.protocolVersion;
        if (typeof asked !== "string") return err(id, -32602, "protocolVersion is required");
        return ok(id, {
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "reinkeep", title: "Reinkeep AI", version: SERVER_VERSION },
          instructions: "Pre-payment gate. Call gate_check before every payment and pay only the exact amount to the exact recipient you checked. It is advice: it cannot stop a payment you do not ask about.",
        });
      }
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: TOOLS });
      case "tools/call": {
        const name = p.name;
        if (typeof name !== "string") return err(id, -32602, "name is required");
        const tool = TOOLS.find((t) => t.name === name);
        if (!tool) return err(id, -32602, `Unknown tool: ${name}`);
        const args = p.arguments ?? {};
        const bad = check(tool.inputSchema, args, "arguments");
        if (bad) return err(id, -32602, `Invalid arguments: ${bad}`);
        return ok(id, await callTool(name, args, req, callApi));
      }
      default:
        return err(id, -32601, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    if (e instanceof RpcError) return err(id, e.code, e.message);
    console.error("mcp error", e);
    return err(id, -32603, "Internal error");
  }
}

const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

export async function handleMcp(req: Request, callApi: (req: Request) => Promise<Response>): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  if (path !== "/mcp") return reply(404, err(null, -32600, "Not found"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply(405, err(null, -32600, "This server only accepts POST at /mcp (stateless, no stream, no sessions)."), { allow: "POST" });

  // Lenient on purpose: Accept and MCP-Protocol-Version are not enforced. A version we do not know is the client's
  // problem only if it matters; every answer here is the same for all supported versions.
  const text = await readLimited(req, MAX_MCP_BODY_BYTES);
  if (text === null) return reply(413, err(null, -32600, `Request body is larger than ${MAX_MCP_BODY_BYTES} bytes.`));
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return reply(400, err(null, -32700, "Parse error"));
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return reply(400, err(null, -32600, "Invalid Request: empty batch"));
    const out = (await Promise.all(parsed.map((m) => handleMessage(m, req, callApi)))).filter((x) => x !== null);
    return out.length ? reply(200, out) : reply(202, null);
  }
  const out = await handleMessage(parsed, req, callApi);
  if (out === null) return reply(202, null);
  // A malformed single request is answered with HTTP 400 as the transport spec asks; JSON-RPC errors for valid calls are 200.
  const e = (out as { error?: { code: number } }).error;
  return reply(e && e.code === -32600 ? 400 : 200, out);
}
