import type { ReactNode } from 'react'
import { Link } from 'react-router'
import rules from '@data/rules.json'
import { GATE } from '@/features/gate-tool/gate-api'
import { CodeBlock } from '@/components/code-block'
import { CURL_GATE, MCP_CLAUDE, MCP_JSON, MCP_URL } from './docs-snippets'

// Every fact on this page comes from reinkeep/api/README.md and the live llms.txt. Nothing is added from memory.
export const SECTIONS = [
  ['quick-start', 'Quick start'],
  ['endpoints', 'Endpoints'],
  ['request', 'Request fields'],
  ['rules', 'The 25 rules'],
  ['paying', 'Paying'],
  ['receipts', 'Receipts'],
  ['mcp', 'MCP setup'],
  ['explanation', 'AI explanation'],
  ['limits', 'Limits'],
] as const

const code = 'rounded bg-panel px-1.5 py-0.5 font-mono text-[0.9em] break-words'
const A = 'font-medium text-ink underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ink'

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-t border-hair py-12 first:border-t-0 first:pt-0">
      <h2 id={`${id}-h`} className="text-[28px] font-semibold leading-tight sm:text-[34px]">{title}</h2>
      <div className="mt-4 space-y-4 text-[16px] leading-relaxed text-ink/75">{children}</div>
    </section>
  )
}

const ENDPOINTS: { method: string; path: string; text: string; href?: string }[] = [
  { method: 'POST', path: '/api/v1/gate', text: 'Check one payment, and the token it buys if you name one. 25 free a day, then x402.' },
  { method: 'POST', path: '/api/v1/gate/x402', text: 'Same answer, always paid. No free tier. 402 until a PAYMENT-SIGNATURE header is sent.' },
  { method: 'POST', path: '/api/v1/gate/batch', text: 'One payment against 1 to 10 tokens. One signed receipt each. A payer is refused here.' },
  { method: 'GET', path: '/api/v1/verdict/{address}', text: 'Free token check with the token rules only. Not signed. 60 a day per caller.' },
  { method: 'POST', path: '/api/v1/receipts/verify', text: 'Re-check a receipt this server signed. Answers valid true with the signer, or valid false with a reason.' },
  { method: 'GET', path: '/api/v1/receipts/{id}', text: 'A stored receipt with a fresh signature check. 404 if the id is unknown.' },
  { method: 'GET', path: '/api/v1/receipts/signer', text: 'The signer address, EIP-712 domain and types.', href: `${GATE}/api/v1/receipts/signer` },
  { method: 'GET', path: '/api/v1/gate/presets', text: 'The built-in policies (reinkeep-default-v1).', href: `${GATE}/api/v1/gate/presets` },
  { method: 'GET', path: '/api/v1/gate/pricing', text: 'Free calls a day, price, asset, network and payout address.', href: `${GATE}/api/v1/gate/pricing` },
  { method: 'GET', path: '/r/{id}', text: 'Share page for a stored receipt. Plain HTML, no script.' },
  { method: 'GET', path: '/api/status', text: 'Is the gate wired up? 503 when a critical check fails.', href: `${GATE}/api/status` },
  { method: 'POST', path: '/mcp', text: 'Remote MCP server.' },
]

const FIELDS: [string, string][] = [
  ['request.network', 'Chain id. Robinhood Chain is eip155:4663.'],
  ['request.asset', 'The token being paid, a 0x address. USDG on Robinhood Chain.'],
  ['request.amount', 'A string in base units. 10000 is $0.01 of USDG.'],
  ['request.decimals', 'An integer from 0 to 255. Version 0 handles 6-decimal stablecoins only.'],
  ['request.payTo', 'Who gets paid, a 0x address.'],
  ['request.resourceUrl', 'The link being paid for. https only, 2048 characters at most.'],
  ['request.validForSeconds', 'How long the signature stays valid, 0 to 31,536,000.'],
  ['request.quotedAmount', 'Optional string. If it differs from amount, the answer is BLOCK amount_changed.'],
  ['policy', 'A preset name (reinkeep-default-v1) or a policy object. Unknown fields are a 400, so a typo never falls back to a default.'],
  ['payer', 'Optional address. Turns on that payer’s history: daily cap, duplicates, rate limit, new recipient. Without it the receipt says "stateful": false.'],
  ['payerSignature, issuedAt', 'Required with payer. issuedAt is unix seconds (within 5 minutes). payerSignature is the payer wallet’s personal_sign of the 8-line payer message in llms.txt, so nobody can write into someone else’s history.'],
  ['token', 'Optional address of the token this payment buys. Turns on the token rules, so one answer covers how it pays and what it buys.'],
]

