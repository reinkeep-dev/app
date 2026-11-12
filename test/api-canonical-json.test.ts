import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson } from "../api/src/canonical-json.ts";

test("key order does not change the output", () => {
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
});

test("known output: sorted keys at every depth, no spaces", () => {
  assert.equal(canonicalJson({ b: [1, { d: 1, c: 2 }], a: "x" }), '{"a":"x","b":[1,{"c":2,"d":1}]}');
});

test("array order is kept", () => {
  assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]");
});

test("undefined properties are dropped, null is kept", () => {
  assert.equal(canonicalJson({ a: undefined, b: null }), '{"b":null}');
});

test("strings are escaped the standard way, unicode stays as is", () => {
  assert.equal(canonicalJson({ s: 'a"b\né' }), '{"s":"a\\"b\\né"}');
});

test("values that runtimes write differently are refused", () => {
  assert.throws(() => canonicalJson(10n), /cannot encode/);
  assert.throws(() => canonicalJson(NaN), /not finite/);
  assert.throws(() => canonicalJson(Infinity), /not finite/);
  assert.throws(() => canonicalJson(undefined), /cannot encode/);
  assert.throws(() => canonicalJson(() => 1), /cannot encode/);
  assert.throws(() => canonicalJson({ nested: { n: 1n } }), /cannot encode/);
});
