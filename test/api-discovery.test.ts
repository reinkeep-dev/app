// The discovery documents: right content type, valid, built from the real constants, and every path they advertise is
// actually routed (createHandler or metering). No network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BASE_URL, discovery, MCP_URL } from "../api/src/discovery.ts";
import { meter } from "../api/src/metering.ts";
import { handleMandates, isMandateRoute } from "../api/src/mandate-routes.ts";
import { FREE_CALLS_PER_DAY, NETWORK, PRICE_AMOUNT, PRICE_USD, USDG, requirementsFor } from "../api/src/x402.ts";
import { PRESETS } from "../api/src/request-validation.ts";
import { makeApp } from "./api-fixture.ts";

const OWNER = "0x1111111111111111111111111111111111111111";
const ask = (path: string, env: { X402_PAY_TO?: string } = { X402_PAY_TO: OWNER }, method = "GET") =>
  discovery(new Request("https://x.test" + path, { method }), env);
const jsonOf = async (path: string, env?: { X402_PAY_TO?: string }) => JSON.parse(await ask(path, env)!.text());

// Endpoints as the README table lists them: "| `POST /gate` |" under the /api/v1 heading.
const readme = readFileSync(new URL("../api/README.md", import.meta.url), "utf8");
const readmePaths = [...readme.matchAll(/^\| `(GET|POST|DELETE) (\/[^` ]+)`/gm)].map((m) => ({ method: m[1].toLowerCase(), path: "/api/v1" + m[2] }));

test("each document answers 200 with the right content type and headers", async () => {
  const cases: Array<[string, RegExp]> = [
    ["/llms.txt", /^text\/plain/],
    ["/.well-known/agent.json", /^application\/json/],
    ["/api/v1/openapi.json", /^application\/json/],
    ["/.well-known/x402", /^application\/json/],
  ];
  for (const [path, type] of cases) {
    const res = ask(path)!;
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get("content-type") ?? "", type, path);
    assert.equal(res.headers.get("cache-control"), "public, max-age=300");
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const text = await res.text();
    assert.ok(text.length > 20);
    if (path !== "/llms.txt") JSON.parse(text);
  }
});

test("HEAD works with no body, other methods and other paths are null", async () => {
  const head = ask("/llms.txt", undefined, "HEAD")!;
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(ask("/llms.txt", undefined, "POST"), null);
  for (const p of ["/", "/mcp", "/api/v1/gate", "/llms.txt/x", "/.well-known/other"]) assert.equal(ask(p), null, p);
});

test("openapi lists every endpoint the README lists, with the right methods", async () => {
  assert.ok(readmePaths.length >= 6, "README table parsed");
  const doc = await jsonOf("/api/v1/openapi.json");
  assert.equal(doc.openapi, "3.1.0");
  assert.equal(doc.servers[0].url, BASE_URL);
  for (const { method, path } of readmePaths) assert.ok(doc.paths[path]?.[method], `${method} ${path}`);
  assert.deepEqual(Object.keys(doc.paths).sort(), [...new Set(readmePaths.map((p) => p.path))].sort());
  // 402 is documented on both paid routes; the preset enum comes from the code.
  for (const p of ["/api/v1/gate", "/api/v1/gate/x402"]) assert.ok(doc.paths[p].post.responses["402"]);
  assert.deepEqual(doc.components.schemas.GateRequest.properties.policy.oneOf[0].enum, Object.keys(PRESETS));
  assert.equal(doc.components.schemas.Pricing.properties.amount.const, PRICE_AMOUNT);
});

test("every path in openapi.json is routed by the handler or metering (not 404)", async () => {
  const doc = await jsonOf("/api/v1/openapi.json");
  const app = makeApp();
  const env = { X402_PAY_TO: OWNER }; // no PRIORS_API_KEY and no FREE: paid routes answer 503, which is still "routed"
  let checked = 0;
  for (const [path, item] of Object.entries<any>(doc.paths)) {
    for (const method of Object.keys(item)) {
      const init: RequestInit = { method: method.toUpperCase() };
      if (method === "post") Object.assign(init, { headers: { "content-type": "application/json" }, body: "{}" });
      const req = () => new Request("http://gate.test" + path, init);
      // Same split as worker.ts: mandate paths go to their routes (no watcher bound here: 503, still routed).
      const route = (r: Request) =>
        isMandateRoute(new URL(r.url).pathname) ? handleMandates(r, { signer: app.account.address, now: () => 0 }) : app.handle(r);
      const res = (await meter(req(), env, { route, fetch })) ?? (await route(req()));
      assert.notEqual(res.status, 404, `${method} ${path}`);
      assert.notEqual(res.status, 405, `${method} ${path}`);
      checked++;
    }
  }
  assert.equal(checked, readmePaths.length);
});

test("agent card has the required A2A fields and both skills", async () => {
  const card = await jsonOf("/.well-known/agent.json");
  for (const k of ["protocolVersion", "name", "description", "url", "version", "provider", "capabilities", "skills", "defaultInputModes", "defaultOutputModes"]) assert.ok(card[k] !== undefined, k);
  assert.deepEqual(card.skills.map((s: any) => s.id), ["gate_check", "verify_receipt"]);
  for (const s of card.skills) for (const k of ["id", "name", "description", "tags"]) assert.ok(s[k], `${s.id}.${k}`);
  assert.ok(card.additionalInterfaces.some((i: any) => i.url === MCP_URL));
  assert.ok(card.url.startsWith(BASE_URL));
});

test("x402 listing uses payTo from env and the amount from x402.ts", async () => {
  const doc = await jsonOf("/.well-known/x402");
  assert.deepEqual(doc.resources, [BASE_URL + "/api/v1/gate/x402"]);
  assert.deepEqual(doc.items[0].accepts, [requirementsFor(OWNER)]);
  assert.equal(doc.items[0].accepts[0].amount, PRICE_AMOUNT);
  assert.equal(doc.items[0].accepts[0].asset, USDG);
  assert.equal(doc.items[0].accepts[0].network, NETWORK);
  assert.equal(doc.items[0].x402Version, 2);
});

test("without a valid X402_PAY_TO the listing has no paid entries", async () => {
  for (const env of [{}, { X402_PAY_TO: "" }, { X402_PAY_TO: "not-an-address" }]) {
    const doc = await jsonOf("/.well-known/x402", env);
    assert.deepEqual(doc.resources, []);
    assert.deepEqual(doc.items, []);
  }
});

test("llms.txt names every endpoint, the price, the MCP url and the limits", async () => {
  const txt = await ask("/llms.txt")!.text();
  for (const { path } of readmePaths) assert.ok(txt.includes(path), path);
  assert.ok(txt.includes(`$${PRICE_USD.toFixed(2)}`));
  assert.ok(txt.includes(PRICE_AMOUNT) && txt.includes(USDG) && txt.includes(String(FREE_CALLS_PER_DAY)));
  assert.ok(txt.includes("https://reinkeep-gate.reinkeep.workers.dev/mcp"));
  assert.match(txt, /Not audited/);
  assert.match(txt, /Unknown never passes/);
  assert.match(txt, /token_mint_live_owner/);
  assert.ok(txt.includes("curl"));
});
