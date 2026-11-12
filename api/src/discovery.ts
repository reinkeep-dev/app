// Agent-discovery documents for the gate API: llms.txt, an A2A agent card, an OpenAPI 3.1 file and an x402 listing.
// Everything numeric or named comes from the real modules (x402.ts, request-validation.ts, receipt-signing.ts,
// rules.json) so the documents cannot drift from the code. `discovery()` answers GET and HEAD, anything else is null.
import rules from "../../site/data/rules.json" with { type: "json" };
import { MAX_BATCH_TOKENS, PRESETS } from "./request-validation.ts";
import { RECEIPT_DOMAIN, RECEIPT_TYPES } from "./receipt-signing.ts";
import { CHECK_EVERY_MS, MANDATE_CALLS, MANDATE_DAYS, SIGNAL_VALID_S } from "./mandate-service.ts";
import { MIN_SAMPLE } from "./premortem.ts";
import { BOARD_MAX_DAYS, RADAR_MAX_HOURS } from "./launch-data.ts";
import { DATA_CALLS_PER_DAY, DEFAULT_FACILITATOR, FREE_CALLS_PER_DAY, NETWORK, PREMORTEM_CALLS_PER_DAY, PRICE_AMOUNT, PRICE_USD, USDG, VERDICT_CALLS_PER_DAY, X402_VERSION, requirementsFor } from "./x402.ts";

export const BASE_URL = "https://api.reinkeep.xyz"; // the old https://reinkeep-gate.reinkeep.workers.dev still answers
export const MCP_URL = BASE_URL + "/mcp";
export const API = "/api/v1";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const VERSION = "0.1.0";
const DESCRIPTION =
  "Pre-payment and pre-trade gate for AI agents on Robinhood Chain (chain 4663, USDG). Send the payment request, get ALLOW, REVIEW or BLOCK, the rules that decided it, and a receipt signed with EIP-712. Reviewed by our team, no outside audit yet.";

type Endpoint = { method: "GET" | "POST" | "DELETE"; path: string; summary: string };
// Every REST endpoint, path relative to /api/v1. The OpenAPI file and llms.txt are both built from this.
export const ENDPOINTS: Endpoint[] = [
  { method: "POST", path: "/gate", summary: "Check one payment (and optionally the token it buys). Free tier, then x402." },
  { method: "POST", path: "/gate/x402", summary: "Same as POST /gate but always paid: 402 until a PAYMENT-SIGNATURE header is sent." },
  { method: "POST", path: "/gate/batch", summary: `Check one payment against up to ${MAX_BATCH_TOKENS} tokens: one gate answer and one signed receipt per token. Costs one call per token.` },
  { method: "GET", path: "/gate/pricing", summary: "Price, free calls per day, asset, network, payTo and facilitator." },
  { method: "GET", path: "/gate/presets", summary: "Built-in policies." },
  { method: "POST", path: "/receipts/verify", summary: "Re-check a receipt this server signed." },
  { method: "GET", path: "/receipts/signer", summary: "Signer address, EIP-712 domain and types." },
  { method: "GET", path: "/receipts/{id}", summary: "A stored receipt by id, with a fresh signature check: { receipt, valid, signer }." },
  { method: "GET", path: "/verdict/{address}", summary: `Free token check: ALLOW, REVIEW or BLOCK from the token rules only. ${VERDICT_CALLS_PER_DAY} per caller IP per UTC day, no payment, no receipt.` },
  { method: "POST", path: "/mandates", summary: `Watch a held token for ${MANDATE_DAYS} days: its contract is re-read every ${CHECK_EVERY_MS / 60_000} minutes, with signed exit/watch/hold signals. Costs ${MANDATE_CALLS} calls.` },
  { method: "GET", path: "/mandates/{id}", summary: "A mandate's state, expiry, number of checks and latest signed signal." },
  { method: "GET", path: "/mandates/{id}/events", summary: "Every check, change, failed read and renewal, oldest first, paged by seq." },
  { method: "POST", path: "/mandates/{id}/renew", summary: `Add ${MANDATE_DAYS} days (restarts an expired watch). Costs ${MANDATE_CALLS} calls.` },
  { method: "POST", path: "/mandates/{id}/test", summary: "Send the last signal to the webhook as a test event." },
  { method: "DELETE", path: "/mandates/{id}", summary: "Stop watching." },
  { method: "POST", path: "/signals/verify", summary: "Re-check a mandate signal: { valid, expired } or { valid: false, reason }." },
  { method: "POST", path: "/premortem", summary: `For builders: a launch draft in; the gate's answer for it, launch risks with fixes, ticker reuse and how similar launches did after a day out. Free, ${PREMORTEM_CALLS_PER_DAY} per caller IP per UTC day, not stored.` },
  { method: "GET", path: "/odds", summary: `Of the tokens that started like this (first liquidity, first swaps), how many still traded a day later. A share only from ${MIN_SAMPLE} judged pools.` },
  { method: "GET", path: "/board", summary: `Per UTC day (?days=1..${BOARD_MAX_DAYS}): pools seen, re-checked after a day, alive, dead, share still trading.` },
  { method: "GET", path: "/radar", summary: `Tickers reused by 2 or more tokens in the last ?hours=1..${RADAR_MAX_HOURS}, with the earliest and the busiest token.` },
  { method: "GET", path: "/autopsy/{address}", summary: "What happened to one token a day after launch: still trading, liquidity pulled, faded or never lived." },
];
const summaryOf = (path: string) => ENDPOINTS.find((e) => e.path === path)?.summary ?? "";

const PRESET_NAMES = Object.keys(PRESETS);
const ruleLines = (side: string) =>
  rules.filter((r) => r.side === side).map((r) => `- \`${r.code}\` (${r.kind === "deny" ? "BLOCK" : "REVIEW"}): ${r.plain}`).join("\n");