export function DocsContent() {
  const pays = rules.filter((r) => r.side === 'pays')
  const buys = rules.filter((r) => r.side === 'buys')
  return (
    <div className="min-w-0">
      <Section id="quick-start" title="Quick start">
        <p>One call before your agent pays. No API key, CORS open. Send the payment request and read the decision.</p>
        <CodeBlock label="curl" code={CURL_GATE} />
        <p>
          The answer is <code className={code}>{'{ id, decision, reasons[], receipt, explanation }'}</code>. Each reason is <code className={code}>{'{ code, plain }'}</code>. Act on ALLOW. Treat REVIEW as “ask a human or stop”. Never pay on BLOCK. You can also <Link to="/gate" className={A}>try it in the browser</Link>.
        </p>
      </Section>

      <Section id="endpoints" title="Endpoints">
        <p>
          REST base <code className={code}>{GATE}/api/v1</code>. Presets, receipts and pricing are free and unlimited. The machine-readable versions are <a className={A} href={`${GATE}/llms.txt`} target="_blank" rel="noopener">llms.txt</a> and <a className={A} href={`${GATE}/api/v1/openapi.json`} target="_blank" rel="noopener">openapi.json</a>.
        </p>
        <ul className="divide-y divide-hair border-y border-hair">
          {ENDPOINTS.map((e) => (
            <li key={e.method + e.path} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,260px)_1fr] sm:gap-6">
              <p className="min-w-0 break-words font-mono text-[13.5px] text-ink">
                <span className="mr-2 font-semibold">{e.method}</span>
                {e.href ? <a href={e.href} target="_blank" rel="noopener" className="underline decoration-hair underline-offset-4 hover:decoration-ink">{e.path}</a> : e.path}
              </p>
              <p className="text-[15px]">{e.text}</p>
            </li>
          ))}
        </ul>
        <p>Not under <code className={code}>/api/v1</code>: the share page <code className={code}>/r/{'{id}'}</code>, <code className={code}>/api/status</code> and <code className={code}>/mcp</code>. All of them are served by the gate at <code className={code}>{GATE}</code>.</p>
      </Section>

      <Section id="request" title="Request fields">
        <p>Body is JSON, 16 KiB at most. Other body fields are a 400. The server sets the time, so a <code className={code}>now</code> field is refused.</p>
        <dl className="divide-y divide-hair border-y border-hair">
          {FIELDS.map(([k, v]) => (
            <div key={k} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,230px)_1fr] sm:gap-6">
              <dt className="break-words font-mono text-[13.5px] text-ink">{k}</dt>
              <dd className="text-[15px]">{v}</dd>
            </div>
          ))}
        </dl>
        <p>A BLOCK from any rule wins over a REVIEW. Unknown never passes: a BLOCK needs the fact to be known true, and anything unknown is a REVIEW at best.</p>
      </Section>

      <Section id="rules" title={`The ${rules.length} rules`}>
        <p>{pays.length} on how it pays, {buys.length} on what it buys. The token rules run only when you send <code className={code}>token</code>.</p>
        {[['How it pays', pays], ['What it buys', buys]].map(([label, list]) => (
          <div key={label as string}>
            <h3 className="text-[17px] font-semibold text-ink">{label as string}</h3>
            <ul className="mt-2 divide-y divide-hair border-y border-hair">
              {(list as typeof rules).map((r) => (
                <li key={r.code} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,260px)_1fr] sm:gap-6">
                  <p className="min-w-0 break-words font-mono text-[13.5px] text-ink">
                    {r.code}
                    <span className={`ml-2 text-[12px] font-semibold ${r.kind === 'deny' ? 'text-block' : 'text-review'}`}>{r.kind === 'deny' ? 'BLOCK' : 'REVIEW'}</span>
                  </p>
                  <p className="text-[15px]">{r.plain}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>

      <Section id="paying" title="Paying">
        <p>
          Every caller gets <strong className="font-semibold text-ink">25 free checks a day</strong>, counted per caller IP per UTC day. Only calls that answer 200 use a slot, and the <code className={code}>x-free-calls-left</code> header shows what is left. After that a check costs <strong className="font-semibold text-ink">$0.01 in USDG</strong>, paid over x402 v2 and settled through the Priors facilitator. <code className={code}>POST /api/v1/gate/x402</code> is always paid.
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-[15px]">
          <li>Price: <code className={code}>10000</code> base units of USDG (<code className={code}>0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168</code>, 6 decimals) on <code className={code}>eip155:4663</code>, scheme <code className={code}>exact</code>.</li>
          <li>A call without a <code className={code}>PAYMENT-SIGNATURE</code> header gets <code className={code}>402</code> with the x402 body, and the same JSON base64-encoded in a <code className={code}>PAYMENT-REQUIRED</code> header.</li>
          <li>Sign what it asks for and retry with the base64 payment payload in <code className={code}>PAYMENT-SIGNATURE</code>.</li>
          <li>Settlement happens only after the gate answered 200. A successful answer carries a <code className={code}>PAYMENT-RESPONSE</code> header.</li>
          <li>A batch uses one slot per token, and costs $0.01 per token once the free calls cannot cover it.</li>
        </ul>
        <p>Live numbers: <a className={A} href={`${GATE}/api/v1/gate/pricing`} target="_blank" rel="noopener">GET /api/v1/gate/pricing</a>.</p>
      </Section>

      <Section id="receipts" title="Receipts">
        <p>Every answer carries a receipt signed with EIP-712. Anyone can re-check it, and it never expires: it records a moment.</p>
        <CodeBlock
          label="Receipt type and domain"
          code={`Receipt(string id, string decision, bytes32 policyHash, bytes32 bodyHash, uint64 issuedAt)

domain: { "name": "Reinkeep", "version": "1", "chainId": 4663 }`}
        />
        <p>
          <code className={code}>policyHash</code> and <code className={code}>bodyHash</code> are keccak256 of the canonical JSON (sorted keys, no spaces) of the receipt’s policy and body. To verify, either:
        </p>
        <ol className="list-decimal space-y-1.5 pl-5 text-[15px]">
          <li>POST <code className={code}>{'{ "receipt": <receipt> }'}</code> to <code className={code}>/api/v1/receipts/verify</code>. You get <code className={code}>{'{ valid: true, signer }'}</code> or <code className={code}>{'{ valid: false, reason }'}</code>.</li>
          <li>Or do it yourself: read the signer from <code className={code}>/api/v1/receipts/signer</code>, recompute both hashes, recover the signer with <code className={code}>recoverTypedDataAddress</code> and compare.</li>
        </ol>
        <p>When the gate can store it, the answer also has a <code className={code}>shareUrl</code> pointing at <code className={code}>/r/{'{id}'}</code>, a plain page anyone can open.</p>
      </Section>

      <Section id="mcp" title="MCP setup">
        <p>Add the gate as a remote MCP server in Claude, Cursor or any MCP client. The URL is:</p>
        <CodeBlock label="MCP server URL" code={MCP_URL} />
        <CodeBlock label="Claude Code" code={MCP_CLAUDE} />
        <CodeBlock label="Client config (the exact shape depends on your client)" code={MCP_JSON} />
        <p>
          Setup notes and the tool list also live on GitHub:{' '}
          <a href="https://github.com/reinkeep-dev/mcp" target="_blank" rel="noopener" className="font-medium text-ink underline underline-offset-4">reinkeep-dev/mcp</a>. The launch data the gate reads is open too:{' '}
          <a href="https://github.com/reinkeep-dev/data" target="_blank" rel="noopener" className="font-medium text-ink underline underline-offset-4">reinkeep-dev/data</a>.
        </p>
        <p>Tools:</p>
        <dl className="divide-y divide-hair border-y border-hair">
          {[
            ['gate_check', 'Ask before you pay. Same answer and receipt as POST /gate. Pass payment_signature after the free calls.'],
            ['check_token', 'Free check of one token with the token rules only. 60 a day per caller.'],
            ['verify_receipt', 'Re-check a receipt that gate_check returned.'],
            ['get_receipt', 'Fetch a stored receipt by id with a fresh signature check.'],
            ['get_pricing', 'Free calls a day, price per call and where to pay.'],
            ['list_presets', 'The built-in policies.'],
            ['get_signer', 'The signer address with the EIP-712 domain and types.'],
            ['create_mandate', 'After you buy, ask the gate to re-check the token every 30 minutes for 7 days. Costs 5 calls.'],
            ['get_mandate', 'A mandate’s state and its latest signed exit, watch or hold signal.'],
            ['mandate_events', 'Every check and change of a mandate, oldest first.'],
            ['verify_signal', 'Check that a mandate signal was signed by the gate and is still current.'],
            ['premortem', 'For builders: a launch draft in, the gate’s answer and the risks with fixes out.'],
            ['launch_odds', 'How many tokens that started like this still traded a day later.'],
            ['launch_board', 'Per day: pools seen, re-checked and still trading.'],
            ['ticker_radar', 'Tickers reused by several new tokens lately.'],
            ['token_autopsy', 'What happened to one token in its first day.'],
          ].map(([k, v]) => (
            <div key={k} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,180px)_1fr] sm:gap-6">
              <dt className="font-mono text-[13.5px] text-ink">{k}</dt>
              <dd className="text-[15px]">{v}</dd>
            </div>
          ))}
        </dl>
        <p>MCP tools advise. An agent that skips them is not stopped. Only a signer that asks the gate before it signs enforces.</p>
      </Section>

      <Section id="explanation" title="AI explanation">
        <p>The rules decide. The AI only explains. Every answer has an <code className={code}>explanation</code> of at most two short sentences for someone who is not technical.</p>
        <ul className="list-disc space-y-1.5 pl-5 text-[15px]">
          <li><code className={code}>source: "ai"</code>: written by Cloudflare Workers AI, model <code className={code}>@cf/meta/llama-3.2-3b-instruct</code>.</li>
          <li><code className={code}>source: "rules"</code>: fixed text built from the decision and the reasons. Used when the model errors, takes longer than 2.5 seconds, runs over 320 characters, adds a number that is not in the facts, or uses advice wording.</li>
        </ul>
        <p>The decision, the reasons and the signed receipt come only from the rules. The receipt does not contain the note, so the same request gets the same receipt with or without it.</p>
      </Section>

      <Section id="limits" title="Limits">
        <ul className="list-disc space-y-1.5 pl-5 text-[15px]">
          <li><strong className="font-semibold text-ink">Reviewed by our team, no outside audit yet.</strong> An answer is rule-based, not a guarantee and not financial advice. Do not use it with money you cannot lose.</li>
          <li>Unknown never passes. A token the collector never saw, or a fact that could not be read, is a REVIEW.</li>
          <li>Without a <code className={code}>payer</code>, the history rules (daily cap, duplicates, rate limit, new recipient) do not run.</li>
          <li>Token facts cover tokens the collector saw. A token read live has unknown liquidity, so it is a REVIEW at best.</li>
          <li>The free tier is the only abuse limit.</li>
        </ul>
      </Section>
    </div>
  )
}
