# Reinkeep gate API

One call before an agent pays: send the payment request, get `ALLOW`, `REVIEW` or `BLOCK`, the rule that decided it,
and a receipt signed with EIP-712 that anyone can re-check. The decision comes from `engine/policy.ts`, the same
`evaluate()` the website demo and the local guard run.

```bash
npm run api:dev          # http://127.0.0.1:4190, throwaway signing key, history kept in memory
npm test                 # API, token-rule and collector tests (see `npm test`)
npm run typecheck
```

## Endpoints (`/api/v1`)

| Method and path | What it does |
|---|---|
| `POST /gate` | `{ request, policy?, payer?, token?, judge? }` returns `{ id, decision, reasons[], receipt, explanation, judgement?, shareUrl? }` |
| `POST /receipts/verify` | `{ receipt }` returns `{ valid: true, signer }` or `{ valid: false, reason }` |
| `GET /receipts/signer` | The signer address, EIP-712 domain and types. All a stranger needs to check a receipt. |
| `POST /gate/x402` | Same as `POST /gate`, always paid (no free tier). `402` until a `PAYMENT-SIGNATURE` header is sent. |
| `GET /gate/pricing` | `{ freeCallsPerDay, priceUsd, amount, asset, network, payTo, facilitator, holder }` (`payTo` is null if unset; `holder` is null until the token launches). |
| `GET /gate/presets` | Built-in policies (`reinkeep-default-v1`). |
| `POST /gate/batch` | `{ request, policy?, tokens: [address, ...max 10] }` returns `{ results: [gate answer per token] }`, one signed receipt each. |
| `GET /verdict/{address}` | Free token check, token rules only: `{ token, decision, reasons[], facts, explanation, checkedAt }`. Not signed. |
| `GET /receipts/{id}` | A stored receipt with a fresh signature check: `{ receipt, valid, signer }` (`reason` when not valid). `404` if unknown. |
| `POST /mandates` | `{ token, webhookUrl? }` starts a 7-day watch: the contract is re-read every 30 min. Returns `{ mandate, webhookSecret, event }` (the secret is shown only here). Costs 5 calls. |
| `GET /mandates/{id}` | The mandate: state, expiry, checks so far, latest signed signal. |
| `GET /mandates/{id}/events` | `?after=<seq>&limit=<1..100>` returns `{ events[], next }`: every check, change, failed read, renewal. |
| `POST /mandates/{id}/renew` | Adds 7 days (restarts an expired watch). Costs 5 calls. |
| `POST /mandates/{id}/test` | Sends the last signal to the webhook as a `test` event. |
| `DELETE /mandates/{id}` | Stops the watch. |
| `POST /signals/verify` | `{ signal }` returns `{ valid: true, expired }` or `{ valid: false, reason }`. |
| `GET /odds` | Out of the tokens that started like this (first liquidity, first swaps), how many still traded a day later. Share only from 30 judged pools. |
| `GET /board` | `?days=1..30` per UTC day: pools seen, re-checked, alive, dead, share still trading. |
| `GET /radar` | `?hours=1..168` tickers reused by 2+ tokens lately, with the earliest and the busiest token. |
| `GET /autopsy/{address}` | What happened to one token a day after launch: still trading, liquidity pulled, faded, never lived (or too young / not re-checked). |
| `POST /premortem` | A launch draft returns what the gate will say about it, launch risks with fixes, ticker reuse and how similar launches did after a day. Free, 60 per IP per day, not stored. |

Outside `/api/v1` (not in `openapi.json`; listed in `llms.txt`):

| Page | What it is |
|---|---|
| `/r/{id}` | GET. Share page for a stored receipt: server-rendered HTML, no script, every value escaped. |
| `/api/status`, `/status` | GET. Is the gate wired up? JSON and the same as HTML. `503` when a critical check fails. |

`request` fields: `network`, `asset`, `amount` (string, base units), `decimals`, `payTo`, `resourceUrl`,
`validForSeconds`, optional `quotedAmount`. The server sets the time; a `now` field is refused.
`policy` is a preset name or an object (unknown fields are an error, so a typo never silently falls back to a default).
`payer` (an address) turns on that payer's history: daily cap, duplicates, rate limit, new recipient.
`token` (an address) is the token this payment buys. It turns on the token rules, so ONE answer covers how the
agent pays and what it buys; a BLOCK from either side wins over a REVIEW from the other.