export function llmsTxt(): string {
  const endpoints = ENDPOINTS.map((e) => `- ${e.method} ${API}${e.path}: ${e.summary}`).join("\n");
  return `# Reinkeep AI

> Pre-payment and pre-trade gate for AI agents on Robinhood Chain (chain id 4663, USDG). Before an agent pays, it sends the payment request (and optionally the token it is buying). Reinkeep AI answers ALLOW, REVIEW or BLOCK, names the rules that decided it, and returns a receipt signed with EIP-712 that anyone can re-check. Rules decide. AI only explains the answer in plain words. Reviewed by our team, no outside audit yet. Do not use it with money you cannot lose.

## Connect
- REST API base: ${BASE_URL}${API} (CORS open, no API key)
- Remote MCP (POST): ${MCP_URL}
- OpenAPI 3.1: ${BASE_URL}${API}/openapi.json
- A2A agent card: ${BASE_URL}/.well-known/agent.json
- x402 listing: ${BASE_URL}/.well-known/x402

## Quick start
\`\`\`bash
curl -s ${BASE_URL}${API}/gate -H 'content-type: application/json' -d '{
  "request": {
    "network": "${NETWORK}",
    "asset": "${USDG}",
    "amount": "${PRICE_AMOUNT}",
    "decimals": 6,
    "payTo": "0x1111111111111111111111111111111111111111",
    "resourceUrl": "https://api.example.com/v1/data",
    "validForSeconds": 90
  }
}'
\`\`\`
The answer is \`{ id, decision, reasons[], receipt, explanation, shareUrl? }\`. \`decision\` is ALLOW, REVIEW or BLOCK. Each reason is \`{ code, plain }\`.
\`explanation\` is optional: \`{ text, source, model? }\`. \`text\` is two short plain-English sentences. \`source\` is \`ai\` when a small Cloudflare Workers AI model wrote it (\`model\` names it) or \`rules\` when the fixed rule text is used instead. The decision always comes from the rules, never from the model. If the model errors, times out, or adds numbers or advice, you get the rule text.
Act on ALLOW. Treat REVIEW as "ask a human or stop". Never pay on BLOCK.

## Endpoints (base ${API})
${endpoints}

## Free token check (no payment, no receipt)
GET ${API}/verdict/{address} reads the token's facts (the collector's data, else the contract live) and runs the token rules only. The answer is \`{ token, decision, reasons[], facts, explanation, checkedAt }\`; \`facts\` is null when we have no data on the token (that is a REVIEW). ${VERDICT_CALLS_PER_DAY} per caller IP per UTC day, then 429 \`verdict_limit\`. A bad address is a 400. Not signed: use POST ${API}/gate with \`token\` when you need a receipt.

## Batch (POST ${API}/gate/batch)
Body \`{ request, policy?, tokens: [address, ...] }\` with 1 to ${MAX_BATCH_TOKENS} tokens (\`payer\` is not accepted: a batch is stateless). The answer is \`{ results: [<gate answer per token, in order>] }\`, each with its own signed receipt. It costs one call per token: the free counter takes all of them or none, and past it the 402 asks for $${PRICE_USD.toFixed(2)} times the number of tokens (amount = ${PRICE_AMOUNT} x N base units).

## Mandates: keep watching a token you hold (POST ${API}/mandates)
Body \`{ token, webhookUrl? }\`. Reinkeep re-reads the token's contract from the chain every ${CHECK_EVERY_MS / 60_000} minutes for ${MANDATE_DAYS} days, runs the token rules, and compares with the previous read. Each check gives a SIGNAL: \`exit\` (a BLOCK rule fires, a power such as mint/pause/blacklist/upgrade appeared, or the owner, implementation or contract changed), \`watch\` (REVIEW, another change such as supply, or the chain could not be read) or \`hold\` (ALLOW and nothing changed). Reinkeep never trades for you; your agent decides.
- The answer is \`{ mandate, webhookSecret, event }\`. Keep \`mandate.id\`: it is the only key to the mandate. \`webhookSecret\` is shown once.
- A signal is \`Signal(string mandate, address token, string action, string decision, bytes32 factsHash, uint64 issuedAt, uint64 validUntil)\` signed with EIP-712 in the receipt domain, valid ${SIGNAL_VALID_S / 3600} hour. Check it with POST ${API}/signals/verify.
- Webhook: POST JSON \`{ type: "mandate.event", mandate, token, event }\` with header \`reinkeep-signature: t=<unix>,v1=<hex>\`, where v1 is HMAC-SHA256 of \`<t>.<raw body>\` with your webhookSecret. Sent on the first check, on any change, when the action changes and on a failed read; one try, 5 s. Missed pushes stay in GET ${API}/mandates/{id}/events.
- Costs ${MANDATE_CALLS} calls ($${(PRICE_USD * MANDATE_CALLS).toFixed(2)}): taken from the free calls first, then x402 for ${MANDATE_CALLS} x the price. Renew costs the same. Reading, events, test and delete are free.

## Pre-mortem: check a launch before it ships (POST ${API}/premortem)
Body \`{ name?, ticker, contract: { mint, ownerRenounced, pause, blacklist, upgradeable }, buyTaxPct, sellTaxPct, teamAllocationPct, liquidityUsd, liquidityLockDays }\` (booleans and numbers, all required except name). The answer:
- \`gate\`: the decision the Reinkeep gate will give agents buying this token, from the same token rules as POST ${API}/gate.
- \`risks[]\`: \`{ code, severity, basis, plain, fix }\`, high first. \`basis\` is \`gate rule\` or \`rule of thumb\` (taxes, team share, liquidity lock: our own thresholds, not fitted to data).
- \`ticker\`: whether an earlier token we saw uses the same ticker.
- \`cohort\`: tokens that started with similar liquidity and were re-checked after a day: \`n\`, \`alive\`, \`dead\`, and \`stillTradingPct\` only from ${MIN_SAMPLE} judged tokens (null below, with a note). A record of past tokens, not a prediction.
Free, ${PREMORTEM_CALLS_PER_DAY} per caller IP per UTC day (429 premortem_limit), nothing stored.

## Launch data (free, read-only, ${DATA_CALLS_PER_DAY} reads per caller IP per UTC day in total)
From our collector: every pool it saw, its numbers when first seen, and one re-check a day later. "Still trading" = at least $50 of volume or 3 swaps in the 24 hours before the re-check. Every answer carries \`coverage\` (pools and re-checks behind it): the collector does not see every launch, so read shares as a sample, and a share is shown only from ${MIN_SAMPLE} judged pools (null below).
- GET ${API}/odds: \`byFirstLiquidityUsd[]\` and \`byFirstSwaps[]\`, each band \`{ minUsd, maxUsd, n, alive, dead, stillTradingPct }\`.
- GET ${API}/board?days=7: one row per UTC day.
- GET ${API}/radar?hours=24: \`waves[]\` of \`{ ticker, recentTokens, totalTokens, first, busiest }\`. "first" is the earliest token we saw with the ticker, not proof of which one is real.
- GET ${API}/autopsy/{address}: \`{ pattern, plain, firstSeen, dayLater }\`; pattern is still_trading, liquidity_pulled, faded, never_lived, too_young, not_rechecked or unknown. 404 token_not_collected when we never saw a pool for it.

## Stored receipts and share pages
Every signed gate answer is also stored (best effort) and carries \`shareUrl\` when storage is on: ${BASE_URL}/r/{id}, a plain page a person can open (decision, reasons, the payment checked, signature check). GET ${API}/receipts/{id} returns the stored receipt as JSON with \`valid\` and \`signer\` from a fresh signature check; 404 if unknown.

## Status
GET ${BASE_URL}/api/status (JSON) and ${BASE_URL}/status (HTML): whether the signer, database, chain RPC, payments, Workers AI and the free-tier counter are in place. No secrets or URLs in it.

## Request fields (POST ${API}/gate)
- request (required): network, asset, amount (string, base units), decimals (integer 0-255), payTo (0x address), resourceUrl (string, max 2048), validForSeconds (number, 0-31536000), optional quotedAmount (string). The server sets the time; a \`now\` field is refused.
- policy (optional): a preset name (${PRESET_NAMES.join(", ")}) or a policy object. Unknown fields are a 400, so a typo never silently falls back to a default. Default is ${PRESET_NAMES[0]}.
- payer (optional): your address. Turns on that payer's history: daily cap, duplicates, rate limit, new recipient. Without it the receipt says "stateful": false and history rules do not fire. A payer needs payerSignature and issuedAt (below), so nobody can write into someone else's history.
- payerSignature + issuedAt (required with payer): issuedAt is unix seconds (within 5 minutes of the server clock). payerSignature is a personal_sign (EIP-191, e.g. viem signMessage) by the payer wallet of exactly these 8 lines, joined with "\n", addresses lowercase:
  Reinkeep gate request
  payer: <payer>
  network: <request.network>
  asset: <request.asset>
  amount: <request.amount>
  payTo: <request.payTo>
  resource: <request.resourceUrl>
  issuedAt: <issuedAt>
  Missing: 400 payer_signature_required. Wrong signer or a changed request: 401 payer_signature_invalid. Too old: 401 payer_signature_expired. EOA wallets only for now.
- token (optional): the address of the token this payment buys. Turns on the token rules, so one answer covers how the agent pays and what it buys.
- judge (optional, true/false): on a REVIEW, also ask the AI Judge (a 70B Workers AI model) for a second opinion. Advisory only, see below.
- Body is JSON (content-type application/json), at most 16 KiB. Other body fields are a 400.

## AI Judge (advisory)
Send \`judge: true\` with POST ${API}/gate. Only when the rules say REVIEW, a model reads the same reasons and token facts and answers \`judgement: { ran: true, lean, confidence, cites[], note, model, advisory: true }\`: \`lean\` is ALLOW, REVIEW or BLOCK, \`confidence\` 0 to 1, \`cites\` the reason codes or fact names it rests on. The judgement is signed inside the receipt body, but \`decision\` stays REVIEW: the model never changes the answer. Act on the lean yourself if you choose to, knowing it is a model's opinion. On ALLOW or BLOCK you get \`{ ran: false, why: "only_on_review" }\`; if the model is missing, slow or answers off the schema, \`{ ran: false, why: "unavailable" }\`. No extra charge. Not on POST ${API}/gate/batch.

## Rules
A BLOCK from any rule wins over a REVIEW. Unknown never passes: a BLOCK needs the fact to be known true, and anything unknown is a REVIEW at best.

How it pays:
${ruleLines("pays")}

What it buys (needs \`token\`):
${ruleLines("buys")}

## Pricing
- ${FREE_CALLS_PER_DAY} free POST ${API}/gate calls per caller IP per UTC day (only calls that answer 200 use a slot; header x-free-calls-left shows what remains). A batch uses one slot per token.
- GET ${API}/verdict/{address} is free but limited to ${VERDICT_CALLS_PER_DAY} per caller IP per UTC day (separate counter); it is never paid.
- After that, $${PRICE_USD.toFixed(2)} per call (${PRICE_AMOUNT} base units of USDG ${USDG}, 6 decimals) via x402 v${X402_VERSION}, scheme exact, network ${NETWORK}, facilitator ${DEFAULT_FACILITATOR} (Priors).
- POST ${API}/gate/x402 is always paid, no free tier.
- A call without a PAYMENT-SIGNATURE header gets 402 with the x402 body, and the same JSON base64-encoded in a PAYMENT-REQUIRED header. Sign what it asks for, retry with the base64 payload in PAYMENT-SIGNATURE. Settlement happens only after the gate answered 200; a successful answer carries a PAYMENT-RESPONSE header.
- Holder price (off until the Reinkeep token launches; GET ${API}/gate/pricing shows \`holder: null\` until then): send header \`x-holder: <your address>\` and, if that wallet holds at least \`holder.minBalance\` of \`holder.token\` (read live), the 402 asks for half. The payment must come from that same wallet, or it is refused with a full-price 402 before anything runs or settles. Check a wallet: GET ${API}/gate/holder?address=0x...
- Mandates paid in the Reinkeep token (off until launch; pricing shows \`tokenBurn: null\` until then): the mandate 402 carries \`token_option\` (scheme reinkeep-permit2, payTo 0x...dEaD). Approve Permit2 once, sign a PermitTransferFrom for that token and amount with \`extra.spender\` as spender, deadline at most 120 s away, and resend with PAYMENT-SIGNATURE {x402Version:2, accepted: token_option, payload:{owner, permit:{permitted:{token,amount}, nonce, deadline}, signature}}. Half price; the tokens are burned.
- Presets, receipts, pricing and status are free and unlimited.
- Live numbers: GET ${API}/gate/pricing

## Verify a receipt
A receipt is \`Receipt(string id, string decision, bytes32 policyHash, bytes32 bodyHash, uint64 issuedAt)\` signed with EIP-712, domain \`${JSON.stringify(RECEIPT_DOMAIN)}\`. policyHash and bodyHash are keccak256 of the canonical JSON (sorted keys, no spaces) of receipt.policy and receipt.body.
1. POST ${API}/receipts/verify with \`{ "receipt": <receipt> }\`. It answers \`{ valid: true, signer }\` or \`{ valid: false, reason }\`.
2. Or do it yourself: GET ${API}/receipts/signer, recompute both hashes, recover the signer with recoverTypedDataAddress and compare. Receipts record a moment; they do not expire.

## Limits
- Reviewed by our team, no outside audit yet. An answer is rule-based, not a guarantee and not financial advice.
- Unknown never passes: a token the collector never saw, or a fact that could not be read, is a REVIEW.
- Without a \`payer\`, history rules (daily cap, duplicates, rate limit, new recipient) do not run.
- Token facts cover the tokens the collector saw; liquidity is unknown for a token read live, so that token is a REVIEW at best.
- The free tier is the only abuse limit.
`;
}

