// The remote MCP endpoint (api/src/mcp.ts). Most tests use a fake callApi that records what the tools send;
// the last ones wire it to the real createHandler so a gate_check runs the real gate and signs a real receipt.
import assert from "node:assert/strict";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createHandler } from "../api/src/http-handler.ts";
import { handleMcp, MAX_MCP_BODY_BYTES } from "../api/src/mcp.ts";
import { T0, goodRequest, knownPolicy } from "./api-fixture.ts";

const ORIGIN = "https://gate.test";
type Canned = (req: Request) => Response | Promise<Response>;
const j = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function fake(canned: Canned = () => j(200, {})) {
  const seen: { method: string; path: string; headers: Headers; body: any }[] = [];
  const callApi = async (req: Request) => {
    const text = await req.text();
    seen.push({ method: req.method, path: new URL(req.url).pathname, headers: req.headers, body: text ? JSON.parse(text) : undefined });
    return canned(req);
  };
  return { seen, callApi };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(ORIGIN + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
async function call(f: ReturnType<typeof fake>, body: unknown, headers: Record<string, string> = {}) {
  const res = await handleMcp(post(body, headers), f.callApi);
  const text = await res.text();
  return { res, data: text ? JSON.parse(text) : undefined };
}
const tool = (id: number, name: string, args: unknown) => rpc(id, "tools/call", { name, arguments: args });

const GATE_OK = { id: "r1", decision: "ALLOW", reasons: [], receipt: { id: "r1" } };
const QUOTE = {
  x402Version: 2,
  error: "The 25 free calls for today are used. Payment required.",
  resource: { url: ORIGIN + "/api/v1/gate" },
  accepts: [{ scheme: "exact", network: "eip155:4663", asset: "0xUSDG", amount: "10000", payTo: "0xOWNER", maxTimeoutSeconds: 60 }],
};

test("initialize echoes a supported version and names the server", async () => {
  const f = fake();
  const { res, data } = await call(f, rpc(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type")!, /application\/json/);
  assert.equal(data.result.protocolVersion, "2025-03-26");
  assert.equal(data.result.serverInfo.name, "reinkeep");
  assert.equal(data.result.serverInfo.title, "Reinkeep AI");
  assert.deepEqual(data.result.capabilities, { tools: {} });
  assert.equal(data.id, 1);
});

test("initialize with an unknown version answers the latest supported one", async () => {
  const { data } = await call(fake(), rpc(1, "initialize", { protocolVersion: "1999-01-01" }));
  assert.equal(data.result.protocolVersion, "2025-11-25");
});

test("notifications/initialized gets 202 and no body", async () => {
  const res = await handleMcp(post({ jsonrpc: "2.0", method: "notifications/initialized" }), fake().callApi);
  assert.equal(res.status, 202);
  assert.equal(await res.text(), "");
});

test("ping answers an empty result", async () => {
  const { data } = await call(fake(), rpc(7, "ping"));
  assert.deepEqual(data, { jsonrpc: "2.0", id: 7, result: {} });
});

test("tools/list names the sixteen tools, each with an object schema", async () => {
  const { data } = await call(fake(), rpc(2, "tools/list"));
  assert.deepEqual(data.result.tools.map((t: any) => t.name), [
    "gate_check", "verify_receipt", "get_pricing", "list_presets", "get_signer", "check_token", "get_receipt",
    "create_mandate", "get_mandate", "mandate_events", "premortem", "verify_signal",
    "launch_odds", "launch_board", "ticker_radar", "token_autopsy",
  ]);
  for (const t of data.result.tools) {
    assert.equal(t.inputSchema.type, "object");
    assert.ok(t.description.length > 20);
  }
});

test("gate_check ALLOW: text has the decision, structuredContent is the API answer, body is passed on", async () => {
  const f = fake(() => j(200, GATE_OK));
  const args = { request: goodRequest(), policy: "reinkeep-default-v1", payer: "0x00000000000000000000000000000000000000a1", token: "0x00000000000000000000000000000000000000b2" };
  const { data } = await call(f, tool(3, "gate_check", args));
  assert.notEqual(data.result.isError, true);
  assert.match(data.result.content[0].text, /^ALLOW/);
  assert.deepEqual(data.result.structuredContent, GATE_OK);
  assert.equal(f.seen[0].method, "POST");
  assert.equal(f.seen[0].path, "/api/v1/gate");
  assert.deepEqual(f.seen[0].body, args);
  assert.equal(f.seen[0].headers.get("payment-signature"), null);
});

test("gate_check lists the reasons in the text", async () => {
  const f = fake(() => j(200, { id: "r2", decision: "BLOCK", reasons: [{ code: "pay_to_unknown", plain: "New recipient." }], receipt: {} }));
  const { data } = await call(f, tool(3, "gate_check", { request: goodRequest() }));
  assert.match(data.result.content[0].text, /BLOCK[\s\S]*pay_to_unknown: New recipient\.[\s\S]*Do not pay/);
});

test("gate_check 402: isError, pay instructions, structuredContent is the 402 body", async () => {
  const f = fake(() => j(402, QUOTE));
  const { data } = await call(f, tool(4, "gate_check", { request: goodRequest() }));
  assert.equal(data.result.isError, true);
  const t = data.result.content[0].text;
  assert.match(t, /free calls/);
  assert.match(t, /10000/);
  assert.match(t, /0xOWNER/);
  assert.match(t, /eip155:4663/);
  assert.match(t, /payment_signature/);
  assert.deepEqual(data.result.structuredContent, QUOTE);
});

test("gate_check other API error: isError with the API code and message", async () => {
  const f = fake(() => j(400, { error: { code: "invalid_request", message: "amount must be a string" } }));
  const { data } = await call(f, tool(5, "gate_check", { request: goodRequest() }));
  assert.equal(data.result.isError, true);
  assert.match(data.result.content[0].text, /400 invalid_request: amount must be a string/);
  assert.equal(data.result.structuredContent.error.code, "invalid_request");
});

test("gate_check when the API cannot be reached is a tool error, not a crash", async () => {
  const callApi = async () => {
    throw new Error("boom");
  };
  const res = await handleMcp(post(tool(5, "gate_check", { request: goodRequest() })), callApi);
  const data = await res.json();
  assert.equal(data.result.isError, true);
});

test("payment_signature is forwarded as the PAYMENT-SIGNATURE header, not in the body", async () => {
  const f = fake(() => j(200, GATE_OK));
  await call(f, tool(6, "gate_check", { request: goodRequest(), payment_signature: "eyJhIjoxfQ==" }));
  assert.equal(f.seen[0].headers.get("payment-signature"), "eyJhIjoxfQ==");
  assert.equal("payment_signature" in f.seen[0].body, false);
});

test("a payment_signature that is not base64 is invalid params", async () => {
  const f = fake();
  const { data } = await call(f, tool(6, "gate_check", { request: goodRequest(), payment_signature: "bad\r\nheader: x" }));
  assert.equal(data.error.code, -32602);
  assert.equal(f.seen.length, 0);
});

test("cf-connecting-ip of the MCP call is forwarded to every tool call", async () => {
  const f = fake(() => j(200, GATE_OK));
  await call(f, tool(8, "gate_check", { request: goodRequest() }), { "cf-connecting-ip": "203.0.113.9" });
  await call(f, tool(9, "get_pricing", {}), { "cf-connecting-ip": "203.0.113.9" });
  assert.equal(f.seen[0].headers.get("cf-connecting-ip"), "203.0.113.9");
  assert.equal(f.seen[1].headers.get("cf-connecting-ip"), "203.0.113.9");
});

test("no cf-connecting-ip on the way in means none on the way out", async () => {
  const f = fake(() => j(200, GATE_OK));
  await call(f, tool(8, "gate_check", { request: goodRequest() }));
  assert.equal(f.seen[0].headers.get("cf-connecting-ip"), null);
});

test("verify_receipt, get_pricing, list_presets and get_signer hit the right endpoints", async () => {
  const f = fake((req) => (new URL(req.url).pathname.endsWith("verify") ? j(200, { valid: true, signer: "0xS" }) : j(200, { ok: 1 })));
  const v = await call(f, tool(1, "verify_receipt", { receipt: { id: "r1" } }));
  await call(f, tool(2, "get_pricing", {}));
  await call(f, tool(3, "list_presets", {}));
  await call(f, tool(4, "get_signer", {}));
  assert.match(v.data.result.content[0].text, /Valid\. Signed by 0xS/);
  assert.deepEqual(f.seen.map((s) => `${s.method} ${s.path}`), [
    "POST /api/v1/receipts/verify", "GET /api/v1/gate/pricing", "GET /api/v1/gate/presets", "GET /api/v1/receipts/signer",
  ]);
  assert.deepEqual(f.seen[0].body, { receipt: { id: "r1" } });
});

test("invalid params: missing request, wrong type, extra field, unknown tool -> -32602", async () => {
  const f = fake();
  for (const t of [
    tool(1, "gate_check", {}),
    tool(1, "gate_check", { request: "nope" }),
    tool(1, "gate_check", { request: goodRequest(), surprise: 1 }),
    tool(1, "gate_check", { request: goodRequest({ decimals: undefined }) }),
    tool(1, "get_pricing", { x: 1 }),
    tool(1, "no_such_tool", {}),
    rpc(1, "tools/call", {}),
  ]) {
    const { data } = await call(f, t);
    assert.equal(data.error?.code, -32602, JSON.stringify(t));
  }
  assert.equal(f.seen.length, 0);
});

test("unknown method -> -32601", async () => {
  const { data } = await call(fake(), rpc(1, "resources/list"));
  assert.equal(data.error.code, -32601);
  assert.equal(data.id, 1);
});

test("bad JSON -> -32700 with id null", async () => {
  const { res, data } = await call(fake(), "{not json");
  assert.equal(res.status, 400);
  assert.equal(data.error.code, -32700);
  assert.equal(data.id, null);
});

test("not a JSON-RPC message -> -32600", async () => {
  for (const body of [{ hello: 1 }, { jsonrpc: "2.0", id: 1 }, 42, []]) {
    const { data } = await call(fake(), body);
    assert.equal(data.error.code, -32600, JSON.stringify(body));
  }
});

test("a body over 64KB is refused with a JSON-RPC error and nothing is called", async () => {
  const f = fake();
  const { res, data } = await call(f, JSON.stringify(tool(1, "gate_check", { request: goodRequest({ resourceUrl: "https://x.test/" + "a".repeat(MAX_MCP_BODY_BYTES) }) })));
  assert.equal(res.status, 413);
  assert.equal(data.error.code, -32600);
  assert.equal(f.seen.length, 0);
});

test("a batch (older clients) gets an array back; notifications in it get no entry", async () => {
  const f = fake();
  const { data } = await call(f, [rpc(1, "ping"), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc(2, "tools/list")]);
  assert.equal(data.length, 2);
  assert.deepEqual(data.map((d: any) => d.id), [1, 2]);
});

test("GET and DELETE are 405 with Allow: POST; OPTIONS is a CORS preflight", async () => {
  const f = fake();
  for (const method of ["GET", "DELETE"]) {
    const res = await handleMcp(new Request(ORIGIN + "/mcp", { method }), f.callApi);
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
  }
  const pre = await handleMcp(new Request(ORIGIN + "/mcp", { method: "OPTIONS" }), f.callApi);
  assert.equal(pre.status, 204);
  const allow = pre.headers.get("access-control-allow-headers")!;
  for (const h of ["content-type", "mcp-protocol-version", "mcp-session-id", "accept"]) assert.ok(allow.includes(h), h);
  assert.equal(pre.headers.get("access-control-allow-origin"), "*");
});

test("answers carry CORS and no-store", async () => {
  const { res } = await call(fake(), rpc(1, "ping"));
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

// ---- wired to the real REST handler ----

function real() {
  const account = privateKeyToAccount(generatePrivateKey());
  const handler = createHandler({ account, now: () => T0 });
  const seen: Request[] = [];
  const callApi = async (req: Request) => {
    seen.push(req.clone());
    return handler(req);
  };
  return { account, callApi, seen };
}

test("end to end: gate_check runs the real gate, then verify_receipt accepts its receipt", async () => {
  const r = real();
  const g = await (await handleMcp(post(tool(1, "gate_check", { request: goodRequest(), policy: knownPolicy })), r.callApi)).json();
  assert.notEqual(g.result.isError, true);
  assert.equal(g.result.structuredContent.decision, "ALLOW");
  assert.match(g.result.content[0].text, /^ALLOW/);
  const v = await (await handleMcp(post(tool(2, "verify_receipt", { receipt: g.result.structuredContent.receipt })), r.callApi)).json();
  assert.equal(v.result.structuredContent.valid, true);
  assert.equal(v.result.structuredContent.signer, r.account.address);
});

test("end to end: a bad request is a tool error carrying the API's code, and the read-only tools answer", async () => {
  const r = real();
  const bad = await (await handleMcp(post(tool(1, "gate_check", { request: goodRequest({ payTo: "not-an-address" }) })), r.callApi)).json();
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /^Error 4\d\d /);
  const presets = await (await handleMcp(post(tool(2, "list_presets", {})), r.callApi)).json();
  assert.ok(presets.result.structuredContent.presets);
  const signer = await (await handleMcp(post(tool(3, "get_signer", {})), r.callApi)).json();
  assert.equal(signer.result.structuredContent.signer, r.account.address);
});

test("launch-data tools call the right GET paths, default the window, and pass API errors through", async () => {
  const urls: string[] = [];
  const f = fake((req) => {
    urls.push(new URL(req.url).pathname + new URL(req.url).search);
    const p = new URL(req.url).pathname;
    if (p === "/api/v1/odds") return j(200, { byFirstLiquidityUsd: [{ minUsd: 0, maxUsd: 1000, n: 3, stillTradingPct: null }], byFirstSwaps: [], coverage: { note: "sample" } });
    if (p === "/api/v1/board") return j(200, { days: [{ day: "2026-11-10", pools: 40, outcomes: 35, stillTradingPct: 18 }] });
    if (p === "/api/v1/radar") return j(200, { waves: [], note: "n" });
    return j(404, { error: { code: "token_not_collected", message: "No pool." } });
  });
  const odds = (await call(f, tool(1, "launch_odds", {}))).data.result;
  assert.match(odds.content[0].text, /\$0-1000: 3 pools, still trading not enough data/);
  const board = (await call(f, tool(2, "launch_board", {}))).data.result;
  assert.match(board.content[0].text, /2026-11-10: 40 pools, 35 re-checked, still trading 18%/);
  await call(f, tool(3, "launch_board", { days: 2.5 }));
  await call(f, tool(4, "ticker_radar", { hours: 48 }));
  const dead = (await call(f, tool(5, "token_autopsy", { address: "0x" + "a".repeat(40) }))).data.result;
  assert.equal(dead.isError, true);
  assert.match(dead.content[0].text, /404 token_not_collected/);
  assert.deepEqual(urls, ["/api/v1/odds", "/api/v1/board?days=7", "/api/v1/board?days=7", "/api/v1/radar?hours=48", "/api/v1/autopsy/0x" + "a".repeat(40)]);
});