## Token rules ("what it buys")

Facts come from the collector's database (`collector/`, fact sheet built by `buildTokenFacts`; wired in
`src/token-facts-source.ts`). The receipt body carries `buying: { token, facts }`, the exact sheet that was read.

| Code | Answer | When |
|---|---|---|
| `token_not_contract` | BLOCK | no contract code at the address |
| `token_mint_live_owner` | BLOCK | a mint function and an owner who can still use it |
| `token_has_blacklist` | BLOCK | a blacklist function |
| `token_unknown` | REVIEW | the collector never saw the token, or the facts could not be read |
| `token_facts_unknown` | REVIEW | a fact a BLOCK rule needs is unknown (null), or liquidity is unknown |
| `token_has_pause` | REVIEW | a pause function |
| `token_upgradeable` | REVIEW | a proxy, or an upgrade function |
| `token_ticker_copy` | REVIEW | an older token the collector saw already uses the ticker |
| `token_low_liquidity` | REVIEW | first-seen liquidity under `policy.token.reviewBelowLiquidityUsd` (default $1,000) |

Unknown never passes: a BLOCK needs the fact to be known true, and anything it cannot know is a REVIEW. Limits of the
facts themselves (common power names only, no scheduled re-read, copies only among tokens the collector saw) are in
`collector/DATA-MODEL.md` section 8b. The $1,000 line is a starting value, not fitted to outcomes yet.

Validation refuses only what cannot be judged (wrong types, a broken `payTo`). Everything the rules can judge becomes
a `BLOCK` with a named reason, for example a wrong chain, a wrong token or a plain `http` link.

## Free token check