export function agentCard() {
  return {
    protocolVersion: "0.3.0",
    name: "Reinkeep AI",
    description: DESCRIPTION,
    url: BASE_URL + API,
    preferredTransport: "HTTP+JSON",
    additionalInterfaces: [
      { url: BASE_URL + API, transport: "HTTP+JSON" },
      { url: MCP_URL, transport: "MCP-STREAMABLE-HTTP" },
    ],
    provider: { organization: "Reinkeep AI", url: BASE_URL },
    version: VERSION,
    documentationUrl: BASE_URL + "/llms.txt",
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "gate_check",
        name: "Gate a payment",
        description: `ALLOW, REVIEW or BLOCK for one payment request, optionally with the token it buys, with rule codes and an EIP-712 signed receipt. ${FREE_CALLS_PER_DAY} free calls per IP per day, then $${PRICE_USD.toFixed(2)} USDG via x402. POST ${API}/gate.`,
        tags: ["payments", "pre-trade", "robinhood-chain", "x402", "risk"],
        examples: [`Check a ${PRICE_USD} USDG payment to 0x1111111111111111111111111111111111111111 on ${NETWORK} before signing it`],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "verify_receipt",
        name: "Verify a receipt",
        description: `Re-check a receipt this server signed (hashes and EIP-712 signature). Free. POST ${API}/receipts/verify.`,
        tags: ["receipt", "eip-712", "verification"],
        examples: ["Verify this Reinkeep AI receipt before I rely on it"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
    ],
  };
}

