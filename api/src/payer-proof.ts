// Proof that the caller owns `payer`. A payer's history (daily cap, duplicates, rate, new recipient) is only read and
// written when the request carries the payer's own signature over this exact payment, made in the last few minutes.
// Without it anyone could name someone else's address, fill their history, and make a later payment to themselves
// look like a "known recipient" or use up the victim's daily cap.
//
// The signature is a plain personal_sign (EIP-191) of payerMessage(): any wallet or viem's signMessage can make it.
// ponytail: EOA wallets only (ecrecover). Smart-contract wallets (ERC-1271) need an RPC call; add when one asks.
import { verifyMessage, type Hex } from "viem";
import type { PaymentRequest } from "../../engine/policy.ts";
import { ApiError } from "./api-error.ts";

export const PROOF_WINDOW_S = 300; // issuedAt may be at most 5 minutes off the server clock, either way

type Signed = Pick<PaymentRequest, "network" | "asset" | "amount" | "payTo" | "resourceUrl">;

// The exact text the payer signs. Addresses lowercase, one field per line, no trailing newline.
export const payerMessage = (payer: string, r: Signed, issuedAt: number): string =>
  [
    "Reinkeep gate request",
    `payer: ${payer.toLowerCase()}`,
    `network: ${r.network}`,
    `asset: ${r.asset.toLowerCase()}`,
    `amount: ${r.amount}`,
    `payTo: ${r.payTo.toLowerCase()}`,
    `resource: ${r.resourceUrl}`,
    `issuedAt: ${issuedAt}`,
  ].join("\n");

export async function checkPayerProof(input: { payer: string; payerSignature?: string; issuedAt?: number; request: Signed }, nowMs: number): Promise<void> {
  if (!input.payerSignature || input.issuedAt === undefined) {
    throw new ApiError(400, "payer_signature_required", "A payer needs payerSignature and issuedAt (see the docs: sign the request with that wallet), or leave payer out.");
  }
  if (Math.abs(Math.floor(nowMs / 1000) - input.issuedAt) > PROOF_WINDOW_S) {
    throw new ApiError(401, "payer_signature_expired", `issuedAt must be within ${PROOF_WINDOW_S} seconds of now. Sign again with the current time.`);
  }
  let ok = false;
  try {
    ok = await verifyMessage({ address: input.payer as Hex, message: payerMessage(input.payer, input.request, input.issuedAt), signature: input.payerSignature as Hex });
  } catch {
    ok = false;
  }
  if (!ok) throw new ApiError(401, "payer_signature_invalid", "payerSignature was not made by payer for this request.");
}