`GET /api/v1/verdict/{address}` answers "is this token worth a look?" with no payment and no receipt. It reads the facts
the same way the gate does (the collector's D1 data, else the contract live from `RPC_URL`) and runs ONLY the token
rules (`evaluateToken()` in `engine/policy.ts`, the same code `evaluate()` calls for "what it buys", default policy).

```json
{ "token": "0x…lowercase", "decision": "REVIEW",
  "reasons": [{ "code": "token_unknown", "plain": "…" }],
  "facts": null,
  "explanation": { "text": "…", "source": "rules" },
  "checkedAt": "2026-11-11T10:00:00.000Z" }
```

`facts` is the fact sheet the rules read, or `null` when we have no data on the token (that is `token_unknown`, a REVIEW).
A bad address is `400 invalid_address` and costs nothing. Limit: 60 per caller IP per UTC day, counted in a `FreeTier`
object named `verdict:<ip>` (its own counter, separate from the 25 gate calls). The 61st is
`429 { "error": { "code": "verdict_limit", "message": "…" } }`. A check that fails with a non-200 gives its slot back.

## Batch

`POST /api/v1/gate/batch` with `{ request, policy?, tokens }` checks one payment against 1 to 10 tokens and returns
`{ results: [...] }` in order. Each result is a normal gate answer with its own signed receipt. More than 10 tokens, no
tokens or a bad address is `400`. **`payer` is refused** (`400 payer_not_supported_in_batch`): a payer's history is per
payment, and the same request repeated for N tokens would trip its own duplicate rule. For history, call `POST /gate`
once per token. Cost: one call per token. The free counter takes all N slots or none (all or nothing, and a non-200
answer gives them back). When the free calls cannot cover N, the answer is `402` for `PRICE_AMOUNT x N` (3 tokens =
`30000` = $0.03) and the `PAYMENT-SIGNATURE` must carry exactly that amount.

## Stored receipts and share pages

Every signed gate answer (single, batch, or via a payer's Durable Object) is also written to D1 table `receipts`
(`id, decision, json, issued_at`; `api/migrations/0001_receipts.sql`, also in `collector/schema.sql`). The write is
best effort: it starts after the receipt is signed, runs under `ctx.waitUntil`, and a failure is logged and swallowed,
so the answer is never slower or broken because of it. The id is a hash of the signed body, so the same request gets the
same id and the first stored row is kept. Answers carry `shareUrl` (`https://reinkeep-gate.reinkeep.workers.dev/r/{id}`)
only when the worker has the `DB` binding.

`GET /r/{id}` shows the decision, the reasons in plain words, the payment checked (amount, short `payTo`, network,
resource), the token and its facts if one was checked, the issue time, the signer and the result of a fresh signature
check. It sends a CSP that allows no script. Until the migration is applied on the remote database, saving fails (logged)
and `shareUrl` links to a "not found" page: apply it before relying on it.

## Status

`GET /api/status` returns `{ ok, checkedAt, checks: { signer, d1, chainRpc, payments, ai, freeTier } }`, each check
`{ ok, detail, critical }`. Critical: `signer` (address only), `d1` (`SELECT 1`), `chainRpc` (`eth_blockNumber`, the block
number only). Optional: `payments` (payout address set, facilitator key set, facilitator `/health` reachable), `ai`
(binding present), `freeTier` (binding present). The checks run in parallel with a 3 s limit each. No key, RPC URL or
facilitator URL is ever printed, and error text is never copied in. `ok` is false (HTTP `503`) when a critical check
fails. It is answered even when the signer key is missing.

## Holder price

Off until the Reinkeep token launches. The owner then sets two plain vars: `HOLDER_TOKEN` (the token address) and
`HOLDER_MIN` (the balance, in base units, that counts as a holder). Paid calls then cost half for a caller who sends
`x-holder: <address>` when that address holds enough (`balanceOf`, read live on the quote and again on the paid retry).
The payment must come from that address (the facilitator's `payer`, else the signed authorization's `from`); otherwise
a full-price 402, with the gate not run and nothing settled. A failed balance read means full price. Free tier unchanged.

Not built: paying in the Reinkeep token at half price with the tokens burned (Actuary does this with Permit2). It needs
the launched token's contract and a facilitator that settles it.

## AI Judge (advisory)

`judge: true` on `POST /gate` asks `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (Workers AI, JSON mode) for a second
opinion, only when the rules say REVIEW: `judgement: { ran: true, lean, confidence, cites[], note, model, advisory: true }`.

- It is signed inside the receipt body (`body.judgement`), so the opinion can be proven later.
- `decision` stays REVIEW. Unlike Actuary's "resolve" mode, the model never changes the answer: the rules are the
  product, and a model can be wrong or talked round. An agent can act on the lean itself.
- The answer is checked: `lean` must be one of the three, `confidence` 0..1, every `cites` entry must be a reason code
  or fact name the model was shown, and a `note` with numbers not in the facts is dropped. Anything off gives
  `{ ran: false, why: "unavailable" }`, as does no binding or an 8 s timeout. ALLOW/BLOCK give `why: "only_on_review"`.
- Not on `/gate/batch`. Uses the Workers AI free allowance (roughly 50 neurons a call, so on the order of 200 a day).

## AI explanation

Every gate answer carries `explanation: { text, source, model? }`, a note of at most two short sentences for a person
who is not technical.

- `source: "ai"` with `model: "@cf/meta/llama-3.2-3b-instruct"`: written by Cloudflare Workers AI (free allowance).
- `source: "rules"` (no `model`): fixed text built from the decision and the reasons' plain wording.

What it is: a readable summary of the answer. What it is not: a judge. The decision, `reasons` and the signed receipt
come only from the rules engine, the receipt body does not contain the note, and the same request gets the same receipt
with or without it. The model sees only the decision, the reason codes with their plain text, the payment amount in
plain units and, if a token was checked, its fact sheet flags.

The AI text is dropped for the rules text when it is empty, over 320 characters, contains a number that is not in those
facts, or contains advice wording ("should buy", "invest", "guarantee", "safe to" and similar). The same happens on any
error or when the model takes longer than 2.5 seconds, so a paid call is never held up by it. Without the `ai` binding
in `wrangler.jsonc` (local dev, tests) the note is always the rules text. Code: `src/explain.ts`; tests:
`test/api-explain.test.ts`.

## Receipt

`Receipt(string id, string decision, bytes32 policyHash, bytes32 bodyHash, uint64 issuedAt)`, domain
`{ name: "Reinkeep", version: "1", chainId: 4663 }`. `policyHash` and `bodyHash` are keccak256 of canonical JSON
(sorted keys, no spaces). The receipt carries the full policy and body, so a verifier recomputes both hashes and then
recovers the signer with `recoverTypedDataAddress`. Receipts record a moment; they do not expire.

## Status and limits (read before relying on it)

- **Deployed** at `https://reinkeep-gate.reinkeep.workers.dev` (workers.dev address; the domain comes later).
- **Payer history on Cloudflare** is one Durable Object per payer (`PayerLedger` in `src/worker.ts`): a request
  that names a `payer` goes to that payer's object, which keeps the last day of ALLOWed payments in its own storage
  and queues that payer's requests, so parallel duplicates cannot both pass. Without `payer` the receipt says
  `"stateful": false` and only rules that need no history fire. Tests: `test/api-worker-payer.test.ts`.
- **Metering**: `POST /gate` and `POST /gate/batch` (one call per token) cost something; `GET /verdict/{address}` is free but limited to 60 per IP per day. 25 calls per caller IP (`cf-connecting-ip`, not the `payer` field)
  per UTC day are free, counted in a `FreeTier` Durable Object per IP; only calls that answered 200 use a slot, and
  `x-free-calls-left` shows what is left. Presets, receipts and pricing are free and unlimited. Calls with no IP header
  share one "unknown" counter. After that, $0.01 per call (see Paying). Not deployed yet: needs the config below.
  The free tier is the only abuse limit; there is no other rate limit.
- **Token facts**: the collector's data when it has the token (D1 bound as `DB`), otherwise the contract is read live
  from `RPC_URL`. Liquidity is then unknown, so such a token is a REVIEW at best.
- **No audit.** Do not use it with money you cannot lose.

## Paying (x402 v2)

Price: `10000` base units of USDG (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals, so $0.01) on `eip155:4663`,
scheme `exact`. After the 25 free calls (or always on `POST /gate/x402`) a call without a `PAYMENT-SIGNATURE` header gets
`402` with the x402 v2 body and the same JSON base64-encoded in a `PAYMENT-REQUIRED` header. Sign what it asks for and
retry with the base64 payment payload in `PAYMENT-SIGNATURE`. The server then:

1. checks the payload accepted exactly our terms (scheme, network, asset, amount, payTo), else `402`;
2. asks the facilitator to `/verify` it, else `402` with the reason;
3. runs the gate; a validation error (4xx) is returned as is and nothing is settled;
4. only after a 200, calls `/settle`. A `settlement_pending` answer is retried with the same payload (about 5 s at most; the payer never signs twice); if it stays pending, `402` saying so. If settling fails, `402` and no gate answer. On success the answer carries a
   `PAYMENT-RESPONSE` header (base64 JSON: success, transaction, network, payer).

A facilitator that cannot be reached is `502 payment_unavailable` (nothing is charged and no upstream text is shown).
Without `X402_PAY_TO` and `PRIORS_API_KEY` the free tier works and paid calls answer `503 payment_not_configured`.

Owner setup: `X402_PAY_TO` (wallet address, a plain var under `vars` in `wrangler.jsonc`), `PRIORS_API_KEY`
(`wrangler secret put PRIORS_API_KEY`), optional `FACILITATOR_URL` (default `https://facilitator.priors.trade`).
Code: `src/metering.ts` (flow, `FreeTier`), `src/x402.ts` (shapes, facilitator client). Tests: `test/api-x402.test.ts`.

## Signing key

`REINKEEP_SIGNER_KEY` (`0x` + 64 hex) is read from the environment, never from code. On Cloudflare:
`wrangler secret put REINKEEP_SIGNER_KEY`. Without it the Worker answers `503 not_configured` and never echoes a value.
Losing or leaking the key means every receipt it signed can no longer be trusted, so publish the signer address
and rotate by announcing a new one.
