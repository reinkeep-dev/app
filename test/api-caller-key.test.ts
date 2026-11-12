// The free-tier counter key: an IPv6 caller is counted per /64, so rotating addresses inside one network gives no new
// free calls. IPv4 stays per address.
import assert from "node:assert/strict";
import test from "node:test";
import { callerKey } from "../api/src/metering.ts";

const from = (ip?: string) => callerKey(new Request("https://x/", { headers: ip ? { "cf-connecting-ip": ip } : {} }));

test("callerKey: IPv4 as is, missing as unknown", () => {
  assert.equal(from("203.0.113.7"), "203.0.113.7");
  assert.equal(from(), "unknown");
});

test("callerKey: every IPv6 address in one /64 shares a key, another /64 does not", () => {
  const a = from("2001:db8:aa:1::1");
  assert.equal(a, "2001:db8:aa:1::/64");
  assert.equal(from("2001:db8:aa:1:ffff:ffff:ffff:ffff"), a);
  assert.equal(from("2001:0DB8:00aa:0001:1234::9"), a, "case and leading zeros");
  assert.notEqual(from("2001:db8:aa:2::1"), a);
  assert.equal(from("2001:db8::1"), "2001:db8:0:0::/64", ":: inside the network part");
  assert.equal(from("::1"), "0:0:0:0::/64");
});