// x402 discovery. `resources` is the plain list of paid URLs; `items` carries the full accepts[] for each.
// Only POST /gate/x402 is listed: it answers 402 every time. POST /gate answers 200 inside the free tier.
export function x402Listing(env: { X402_PAY_TO?: string }) {
  const payTo = env.X402_PAY_TO ?? "";
  const paid = ADDRESS.test(payTo);
  const url = BASE_URL + API + "/gate/x402";
  return {
    version: 1,
    description: "Reinkeep AI gate: one pre-payment check with an EIP-712 signed receipt. USDG on Robinhood Chain.",
    resources: paid ? [url] : [],
    items: paid
      ? [{
          resource: url,
          type: "http",
          x402Version: X402_VERSION,
          accepts: [requirementsFor(payTo)],
          metadata: { method: "POST", description: "Reinkeep AI gate: one pre-payment check with a signed receipt", mimeType: "application/json" },
        }]
      : [],
  };
}

const str = (extra: Record<string, unknown> = {}) => ({ type: "string", ...extra });
const addr = (description: string) => str({ pattern: "^0x[0-9a-fA-F]{40}$", description });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (schema: unknown) => ({ required: true, content: { "application/json": { schema } } });
const jsonOk = (description: string, schema: unknown, headers?: Record<string, unknown>) => ({ description, ...(headers ? { headers } : {}), content: { "application/json": { schema } } });
const ERROR_TEXT: Record<number, string> = {
  400: "Invalid input",
  404: "Not found",
  409: "Mandate cancelled, or already exists",
  413: "Body over 16 KiB",
  415: "Body is not application/json",
  429: "Free daily limit for this tool is used (verdict_limit or premortem_limit)",
  502: "Payment service unreachable; nothing charged",
  503: "Not configured on this server",
};
const mandateIdParam = { name: "id", in: "path", required: true, schema: str({ pattern: "^md_[0-9a-f]{32}$" }), description: "Mandate id from POST /mandates" };
const errors = (codes: number[]) =>
  Object.fromEntries(codes.map((c) => [String(c), { description: ERROR_TEXT[c] ?? "Error", content: { "application/json": { schema: ref("Error") } } }]));

