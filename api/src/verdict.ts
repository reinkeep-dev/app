// The free token check: GET /api/v1/verdict/{address}. Reads the token's facts the same way the gate does and runs the
// token rules only (engine evaluateToken, the same code evaluate() runs for "what it buys"). No payment is judged and
// nothing is signed, so there is no receipt.
import { defaultPolicy, evaluateToken } from "../../engine/policy.ts";
import { ApiError } from "./api-error.ts";
import { explain, explainSafely, readFacts, type GateDeps, type Reason } from "./gate-service.ts";
import type { Explanation } from "./explain.ts";
import type { Decision } from "./receipt-signing.ts";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export type Verdict = {
  token: string;
  decision: Decision;
  reasons: Reason[];
  facts: unknown | null; // the fact sheet the rules read; null when we have no data on the token
  explanation: Explanation;
  checkedAt: string;
};

export async function verdict(address: string, deps: Pick<GateDeps, "now" | "tokenFacts" | "explain">): Promise<Verdict> {
  if (!ADDRESS.test(address)) throw new ApiError(400, "invalid_address", "The token must be a 0x address with 40 hex characters.");
  const token = address.toLowerCase();
  const buying = await readFacts(token, deps);
  const { deny, approve } = evaluateToken(buying, defaultPolicy.token);
  const decision: Decision = deny.length ? "BLOCK" : approve.length ? "REVIEW" : "ALLOW";
  const reasons = (deny.length ? deny : approve).map(explain);
  const explanation = await explainSafely({ decision, reasons, token: buying, kind: "token_check" }, deps);
  return { token, decision, reasons, facts: buying.facts, explanation, checkedAt: new Date(deps.now()).toISOString() };
}
