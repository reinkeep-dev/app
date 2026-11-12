import test from "node:test";
import assert from "node:assert/strict";
import { createRpcClient, looksLikeToken, readContractFacts, SCANNER_VERSION, scanPowers } from "../collector/src/contract-facts.ts";
import { HttpError } from "../collector/src/http-json.ts";
import { addressWord, BLACKLIST, codeWith, fakeInternet, fixture, MINT, NOW, noSleep, PAUSE, PLAIN_CODE, RPC_URL, UPGRADE, word, type Internet } from "./collector-fixtures.ts";

const TOKEN = "0x" + "11".repeat(20);
const IMPL = "0x" + "22".repeat(20);
const OWNER = "0x" + "33".repeat(20);

function setup(o: Internet) {
  const net = fakeInternet(o);
  return { net, rpc: createRpcClient({ url: RPC_URL, fetch: net.fetch, sleep: noSleep }) };
}
const facts = (o: Internet, token = TOKEN) => {
  const s = setup(o);
  return readContractFacts(s.rpc, token, NOW).then((f) => ({ f, net: s.net }));
};

test("REAL node answers for the Metrion token, read through the whole code path", async () => {
  const recorded = fixture("rpc-metrion-batch.json") as { id: number; result?: string; error?: unknown }[];
  const order: string[] = [];
  const replay = async (_url: string, init?: RequestInit) => {
    const asked = JSON.parse(String(init!.body)) as { id: number; method: string }[];
    order.push(...asked.map((c) => c.method));
    return new Response(JSON.stringify(asked.map((c) => recorded.find((r) => r.id === c.id)!)), { status: 200 });
  };
  const rpc = createRpcClient({ url: RPC_URL, fetch: replay, sleep: noSleep });
  const f = await readContractFacts(rpc, "0x38a4656010a2384c07ee7eaa9e1ce8f71c4098f0", NOW);
  assert.deepEqual(order, ["eth_getCode", "eth_getStorageAt", "eth_call", "eth_call", "eth_call", "eth_call"], "the questions go in the order that was recorded");
  assert.deepEqual(f, {
    token: "0x38a4656010a2384c07ee7eaa9e1ce8f71c4098f0", readAtMs: NOW, scannerVersion: 2, isContract: true, codeSize: 4655, isProxy: false, implementation: null,
    hasMint: false, hasPause: false, hasBlacklist: false, hasUpgrade: false, hasOwnerFunction: false, owner: null, ownerRenounced: null,
    mintWithLiveOwner: false, totalSupply: "1000000000000000000000000000", decimals: 18, symbol: "Metrion",
  });
});

test("an ordinary token costs exactly ONE outgoing request", async () => {
  const { net } = await facts({});
  assert.equal(net.count(RPC_URL), 1);
  assert.equal(net.calls[0].body.length, 6, "six questions in the one batch");
});

test("the well-known selectors are the ones we scan for (checked against literal values)", () => {
  assert.equal(scanPowers("0x00" + "63" + "40c10f19").hasMint, true); // mint(address,uint256)
  assert.equal(scanPowers("0x00" + "63" + "8456cb59").hasPause, true); // pause()
  assert.equal(scanPowers("0x00" + "63" + "3659cfe6").hasUpgrade, true); // upgradeTo(address)
  assert.deepEqual(scanPowers(PLAIN_CODE), { hasMint: false, hasPause: false, hasBlacklist: false, hasUpgrade: false });
});

test("each power is found on its own, and only that one", () => {
  assert.deepEqual(scanPowers(codeWith(MINT)), { hasMint: true, hasPause: false, hasBlacklist: false, hasUpgrade: false });
  assert.deepEqual(scanPowers(codeWith(PAUSE)), { hasMint: false, hasPause: true, hasBlacklist: false, hasUpgrade: false });
  assert.deepEqual(scanPowers(codeWith(UPGRADE)), { hasMint: false, hasPause: false, hasBlacklist: false, hasUpgrade: true });
  assert.deepEqual(scanPowers(codeWith(MINT, PAUSE, UPGRADE)), { hasMint: true, hasPause: true, hasBlacklist: false, hasUpgrade: true });
});

test("a selector that only lines up across a byte boundary is not counted", () => {
  const aligned = "0x00" + "63" + MINT;
  const shifted = "0x0" + "63" + MINT; // the same digits, one nibble off, so they are not a PUSH4
  assert.equal(scanPowers(aligned).hasMint, true);
  assert.equal(scanPowers(shifted).hasMint, false);
  assert.equal(scanPowers("0x00" + MINT).hasMint, false, "the selector without PUSH4 in front is data, not a function");
  assert.equal(scanPowers(codeWith(MINT).toUpperCase().replace("0X", "0x")).hasMint, true, "upper-case hex is read the same");
});

