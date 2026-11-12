import test from "node:test";
import assert from "node:assert/strict";
import { defaultPolicy } from "../engine/policy.ts";
import { MAX_BODY_BYTES } from "../api/src/http-handler.ts";
import { PAYER, goodRequest, makeApp } from "./api-fixture.ts";

test("unknown path is a 404 in JSON, wrong method is a 405", async () => {
  const app = makeApp();
  const nf = await app.send("GET", "/api/v1/nothing");
  assert.equal(nf.status, 404);
  assert.equal(nf.data.error.code, "not_found");
  const wrong = await app.send("GET", "/api/v1/gate");
  assert.equal(wrong.status, 405);
  assert.equal(wrong.data.error.code, "method_not_allowed");
  assert.equal((await app.send("POST", "/api/v1/receipts/signer", {})).status, 405);
});

test("a trailing slash does not matter", async () => {
  assert.equal((await makeApp().send("GET", "/api/v1/gate/presets/")).status, 200);
});

test("CORS: open to browsers, and the preflight answers 204", async () => {
  const app = makeApp();
  const pre = await app.send("OPTIONS", "/api/v1/gate");
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "*");
  assert.match(pre.headers.get("access-control-allow-methods") ?? "", /POST/);
  assert.match(pre.headers.get("access-control-allow-headers") ?? "", /content-type/i);
});

test("every response, errors included, is JSON, not cached, and not sniffable", async () => {
  const app = makeApp();
  for (const r of [await app.send("GET", "/api/v1/gate/presets"), await app.send("GET", "/nope"), await app.send("POST", "/api/v1/gate", "{bad"), await app.gate(goodRequest())]) {
    assert.match(r.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
  }
});

test("POST needs application/json (415) and valid JSON (400)", async () => {
  const app = makeApp();
  const wrongType = await app.send("POST", "/api/v1/gate", JSON.stringify({ request: goodRequest() }), { "content-type": "text/plain" });
  assert.equal(wrongType.status, 415);
  assert.equal(wrongType.data.error.code, "unsupported_media_type");
  const broken = await app.send("POST", "/api/v1/gate", "{not json");
  assert.equal(broken.status, 400);
  assert.equal(broken.data.error.code, "invalid_json");
  assert.equal((await app.send("POST", "/api/v1/gate", "")).status, 400);
});

test("an oversize body is refused (413), whether or not it declares its size", async () => {
  const app = makeApp();
  const huge = JSON.stringify({ request: goodRequest(), padding: "x".repeat(MAX_BODY_BYTES + 10) });
  assert.equal((await app.send("POST", "/api/v1/gate", huge)).status, 413);

  // No content-length: a stream that keeps going is cut off at the limit.
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(4096)));
    },
  });
  const res = await app.handle(new Request("http://gate.test/api/v1/gate", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit));
  assert.equal(res.status, 413);
});

test("a server fault is a plain 500 that leaks nothing", async () => {
  const exploding = {
    async run() {
      throw new Error("database password is hunter2");
    },
  };
  const app = makeApp({ store: exploding as any });
  const silence = console.error;
  console.error = () => {};
  try {
    const r = await app.gate(goodRequest(), { payer: PAYER });
    assert.equal(r.status, 500);
    assert.equal(r.data.error.code, "internal");
    assert.equal(r.text.includes("hunter2"), false);
    assert.equal(r.text.includes("database"), false);
  } finally {
    console.error = silence;
  }
});

test("the signing key never appears in any response", async () => {
  const app = makeApp();
  const bare = app.key.slice(2);
  const replies = [
    await app.send("GET", "/api/v1/receipts/signer"),
    await app.send("GET", "/api/v1/gate/presets"),
    await app.gate(goodRequest()),
    await app.send("POST", "/api/v1/gate", "{bad"),
    await app.send("GET", "/nope"),
  ];
  for (const r of replies) assert.equal(r.text.toLowerCase().includes(bare.toLowerCase()), false);
});

test("the preset list matches the engine's default policy", async () => {
  const r = await makeApp().send("GET", "/api/v1/gate/presets");
  assert.deepEqual(r.data.presets["reinkeep-default-v1"], defaultPolicy);
});

test("the signer endpoint publishes the address, domain and types", async () => {
  const app = makeApp();
  const r = await app.send("GET", "/api/v1/receipts/signer");
  assert.equal(r.data.signer, app.account.address);
  assert.equal(r.data.primaryType, "Receipt");
  assert.deepEqual(r.data.types.Receipt.map((f: any) => f.name), ["id", "decision", "policyHash", "bodyHash", "issuedAt"]);
});