export function openApi() {
  const policyProps = {
    networks: { type: "array", maxItems: 8, items: str({ maxLength: 64 }) },
    assets: { type: "array", maxItems: 16, items: str({ maxLength: 66 }) },
    perPaymentUsd: { type: "number", minimum: 0, maximum: 1_000_000 },
    dailyUsd: { type: "number", minimum: 0, maximum: 1_000_000 },
    approveAboveUsd: { type: "number", minimum: 0, maximum: 1_000_000 },
    allowPayTo: { type: "array", maxItems: 100, items: addr("Recipient allowed without a REVIEW") },
    allowHosts: { type: "array", maxItems: 100, items: str({ maxLength: 253 }) },
    hostCapsUsd: { type: "object", additionalProperties: { type: "number", minimum: 0, maximum: 1_000_000 }, description: "Host to dollar cap, at most 100 entries" },
    maxValiditySec: { type: "integer", minimum: 1, maximum: 3600 },
    duplicateWindowSec: { type: "integer", minimum: 0, maximum: 3600 },
    maxPerMinute: { type: "integer", minimum: 1, maximum: 1000 },
    token: { type: "object", additionalProperties: false, properties: { reviewBelowLiquidityUsd: { type: "number", minimum: 0, maximum: 1_000_000_000 } } },
  };
  const requestProps = {
    network: str({ maxLength: 64, example: NETWORK }),
    asset: str({ maxLength: 66, example: USDG }),
    amount: str({ maxLength: 64, description: "Base units", example: PRICE_AMOUNT }),
    decimals: { type: "integer", minimum: 0, maximum: 255 },
    payTo: addr("Recipient"),
    resourceUrl: str({ maxLength: 2048 }),
    validForSeconds: { type: "number", minimum: 0, maximum: 31_536_000 },
    quotedAmount: str({ maxLength: 64, description: "Amount that was quoted; a difference is a BLOCK" }),
  };
  const gatePath = (summary: string, description: string, paidOnly: boolean) => ({
    post: {
      operationId: paidOnly ? "gateX402" : "gate",
      summary,
      description,
      parameters: [{ name: "PAYMENT-SIGNATURE", in: "header", required: false, schema: str(), description: "base64 x402 v2 payment payload" }],
      requestBody: jsonBody(ref("GateRequest")),
      "x-payment": { protocol: "x402", version: X402_VERSION, scheme: "exact", network: NETWORK, asset: USDG, amount: PRICE_AMOUNT, priceUsd: PRICE_USD, freeCallsPerDay: paidOnly ? 0 : FREE_CALLS_PER_DAY },
      responses: {
        "200": jsonOk("Decision and signed receipt", ref("GateResponse"), {
          "x-free-calls-left": { schema: str(), description: "Free calls left today (free tier only)" },
          "PAYMENT-RESPONSE": { schema: str(), description: "base64 JSON settlement result (paid calls only)" },
        }),
        "402": {
          description: "Payment required (x402 v2). The body holds the requirements; the same JSON is base64 in the PAYMENT-REQUIRED header. Retry with PAYMENT-SIGNATURE.",
          headers: { "PAYMENT-REQUIRED": { schema: str() } },
          content: { "application/json": { schema: ref("PaymentRequired") } },
        },
        ...errors([400, 413, 415, 502, 503]),
      },
    },
  });
  return {
    openapi: "3.1.0",
    info: { title: "Reinkeep AI gate API", version: VERSION, description: `${DESCRIPTION} Remote MCP: ${MCP_URL}` },
    servers: [{ url: BASE_URL }],
    paths: {
      [API + "/gate"]: gatePath("Check one payment", `Free for ${FREE_CALLS_PER_DAY} calls per caller IP per UTC day, then $${PRICE_USD.toFixed(2)} USDG per call over x402 v2.`, false),
      [API + "/gate/x402"]: gatePath("Check one payment (always paid)", "Same as POST /gate with no free tier. Answers 402 until a valid PAYMENT-SIGNATURE is sent.", true),
      [API + "/gate/batch"]: {
        post: {
          operationId: "gateBatch",
          summary: summaryOf("/gate/batch"),
          description: `One payment request and policy against 1 to ${MAX_BATCH_TOKENS} tokens. Costs one call per token: free calls are taken all or nothing, then the 402 asks for ${PRICE_AMOUNT} x N base units. payer is refused (400 payer_not_supported_in_batch).`,
          parameters: [{ name: "PAYMENT-SIGNATURE", in: "header", required: false, schema: str(), description: "base64 x402 v2 payment payload for N x the price" }],
          requestBody: jsonBody(ref("BatchRequest")),
          "x-payment": { protocol: "x402", version: X402_VERSION, scheme: "exact", network: NETWORK, asset: USDG, amount: `${PRICE_AMOUNT} x number of tokens`, priceUsd: PRICE_USD, freeCallsPerDay: FREE_CALLS_PER_DAY },
          responses: {
            "200": jsonOk("One gate answer per token, in order", ref("BatchResponse"), {
              "x-free-calls-left": { schema: str(), description: "Free calls left today (free tier only)" },
              "PAYMENT-RESPONSE": { schema: str(), description: "base64 JSON settlement result (paid calls only)" },
            }),
            "402": {
              description: "Payment required (x402 v2) for N x the price. The body holds the requirements; the same JSON is base64 in the PAYMENT-REQUIRED header.",
              headers: { "PAYMENT-REQUIRED": { schema: str() } },
              content: { "application/json": { schema: ref("PaymentRequired") } },
            },
            ...errors([400, 413, 415, 502, 503]),
          },
        },
      },
      [API + "/verdict/{address}"]: {
        get: {
          operationId: "verdict",
          summary: summaryOf("/verdict/{address}"),
          description: `Reads the token's facts and runs the token rules only. Free, ${VERDICT_CALLS_PER_DAY} per caller IP per UTC day (429 verdict_limit after that). Not signed.`,
          parameters: [{ name: "address", in: "path", required: true, schema: str({ pattern: "^0x[0-9a-fA-F]{40}$" }), description: "Token contract address" }],
          responses: { "200": jsonOk("Token verdict", ref("Verdict")), ...errors([400, 429]) },
        },
      },
      [API + "/receipts/{id}"]: {
        get: {
          operationId: "getReceipt",
          summary: summaryOf("/receipts/{id}"),
          parameters: [{ name: "id", in: "path", required: true, schema: str({ pattern: "^rk_[0-9a-f]{16}$" }), description: "Receipt id from a gate answer" }],
          responses: { "200": jsonOk("The stored receipt and a fresh signature check", ref("StoredReceipt")), ...errors([400, 404, 503]) },
        },
      },
      [API + "/gate/pricing"]: { get: { operationId: "pricing", summary: summaryOf("/gate/pricing"), responses: { "200": jsonOk("Pricing", ref("Pricing")) } } },
      [API + "/gate/presets"]: {
        get: {
          operationId: "presets",
          summary: summaryOf("/gate/presets"),
          responses: { "200": jsonOk("Presets by name", { type: "object", properties: { presets: { type: "object", additionalProperties: ref("Policy"), description: `Names: ${PRESET_NAMES.join(", ")}` } } }) },
        },
      },
      [API + "/receipts/verify"]: {
        post: {
          operationId: "verifyReceipt",
          summary: summaryOf("/receipts/verify"),
          requestBody: jsonBody({ type: "object", required: ["receipt"], additionalProperties: false, properties: { receipt: ref("Receipt") } }),
          responses: {
            "200": jsonOk("Verification result", {
              oneOf: [
                { type: "object", required: ["valid", "signer"], properties: { valid: { const: true }, signer: addr("Signer") } },
                { type: "object", required: ["valid", "reason"], properties: { valid: { const: false }, reason: str({ description: "malformed, body_hash_mismatch, policy_hash_mismatch, id_mismatch, bad_signature, signer_mismatch or not_our_signature" }) } },
              ],
            }),
            ...errors([400, 413, 415]),
          },
        },
      },
      [API + "/receipts/signer"]: {
        get: {
          operationId: "signer",
          summary: summaryOf("/receipts/signer"),
          responses: { "200": jsonOk("Signer and EIP-712 definition", { type: "object", properties: { signer: addr("Signer address"), domain: { type: "object", example: RECEIPT_DOMAIN }, types: { type: "object", example: RECEIPT_TYPES }, primaryType: { const: "Receipt" } } }) },
        },
      },
      [API + "/mandates"]: {
        post: {
          operationId: "createMandate",
          summary: summaryOf("/mandates"),
          description: `Costs ${MANDATE_CALLS} calls: free calls first (all or nothing), then x402 for ${MANDATE_CALLS} x ${PRICE_AMOUNT} base units. The webhookSecret appears only in this answer.`,
          parameters: [{ name: "PAYMENT-SIGNATURE", in: "header", required: false, schema: str(), description: `base64 x402 v2 payment payload for ${MANDATE_CALLS} x the price` }],
          requestBody: jsonBody({ type: "object", required: ["token"], additionalProperties: false, properties: { token: addr("Token to watch"), webhookUrl: str({ format: "uri", maxLength: 500, description: "https, public host; receives signed events" }) } }),
          "x-payment": { protocol: "x402", version: X402_VERSION, scheme: "exact", network: NETWORK, asset: USDG, amount: `${PRICE_AMOUNT} x ${MANDATE_CALLS}`, priceUsd: PRICE_USD * MANDATE_CALLS, freeCallsPerDay: FREE_CALLS_PER_DAY },
          responses: {
            "200": jsonOk("The new mandate, its first event and the webhook secret", { type: "object", required: ["mandate", "event"], properties: { mandate: ref("Mandate"), webhookSecret: { oneOf: [str({ pattern: "^whsec_[0-9a-f]{64}$" }), { type: "null" }] }, event: ref("MandateEvent") } }),
            "402": { description: "Payment required (x402 v2)", headers: { "PAYMENT-REQUIRED": { schema: str() } }, content: { "application/json": { schema: ref("PaymentRequired") } } },
            ...errors([400, 413, 415, 502, 503]),
          },
        },
      },
      [API + "/mandates/{id}"]: {
        get: { operationId: "getMandate", summary: summaryOf("/mandates/{id}"), parameters: [mandateIdParam], responses: { "200": jsonOk("The mandate", ref("Mandate")), ...errors([404, 503]) } },
        delete: { operationId: "cancelMandate", summary: summaryOf("/mandates/{id}"), parameters: [mandateIdParam], responses: { "200": jsonOk("The cancelled mandate", { type: "object", properties: { mandate: ref("Mandate") } }), ...errors([404, 503]) } },
      },
      [API + "/mandates/{id}/events"]: {
        get: {
          operationId: "mandateEvents",
          summary: summaryOf("/mandates/{id}/events"),
          parameters: [
            mandateIdParam,
            { name: "after", in: "query", required: false, schema: { type: "integer", minimum: 0 }, description: "Return events with seq greater than this" },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } },
          ],
          responses: { "200": jsonOk("A page of events", { type: "object", properties: { events: { type: "array", items: ref("MandateEvent") }, next: { oneOf: [{ type: "integer" }, { type: "null" }] } } }), ...errors([400, 404, 503]) },
        },
      },
      [API + "/mandates/{id}/renew"]: {
        post: {
          operationId: "renewMandate",
          summary: summaryOf("/mandates/{id}/renew"),
          parameters: [mandateIdParam, { name: "PAYMENT-SIGNATURE", in: "header", required: false, schema: str() }],
          responses: { "200": jsonOk("The renewed mandate", { type: "object", properties: { mandate: ref("Mandate"), event: ref("MandateEvent") } }), "402": { description: "Payment required (x402 v2)" }, ...errors([404, 409, 503]) },
        },
      },
      [API + "/mandates/{id}/test"]: {
        post: { operationId: "testMandateWebhook", summary: summaryOf("/mandates/{id}/test"), parameters: [mandateIdParam], responses: { "200": jsonOk("The test event and how the webhook answered", { type: "object", properties: { event: ref("MandateEvent") } }), ...errors([400, 404, 503]) } },
      },
      [API + "/odds"]: { get: { operationId: "odds", summary: summaryOf("/odds"), responses: { "200": jsonOk("Bands with counts and shares", { type: "object", properties: { byFirstLiquidityUsd: { type: "array", items: ref("Band") }, byFirstSwaps: { type: "array", items: ref("Band") }, coverage: ref("Coverage") } }), ...errors([429, 503]) } } },
      [API + "/board"]: {
        get: {
          operationId: "board", summary: summaryOf("/board"),
          parameters: [{ name: "days", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: BOARD_MAX_DAYS, default: 7 } }],
          responses: { "200": jsonOk("One row per UTC day, newest first", { type: "object", properties: { days: { type: "array", items: { type: "object" } }, coverage: ref("Coverage") } }), ...errors([400, 429, 503]) },
        },
      },
      [API + "/radar"]: {
        get: {
          operationId: "radar", summary: summaryOf("/radar"),
          parameters: [{ name: "hours", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: RADAR_MAX_HOURS, default: 24 } }],
          responses: { "200": jsonOk("Ticker waves, most reused first", { type: "object", properties: { waves: { type: "array", items: { type: "object" } }, coverage: ref("Coverage") } }), ...errors([400, 429, 503]) },
        },
      },
      [API + "/autopsy/{address}"]: {
        get: {
          operationId: "autopsy", summary: summaryOf("/autopsy/{address}"),
          parameters: [{ name: "address", in: "path", required: true, schema: str({ pattern: "^0x[0-9a-fA-F]{40}$" }) }],
          responses: { "200": jsonOk("The token's first day", { type: "object", properties: { pattern: { type: "string", enum: ["still_trading", "liquidity_pulled", "faded", "never_lived", "too_young", "not_rechecked", "unknown"] }, plain: str(), firstSeen: { type: "object" }, dayLater: { oneOf: [{ type: "object" }, { type: "null" }] } } }), ...errors([400, 404, 429, 503]) },
        },
      },
      [API + "/premortem"]: {
        post: {
          operationId: "premortem",
          summary: summaryOf("/premortem"),
          requestBody: jsonBody({
            type: "object",
            required: ["ticker", "contract", "buyTaxPct", "sellTaxPct", "teamAllocationPct", "liquidityUsd", "liquidityLockDays"],
            additionalProperties: false,
            properties: {
              name: str({ maxLength: 64 }), ticker: str({ maxLength: 64 }),
              contract: {
                type: "object", additionalProperties: false, required: ["mint", "ownerRenounced", "pause", "blacklist", "upgradeable"],
                properties: { mint: { type: "boolean" }, ownerRenounced: { type: "boolean" }, pause: { type: "boolean" }, blacklist: { type: "boolean" }, upgradeable: { type: "boolean" } },
              },
              buyTaxPct: { type: "number", minimum: 0, maximum: 100 }, sellTaxPct: { type: "number", minimum: 0, maximum: 100 },
              teamAllocationPct: { type: "number", minimum: 0, maximum: 100 }, liquidityUsd: { type: "number", minimum: 0 },
              liquidityLockDays: { type: "integer", minimum: 0, maximum: 36500 },
            },
          }),
          responses: { "200": jsonOk("The pre-mortem (not stored)", { type: "object", properties: { gate: { type: "object" }, risks: { type: "array", items: { type: "object" } }, ticker: { type: "object" }, cohort: { oneOf: [{ type: "object" }, { type: "null" }] }, summary: { type: "object" }, stored: { const: false } } }), ...errors([400, 413, 415, 429]) },
        },
      },
      [API + "/signals/verify"]: {
        post: {
          operationId: "verifySignal",
          summary: summaryOf("/signals/verify"),
          requestBody: jsonBody({ type: "object", required: ["signal"], properties: { signal: ref("Signal") } }),
          responses: {
            "200": jsonOk("Verification result", {
              oneOf: [
                { type: "object", required: ["valid", "expired"], properties: { valid: { const: true }, expired: { type: "boolean", description: "true after validUntil: genuine but stale" } } },
                { type: "object", required: ["valid", "reason"], properties: { valid: { const: false }, reason: str({ description: "malformed, bad_signature or not_our_signature" }) } },
              ],
            }),
            ...errors([400, 413, 415]),
          },
        },
      },
    },
    components: {
      schemas: {
        GateRequest: {
          type: "object",
          required: ["request"],
          additionalProperties: false,
          properties: {
            request: ref("PaymentRequest"),
            policy: { description: `A preset name (${PRESET_NAMES.join(", ")}) or a policy object`, oneOf: [{ type: "string", enum: PRESET_NAMES }, ref("Policy")] },
            payer: addr("Turns on this payer's history rules; needs payerSignature and issuedAt"),
            payerSignature: { type: "string", pattern: "^0x[0-9a-fA-F]+$", description: "personal_sign by payer of the payer-proof message (see llms.txt)" },
            issuedAt: { type: "integer", description: "Unix seconds the payer signed at, within 300 s of now" },
            token: addr("Token this payment buys; turns on the token rules"),
            judge: { type: "boolean", description: "On a REVIEW, add the AI Judge's advisory second opinion" },
          },
        },
        BatchRequest: {
          type: "object",
          required: ["request", "tokens"],
          additionalProperties: false,
          properties: {
            request: ref("PaymentRequest"),
            policy: { description: `A preset name (${PRESET_NAMES.join(", ")}) or a policy object`, oneOf: [{ type: "string", enum: PRESET_NAMES }, ref("Policy")] },
            tokens: { type: "array", minItems: 1, maxItems: MAX_BATCH_TOKENS, items: addr("A token this payment could buy") },
          },
        },
        BatchResponse: { type: "object", required: ["results"], properties: { results: { type: "array", items: ref("GateResponse") } } },
        Band: {
          type: "object",
          properties: { minUsd: { type: "number" }, maxUsd: { oneOf: [{ type: "number" }, { type: "null" }] }, n: { type: "integer" }, alive: { type: "integer" }, dead: { type: "integer" }, stillTradingPct: { oneOf: [{ type: "integer" }, { type: "null" }] } },
        },
        Coverage: { type: "object", properties: { pools: { type: "integer" }, outcomes: { type: "integer" }, note: str() } },
        Mandate: {
          type: "object",
          properties: {
            id: str({ pattern: "^md_[0-9a-f]{32}$" }), token: addr("Watched token"), state: { type: "string", enum: ["active", "expired", "cancelled"] },
            createdAt: str({ format: "date-time" }), expiresAt: str({ format: "date-time" }), checkEveryMinutes: { type: "integer" }, checks: { type: "integer" },
            webhook: { oneOf: [{ type: "object", properties: { url: str() } }, { type: "null" }] }, signal: { oneOf: [ref("Signal"), { type: "null" }] },
          },
        },
        MandateEvent: {
          type: "object",
          required: ["seq", "at", "kind", "changes"],
          properties: {
            seq: { type: "integer" }, at: str({ format: "date-time" }), kind: { type: "string", enum: ["created", "check", "renewed", "expired", "cancelled", "test"] },
            changes: { type: "array", items: { type: "object", properties: { field: str(), before: {}, after: {} } } },
            error: str({ description: "Present when the chain could not be read" }), signal: ref("Signal"),
            webhook: { type: "object", properties: { delivered: { type: "boolean" }, status: { oneOf: [{ type: "integer" }, { type: "null" }] } } },
          },
        },
        Signal: {
          type: "object",
          required: ["mandate", "token", "action", "decision", "factsHash", "issuedAt", "validUntil", "signer", "signature"],
          properties: {
            mandate: str(), token: addr("Token"), action: { type: "string", enum: ["exit", "watch", "hold"] }, decision: { type: "string", enum: ["ALLOW", "REVIEW", "BLOCK"] },
            reasons: { type: "array", items: str() }, factsHash: str({ pattern: "^0x[0-9a-fA-F]{64}$" }), issuedAt: { type: "integer" }, validUntil: { type: "integer" },
            signer: addr("Signer"), signature: str(),
          },
        },
        Verdict: {
          type: "object",
          required: ["token", "decision", "reasons", "facts", "explanation", "checkedAt"],
          properties: {
            token: addr("The token, lowercase"),
            decision: { type: "string", enum: ["ALLOW", "REVIEW", "BLOCK"] },
            reasons: { type: "array", items: ref("Reason") },
            facts: { description: "The fact sheet the rules read; null when we have no data on the token", oneOf: [{ type: "object" }, { type: "null" }] },
            explanation: ref("Explanation"),
            checkedAt: str({ format: "date-time" }),
          },
        },
        StoredReceipt: {
          type: "object",
          required: ["receipt", "valid", "signer"],
          properties: { receipt: ref("Receipt"), valid: { type: "boolean" }, signer: addr("This server's signer address"), reason: str({ description: "Why the signature check failed, when valid is false" }) },
        },
        PaymentRequest: {
          type: "object",
          required: Object.keys(requestProps).filter((k) => k !== "quotedAmount"),
          additionalProperties: false,
          properties: requestProps,
        },
        Policy: { type: "object", additionalProperties: false, properties: policyProps, description: "Unknown fields are a 400. Omitted fields take the default preset's value." },
        Reason: { type: "object", required: ["code", "plain"], properties: { code: { type: "string", enum: rules.map((r) => r.code) }, plain: str() } },
        GateResponse: {
          type: "object",
          required: ["id", "decision", "reasons", "receipt"],
          properties: { id: str(), decision: { type: "string", enum: ["ALLOW", "REVIEW", "BLOCK"] }, reasons: { type: "array", items: ref("Reason") }, receipt: ref("Receipt"), explanation: ref("Explanation"), judgement: ref("Judgement"), shareUrl: str({ description: `${BASE_URL}/r/{id}, present when receipts are stored` }) },
        },
        Judgement: {
          description: "Present only when judge was true. Advisory: decision is never changed by it.",
          type: "object",
          required: ["ran"],
          properties: {
            ran: { type: "boolean" },
            why: { type: "string", enum: ["only_on_review", "unavailable"] },
            lean: { type: "string", enum: ["ALLOW", "REVIEW", "BLOCK"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            cites: { type: "array", items: str() },
            note: { oneOf: [str(), { type: "null" }] },
            model: str(),
            advisory: { type: "boolean", enum: [true] },
          },
        },
        Explanation: {
          type: "object",
          description: "Optional. Two short plain-English sentences about the answer. The decision always comes from the rules; this text never changes it.",
          required: ["text", "source"],
          properties: {
            text: str(),
            source: { type: "string", enum: ["ai", "rules"], description: "ai: written by a small Cloudflare Workers AI model. rules: fixed rule text (also used when the model errors, times out, or adds numbers or advice)." },
            model: str({ description: "Model name, when source is ai" }),
          },
        },
        Receipt: {
          type: "object",
          required: ["id", "decision", "policyHash", "bodyHash", "issuedAt", "signer", "signature", "body", "policy"],
          properties: {
            id: str(),
            decision: { type: "string", enum: ["ALLOW", "REVIEW", "BLOCK"] },
            policyHash: str({ pattern: "^0x[0-9a-fA-F]{64}$" }),
            bodyHash: str({ pattern: "^0x[0-9a-fA-F]{64}$" }),
            issuedAt: { type: "integer", description: "Unix seconds" },
            signer: addr("Signer"),
            signature: str(),
            body: { type: "object", description: "Signed body: engine, policyName, request, reasons, stateful, optional buying" },
            policy: ref("Policy"),
          },
        },
        Pricing: {
          type: "object",
          properties: {
            freeCallsPerDay: { const: FREE_CALLS_PER_DAY }, priceUsd: { const: PRICE_USD }, amount: { const: PRICE_AMOUNT },
            asset: addr("Payment token"), network: { const: NETWORK }, payTo: { oneOf: [addr("Recipient"), { type: "null" }] }, facilitator: str(),
            holder: {
              description: "Holder price; null until the Reinkeep token is launched and configured",
              oneOf: [{ type: "null" }, { type: "object", properties: { token: addr("Reinkeep token"), minBalance: str({ description: "Base units" }), discountPct: { type: "integer" }, amount: str({ description: "One call at the holder price, base units" }), header: { const: "x-holder" } } }],
            },
            tokenBurn: {
              description: "Mandates paid in the Reinkeep token at half price, burned; null until launched and configured",
              oneOf: [{ type: "null" }, { type: "object", properties: { appliesTo: { const: "mandates" }, token: addr("Reinkeep token"), amount: str({ description: "Base units per mandate" }), discountPct: { type: "integer" }, payTo: addr("Dead address"), permit2: addr("Permit2"), spender: addr("Our burner wallet") } }],
            },
          },
        },
        PaymentRequired: {
          type: "object",
          required: ["x402Version", "accepts"],
          properties: {
            x402Version: { const: X402_VERSION }, error: str(), resource: { type: "object" },
            accepts: { type: "array", items: { type: "object", properties: { scheme: { const: "exact" }, network: { const: NETWORK }, amount: str({ description: `Base units: ${PRICE_AMOUNT} per call, times the calls asked for (batch tokens, ${MANDATE_CALLS} for a mandate), half at the holder price` }), asset: addr("USDG"), payTo: addr("Recipient"), maxTimeoutSeconds: { type: "integer" }, extra: { type: "object" } } } },
          },
        },
        Error: { type: "object", properties: { error: { type: "object", properties: { code: str(), message: str() } } } },
      },
    },
  };
}

const HEADERS = { "cache-control": "public, max-age=300", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };
const pretty = (v: unknown) => JSON.stringify(v, null, 2);

export function discovery(req: Request, env: { X402_PAY_TO?: string }): Response | null {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const path = new URL(req.url).pathname;
  let body: string;
  let type = "application/json; charset=utf-8";
  switch (path) {
    case "/llms.txt":
      body = llmsTxt();
      type = "text/plain; charset=utf-8";
      break;
    case "/.well-known/agent.json":
      body = pretty(agentCard());
      break;
    case API + "/openapi.json":
      body = pretty(openApi());
      break;
    case "/.well-known/x402":
      body = pretty(x402Listing(env));
      break;
    default:
      return null;
  }
  return new Response(req.method === "HEAD" ? null : body, { status: 200, headers: { ...HEADERS, "content-type": type } });
}
