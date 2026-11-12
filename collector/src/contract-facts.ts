// Facts about a token contract, read straight from the chain's JSON-RPC node (Blockscout's API is behind a bot
// check, so it is not an option). One token costs ONE outgoing request: the questions go in a single batch.
//
// What is and is not known (be careful with the claims built on this):
//  - Powers (mint, pause, blacklist, upgrade) come from scanning the bytecode for the 4-byte function selectors of
//    the COMMON names. A token whose mint function has an unusual name is not seen. "hasMint: false" means
//    "none of the common mint functions are in the code", not "cannot be minted".
//  - A proxy's own code is nearly empty, so for proxies the implementation's code is scanned instead.
//  - Who holds a power is only known when the token exposes owner(). Role-based control is not read.
//  - Anything we could not tell is null, never a guess.
import { decodeAbiParameters, hexToString, toFunctionSelector } from "viem";
import { requestJson, HttpError, type Fetcher, type Sleep } from "./http-json.ts";
import type { ContractFacts } from "./types.ts";

export type RpcCall = { method: string; params: unknown[] };
export type RpcResult = { ok: true; value: unknown } | { ok: false; code: number; message: string };
export type RpcClient = { batch(calls: RpcCall[]): Promise<RpcResult[]> };

const MAX_BATCH = 10;

export function createRpcClient(o: { url: string; fetch: Fetcher; sleep: Sleep }): RpcClient {
  return {
    async batch(calls) {
      if (calls.length < 1 || calls.length > MAX_BATCH) throw new RangeError(`a batch holds 1 to ${MAX_BATCH} calls`);
      const body = JSON.stringify(calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, method: c.method, params: c.params })));
      const json = await requestJson(o.url, { method: "POST", headers: { "content-type": "application/json" }, body }, { fetch: o.fetch, sleep: o.sleep });
      if (!Array.isArray(json)) throw new HttpError(200, "the RPC node did not answer the batch with a list");
      const byId = new Map<number, any>();
      for (const item of json) if (item && typeof item === "object" && typeof item.id === "number") byId.set(item.id, item);
      return calls.map((_, i) => {
        const item = byId.get(i + 1);
        if (!item) throw new HttpError(200, `the RPC node left out answer ${i + 1} of ${calls.length}`);
        if (item.error) return { ok: false as const, code: Number(item.error.code), message: String(item.error.message ?? "") };
        return { ok: true as const, value: item.result };
      });
    },
  };
}

const sel = (signature: string) => toFunctionSelector(signature).slice(2).toLowerCase();
const SELECTORS = {
  mint: ["mint(address,uint256)", "mint(uint256)", "mint(address)", "mintTo(address,uint256)"].map(sel),
  pause: ["pause()", "pause(bool)", "setPaused(bool)"].map(sel),
  blacklist: ["blacklist(address)", "addToBlacklist(address)", "setBlacklist(address,bool)", "blacklistAddress(address)", "addBlackList(address)", "blockAddress(address)"].map(sel),
  upgrade: ["upgradeTo(address)", "upgradeToAndCall(address,bytes)"].map(sel),
};
const OWNER = "0x8da5cb5b";
const TOTAL_SUPPLY = "0x18160ddd";
const DECIMALS = "0x313ce567";
const SYMBOL = "0x95d89b41";
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"; // EIP-1967
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Bump this whenever the scanner learns something, then re-queue the older facts (store.requeueOutdated), so a
// token read by an older, blinder scanner is read again instead of keeping its old answer.
//   1: first version. Missed clones written differently from the one exact EIP-1167 byte string.
//   2: clones recognised by shape; a contract with no ERC-20 core is "unknown", not "no powers".
export const SCANNER_VERSION = 2;

// A clone is a tiny contract that pushes an implementation address and then runs GAS, DELEGATECALL (bytes 5a f4): it
// forwards everything to that address. EIP-1167 and its newer variants all have this shape, so we match the shape,
// not one exact byte string. Real contracts are far longer, so anything bigger is never read as a clone.
const MAX_CLONE_BYTES = 64;
function cloneTarget(codeHex: string): string | null {
  if ((codeHex.length - 2) / 2 > MAX_CLONE_BYTES) return null;
  for (let at = codeHex.indexOf("73", 2); at !== -1; at = codeHex.indexOf("73", at + 1)) {
    if (at % 2 !== 0) continue; // whole bytes only
    const target = codeHex.slice(at + 2, at + 42);
    if (codeHex.slice(at + 42, at + 46) === "5af4" && /^[0-9a-f]{40}$/.test(target)) return "0x" + target;
  }
  return null;
}

// A solidity/vyper dispatcher compares against PUSH4 <selector>. Match only on a whole-byte boundary.
function hasSelector(codeHex: string, selector: string): boolean {
  const needle = "63" + selector;
  for (let at = codeHex.indexOf(needle, 2); at !== -1; at = codeHex.indexOf(needle, at + 1)) if (at % 2 === 0) return true;
  return false;
}

// Does this code look like a token at all? Every ERC-20 answers transfer() or balanceOf(). If neither is there we
// are looking at something we do not understand, and "no powers found" would be a false comfort.
const ERC20_CORE = [sel("transfer(address,uint256)"), sel("balanceOf(address)")];
export function looksLikeToken(codeHex: string): boolean {
  const code = codeHex.toLowerCase();
  return ERC20_CORE.some((s) => hasSelector(code, s));
}

