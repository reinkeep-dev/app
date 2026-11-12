// Signed receipts. A receipt says: "this request, under this policy, got this answer", signed with EIP-712
// so anyone can check it with the public signer address alone. It carries everything needed to re-check it:
// the full resolved policy and the signed body, so a verifier recomputes both hashes themselves.
//
//   Receipt(string id, string decision, bytes32 policyHash, bytes32 bodyHash, uint64 issuedAt)
//   policyHash = keccak256(canonical JSON of the policy)   bodyHash = keccak256(canonical JSON of the body)
import { keccak256, recoverTypedDataAddress, stringToHex, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import type { PaymentRequest, Policy, TokenFactSheet } from "../../engine/policy.ts";
import { canonicalJson } from "./canonical-json.ts";

export const RECEIPT_DOMAIN = { name: "Reinkeep", version: "1", chainId: 4663 } as const;
export const RECEIPT_TYPES = {
  Receipt: [
    { name: "id", type: "string" },
    { name: "decision", type: "string" },
    { name: "policyHash", type: "bytes32" },
    { name: "bodyHash", type: "bytes32" },
    { name: "issuedAt", type: "uint64" },
  ],
} as const;

export type Decision = "ALLOW" | "REVIEW" | "BLOCK";
// v2 (2026-11-11): the token rules ("what it buys") joined the spend rules ("how it pays").
export const ENGINE = "rules-v2";

export type ReceiptBody = {
  engine: string;
  policyName: string;
  request: Omit<PaymentRequest, "now">;
  reasons: string[];
  // true when the answer used this payer's saved history (daily cap, duplicates, new recipient).
  stateful: boolean;
  // Present only when the request named a token being bought: the token and the exact fact sheet the rules read
  // (null when we had none), so the receipt proves what the answer was based on.
  buying?: { token: string; facts: TokenFactSheet | null };
  // Present only when the caller asked for the AI Judge on a REVIEW and it answered (judge.ts). Advisory: `decision`
  // above is still the rules' answer.
  judgement?: { lean: Decision; confidence: number; cites: string[]; note: string | null; model: string; advisory: true };
};

export type Receipt = {
  id: string;
  decision: Decision;
  policyHash: Hex;
  bodyHash: Hex;
  issuedAt: number; // unix seconds
  signer: Address;
  signature: Hex;
  body: ReceiptBody;
  policy: Policy;
};

export type Verification = { valid: true; signer: Address } | { valid: false; reason: string };

const hashJson = (v: unknown): Hex => keccak256(stringToHex(canonicalJson(v)));
export const receiptId = (bodyHash: Hex): string => "rk_" + bodyHash.slice(2, 18);
const DECISIONS = ["ALLOW", "REVIEW", "BLOCK"];
const HEX32 = /^0x[0-9a-fA-F]{64}$/;

export async function signReceipt(account: PrivateKeyAccount, input: { decision: Decision; body: ReceiptBody; policy: Policy; issuedAt: number }): Promise<Receipt> {
  const policyHash = hashJson(input.policy);
  const bodyHash = hashJson(input.body);
  const id = receiptId(bodyHash);
  const signature = await account.signTypedData({
    domain: RECEIPT_DOMAIN,
    types: RECEIPT_TYPES,
    primaryType: "Receipt",
    message: { id, decision: input.decision, policyHash, bodyHash, issuedAt: BigInt(input.issuedAt) },
  });
  return { id, decision: input.decision, policyHash, bodyHash, issuedAt: input.issuedAt, signer: account.address, signature, body: input.body, policy: input.policy };
}

// Re-checks a receipt from scratch. Returns a reason, never throws on bad input, because the input is untrusted.
export async function verifyReceipt(receipt: unknown, ourSigner: Address): Promise<Verification> {
  const fail = (reason: string): Verification => ({ valid: false, reason });
  if (typeof receipt !== "object" || receipt === null || Array.isArray(receipt)) return fail("malformed");
  const r = receipt as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.decision !== "string" || !DECISIONS.includes(r.decision) ||
    typeof r.policyHash !== "string" || !HEX32.test(r.policyHash) ||
    typeof r.bodyHash !== "string" || !HEX32.test(r.bodyHash) ||
    typeof r.issuedAt !== "number" || !Number.isSafeInteger(r.issuedAt) || r.issuedAt < 0 ||
    typeof r.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(r.signature) ||
    typeof r.signer !== "string" ||
    typeof r.body !== "object" || r.body === null ||
    typeof r.policy !== "object" || r.policy === null
  ) {
    return fail("malformed");
  }

  let bodyHash: Hex, policyHash: Hex;
  try {
    bodyHash = hashJson(r.body);
    policyHash = hashJson(r.policy);
  } catch {
    return fail("malformed");
  }
  if (bodyHash.toLowerCase() !== r.bodyHash.toLowerCase()) return fail("body_hash_mismatch");
  if (policyHash.toLowerCase() !== r.policyHash.toLowerCase()) return fail("policy_hash_mismatch");
  if (r.id !== receiptId(bodyHash)) return fail("id_mismatch");

  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({
      domain: RECEIPT_DOMAIN,
      types: RECEIPT_TYPES,
      primaryType: "Receipt",
      message: { id: r.id, decision: r.decision, policyHash: r.policyHash as Hex, bodyHash: r.bodyHash as Hex, issuedAt: BigInt(r.issuedAt) },
      signature: r.signature as Hex,
    });
  } catch {
    return fail("bad_signature");
  }
  if (recovered.toLowerCase() !== r.signer.toLowerCase()) return fail("signer_mismatch");
  if (recovered.toLowerCase() !== ourSigner.toLowerCase()) return fail("not_our_signature");
  return { valid: true, signer: recovered };
}