test("a mintable token with a live owner: the dangerous combination is flagged", async () => {
  const { f } = await facts({ specs: { [TOKEN]: { code: codeWith(MINT), owner: OWNER } } });
  assert.equal(f.hasMint, true);
  assert.equal(f.hasOwnerFunction, true);
  assert.equal(f.owner, OWNER);
  assert.equal(f.ownerRenounced, false);
  assert.equal(f.mintWithLiveOwner, true);
});

test("a mintable token whose owner gave up the keys is NOT flagged", async () => {
  const { f } = await facts({ specs: { [TOKEN]: { code: codeWith(MINT), owner: "zero" } } });
  assert.equal(f.hasMint, true);
  assert.equal(f.ownerRenounced, true);
  assert.equal(f.mintWithLiveOwner, false);
});

test("a mint function with no owner() to ask: who can mint is UNKNOWN, not false", async () => {
  const { f } = await facts({ specs: { [TOKEN]: { code: codeWith(MINT), owner: "revert" } } });
  assert.equal(f.hasMint, true);
  assert.equal(f.hasOwnerFunction, false);
  assert.equal(f.ownerRenounced, null);
  assert.equal(f.mintWithLiveOwner, null, "role-based or open minting cannot be read, so it must not look safe");
});

test("pause, blacklist and upgrade powers are read from the code", async () => {
  const { f } = await facts({ specs: { [TOKEN]: { code: codeWith(PAUSE, BLACKLIST, UPGRADE) } } });
  assert.equal(f.hasPause, true);
  assert.equal(f.hasBlacklist, true);
  assert.equal(f.hasUpgrade, true);
  assert.equal(f.hasMint, false);
});

test("an EIP-1967 proxy: the powers come from the implementation, which costs a second request", async () => {
  const { f, net } = await facts({ specs: { [TOKEN]: { code: "0x60806040", slot: addressWord(IMPL) } }, impls: { [IMPL]: codeWith(MINT, UPGRADE) } });
  assert.equal(f.isProxy, true);
  assert.equal(f.implementation, IMPL);
  assert.equal(f.hasMint, true, "the proxy's own code has no powers; the implementation does");
  assert.equal(f.hasUpgrade, true);
  assert.equal(net.count(RPC_URL), 2);
});

const CLONES: [string, string][] = [
  ["EIP-1167 (45 bytes)", "0x363d3d373d3d3d363d73" + IMPL.slice(2) + "5af43d82803e903d91602b57fd5bf3"],
  ["PUSH0 variant (44 bytes)", "0x365f5f375f5f365f73" + IMPL.slice(2) + "5af43d5f5f3e6029573d5ffd5b3d5ff3"],
  ["the variant found live on Robinhood Chain (44 bytes)", "0x3d3d3d3d363d3d37363d73" + IMPL.slice(2) + "5af43d3d93803e602a57fd5bf3"],
];

for (const [name, code] of CLONES) {
  test(`a minimal clone is recognised by its shape: ${name}`, async () => {
    const { f } = await facts({ specs: { [TOKEN]: { code } }, impls: { [IMPL]: codeWith(PAUSE) } });
    assert.equal(f.isProxy, true);
    assert.equal(f.implementation, IMPL);
    assert.equal(f.hasPause, true, "the powers come from the implementation");
    assert.equal(f.hasMint, false);
  });
}

test("REAL: the two 44-byte tokens that the first scanner wrongly called 'not a proxy, no powers'", async () => {
  const real = "0x3d3d3d3d363d3d37363d733be8b97fd0e713b5abe0649fa830223b6b4bc5995af43d3d93803e602a57fd5bf3";
  const impl = "0x3be8b97fd0e713b5abe0649fa830223b6b4bc599";
  const { f } = await facts({ specs: { [TOKEN]: { code: real } }, impls: { [impl]: codeWith(MINT) } });
  assert.equal(f.isProxy, true);
  assert.equal(f.implementation, impl);
  assert.equal(f.hasMint, true);
});

test("only SHORT code is read as a clone: a big contract that happens to delegatecall is not", async () => {
  const big = "0x6080604052" + "63a9059cbb" + "73" + IMPL.slice(2) + "5af4" + "00".repeat(200);
  const { f } = await facts({ specs: { [TOKEN]: { code: big } } });
  assert.equal(f.isProxy, false);
  assert.equal(f.implementation, null);
});

test("a tiny contract that pushes an address and makes a plain CALL (not DELEGATECALL) is not a clone", async () => {
  const { f } = await facts({ specs: { [TOKEN]: { code: "0x73" + IMPL.slice(2) + "5af100" } } });
  assert.equal(f.isProxy, false);
  assert.equal(f.hasMint, null, "and with no token functions in it, its powers are unknown");
});

test("clone bytes that only line up across a byte boundary are not a clone", async () => {
  const shifted = "0x3" + "73" + IMPL.slice(2) + "5af4" + "00";
  const { f } = await facts({ specs: { [TOKEN]: { code: shifted } } });
  assert.equal(f.isProxy, false);
});