export function scanPowers(codeHex: string): { hasMint: boolean; hasPause: boolean; hasBlacklist: boolean; hasUpgrade: boolean } {
  const code = codeHex.toLowerCase();
  const any = (list: string[]) => list.some((s) => hasSelector(code, s));
  return { hasMint: any(SELECTORS.mint), hasPause: any(SELECTORS.pause), hasBlacklist: any(SELECTORS.blacklist), hasUpgrade: any(SELECTORS.upgrade) };
}

const isWord = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);

function wordToAddress(word: string): string | null {
  return /^0x0{24}[0-9a-fA-F]{40}$/.test(word) ? "0x" + word.slice(26).toLowerCase() : null;
}

// Also used by chain-launches.ts to read a new token's symbol() the same way.
export function decodeText(hex: unknown): string | null {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) return null;
  let text: string | null = null;
  try {
    text = decodeAbiParameters([{ type: "string" }], hex as `0x${string}`)[0] as string;
  } catch {
    if (hex.length === 66) text = hexToString(hex as `0x${string}`); // older tokens return a bytes32
  }
  const clean = (text ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64);
  return clean || null;
}

export async function readContractFacts(rpc: RpcClient, token: string, nowMs: number): Promise<ContractFacts> {
  const [code, slot, owner, supply, decimals, symbol] = await rpc.batch([
    { method: "eth_getCode", params: [token, "latest"] },
    { method: "eth_getStorageAt", params: [token, IMPLEMENTATION_SLOT, "latest"] },
    { method: "eth_call", params: [{ to: token, data: OWNER }, "latest"] },
    { method: "eth_call", params: [{ to: token, data: TOTAL_SUPPLY }, "latest"] },
    { method: "eth_call", params: [{ to: token, data: DECIMALS }, "latest"] },
    { method: "eth_call", params: [{ to: token, data: SYMBOL }, "latest"] },
  ]);
  // Without the code we can say nothing, so this is a failure to retry later, not a fact.
  if (!code.ok || typeof code.value !== "string" || !/^0x[0-9a-fA-F]*$/.test(code.value)) throw new HttpError(200, "could not read the token's code");
  const bytecode = code.value.toLowerCase();
  const codeSize = (bytecode.length - 2) / 2;

  const unknown: ContractFacts = {
    token, readAtMs: nowMs, scannerVersion: SCANNER_VERSION, isContract: codeSize > 0, codeSize, isProxy: null, implementation: null,
    hasMint: null, hasPause: null, hasBlacklist: null, hasUpgrade: null, hasOwnerFunction: null, owner: null,
    ownerRenounced: null, mintWithLiveOwner: null, totalSupply: null, decimals: null, symbol: null,
  };
  if (codeSize === 0) return unknown; // an ordinary account, not a token contract

  // Is it a proxy, and where does the real code live?
  let implementation: string | null = null;
  const cloned = cloneTarget(bytecode);
  if (cloned) implementation = cloned;
  else if (slot.ok && isWord(slot.value)) {
    const fromSlot = wordToAddress(slot.value);
    if (fromSlot && fromSlot !== ZERO_ADDRESS) implementation = fromSlot;
  }

  let powers: ReturnType<typeof scanPowers> | null = null;
  const judge = (code: string) => (looksLikeToken(code) ? scanPowers(code) : null);
  if (!implementation) powers = judge(bytecode);
  else {
    const [implCode] = await rpc.batch([{ method: "eth_getCode", params: [implementation, "latest"] }]);
    if (implCode.ok && typeof implCode.value === "string" && /^0x[0-9a-fA-F]{2,}$/.test(implCode.value)) powers = judge(implCode.value);
  }

  let hasOwnerFunction: boolean | null = null;
  let ownerAddress: string | null = null;
  if (!owner.ok || owner.value === "0x") hasOwnerFunction = false;
  else if (isWord(owner.value)) {
    ownerAddress = wordToAddress(owner.value);
    hasOwnerFunction = ownerAddress !== null ? true : null;
  }
  const ownerRenounced = ownerAddress === null ? null : ownerAddress === ZERO_ADDRESS;

  // Who can mint? Only answerable when mint exists AND the token tells us its owner.
  let mintWithLiveOwner: boolean | null = null;
  if (powers) {
    if (!powers.hasMint) mintWithLiveOwner = false;
    else if (ownerRenounced === true) mintWithLiveOwner = false;
    else if (ownerRenounced === false) mintWithLiveOwner = true;
  }

  return {
    ...unknown,
    isProxy: implementation !== null,
    implementation,
    hasMint: powers?.hasMint ?? null,
    hasPause: powers?.hasPause ?? null,
    hasBlacklist: powers?.hasBlacklist ?? null,
    hasUpgrade: powers?.hasUpgrade ?? null,
    hasOwnerFunction,
    owner: ownerAddress,
    ownerRenounced,
    mintWithLiveOwner,
    totalSupply: supply.ok && isWord(supply.value) ? BigInt(supply.value).toString() : null,
    decimals: decimals.ok && isWord(decimals.value) && BigInt(decimals.value) <= 255n ? Number(BigInt(decimals.value)) : null,
    symbol: symbol.ok ? decodeText(symbol.value) : null,
  };
}