test("code we do not understand has UNKNOWN powers, not 'none': no transfer() or balanceOf() to recognise", async () => {
  const { f } = await facts({ specs: { [TOKEN]: { code: "0x600060005500" } } });
  assert.equal(f.isContract, true);
  assert.deepEqual([f.hasMint, f.hasPause, f.hasBlacklist, f.hasUpgrade, f.mintWithLiveOwner], [null, null, null, null, null]);
  assert.equal(looksLikeToken("0x600060005500"), false);
  assert.equal(looksLikeToken("0x00" + "63" + "a9059cbb"), true, "transfer() is enough");
  assert.equal(looksLikeToken("0x00" + "63" + "70a08231"), true, "so is balanceOf()");
});

test("the same gate applies to what a proxy points at", async () => {
  const clone = "0x363d3d373d3d3d363d73" + IMPL.slice(2) + "5af43d82803e903d91602b57fd5bf3";
  const { f } = await facts({ specs: { [TOKEN]: { code: clone } }, impls: { [IMPL]: "0x600060005500" } });
  assert.equal(f.isProxy, true);
  assert.equal(f.hasMint, null, "an implementation we cannot make sense of is unknown, not clean");
});

test("every fact set says which scanner version read it", async () => {
  assert.equal(SCANNER_VERSION, 2);
  assert.equal((await facts({})).f.scannerVersion, SCANNER_VERSION);
  assert.equal((await facts({ specs: { [TOKEN]: { code: "0x" } } })).f.scannerVersion, SCANNER_VERSION, "even for an empty account");
});

test("a proxy whose implementation cannot be read: the powers are UNKNOWN (null), never 'none'", async () => {
  for (const code of [null, "0x"]) {
    const { f } = await facts({ specs: { [TOKEN]: { code: "0x60806040", slot: addressWord(IMPL) } }, impls: { [IMPL]: code } });
    assert.equal(f.isProxy, true);
    assert.deepEqual([f.hasMint, f.hasPause, f.hasBlacklist, f.hasUpgrade, f.mintWithLiveOwner], [null, null, null, null, null], String(code));
  }
});

test("a storage slot that is not a clean address is ignored, not trusted", async () => {
  const { f } = await facts({ specs: { [TOKEN]: { slot: "0x" + "ff".repeat(32) } } });
  assert.equal(f.isProxy, false);
  assert.equal(f.implementation, null);
});

test("an ordinary account (no code) is not a token contract, and nothing else is claimed", async () => {
  const { f, net } = await facts({ specs: { [TOKEN]: { code: "0x" } } });
  assert.equal(f.isContract, false);
  assert.equal(f.codeSize, 0);
  for (const k of ["isProxy", "hasMint", "hasPause", "hasBlacklist", "hasUpgrade", "hasOwnerFunction", "owner", "ownerRenounced", "mintWithLiveOwner", "totalSupply", "decimals", "symbol"] as const) {
    assert.equal(f[k], null, k);
  }
  assert.equal(net.count(RPC_URL), 1);
});

test("if the code cannot be read, that is a failure to retry, not a fact", async () => {
  await assert.rejects(facts({ specs: { [TOKEN]: { codeFails: true } } }), (e: any) => e instanceof HttpError && /could not read the token's code/.test(e.message));
});

test("supply, decimals and symbol are read and checked", async () => {
  const { f } = await facts({ specs: { [TOKEN]: { supply: 123456789012345678901234567890n, decimals: 6n, symbol: "WIENER" } } });
  assert.equal(f.totalSupply, "123456789012345678901234567890");
  assert.equal(f.decimals, 6);
  assert.equal(f.symbol, "WIENER");
  assert.equal((await facts({ specs: { [TOKEN]: { decimals: 256n } } })).f.decimals, null, "decimals above 255 are not believed");
});

test("an old token that returns its symbol as bytes32 is still read", async () => {
  assert.equal((await facts({ specs: { [TOKEN]: { symbol: "bytes32:MKR" } } })).f.symbol, "MKR");
});

test("a strange owner() reply is unknown, not an owner", async () => {
  const { f } = await facts({ specs: { [TOKEN]: { owner: "garbage" } } });
  assert.equal(f.hasOwnerFunction, null);
  assert.equal(f.owner, null);
  assert.equal(f.ownerRenounced, null);
});

test("a node that lies by omission or does not do batches fails loudly", async () => {
  await assert.rejects(facts({ rpc: "omit-last" }), (e: any) => e instanceof HttpError && /left out answer/.test(e.message));
  await assert.rejects(facts({ rpc: "not-a-list" }), (e: any) => e instanceof HttpError && /did not answer the batch with a list/.test(e.message));
});

test("batch size is bounded", async () => {
  const { rpc } = setup({});
  await assert.rejects(rpc.batch([]), RangeError);
  await assert.rejects(rpc.batch(Array.from({ length: 11 }, () => ({ method: "eth_chainId", params: [] }))), RangeError);
  assert.equal(word(1n).length, 66);
});
