import { useMemo } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { evaluate, defaultPolicy, ROBINHOOD_CHAIN, USDG_ROBINHOOD } from '@engine/policy.js'
import samples from '@data/sample-tokens.json'
import { cn } from '@/lib/utils'
import { isAddress, toBaseUnits, type Decision, type GateAnswer } from './gate-api'

// The gate as a scene: Keep carries the payment slip to the gate, each checkpoint lights up, a stamp comes down.
// Before you press Run it is a preview from the same rules engine the gate runs (engine/policy.ts, in the browser);
// after a run it shows the gate's own signed answer.

export type StageInput = { amount: string; payTo: string; resourceUrl: string; valid: string; token: string; known: boolean }
type Light = 'pass' | 'hold' | 'stop' | 'idle'

const WORD = { allow: 'ALLOW', approve: 'REVIEW', deny: 'BLOCK' } as const
const POSE: Record<Decision, string> = { ALLOW: 'keep-allow', REVIEW: 'keep-review', BLOCK: 'keep-block' }
const STAMP: Record<Decision, string> = { ALLOW: 'border-allow text-allow', REVIEW: 'border-review text-review', BLOCK: 'border-block text-block' }
const NOTE: Record<Decision, string> = { ALLOW: 'Safe to pay', REVIEW: 'A human decides', BLOCK: 'Do not pay' }
const LIGHT: Record<Light, string> = { pass: 'bg-allow', hold: 'bg-review', stop: 'bg-block', idle: 'bg-ink/20' }
const CARD: Record<Light, string> = { pass: 'bg-white', hold: 'bg-[#FFF7EB] ring-1 ring-review', stop: 'bg-[#FFF1EE] ring-1 ring-block', idle: 'bg-white' }
const CAP = defaultPolicy.perPaymentUsd
const ASK_ABOVE = defaultPolicy.approveAboveUsd
const MAX_VALID = defaultPolicy.maxValiditySec

// Which checkpoint each rule code belongs to. Anything else lands on "Payment".
const GROUP: Record<string, string> = {
  over_payment_cap: 'amount', above_approval_threshold: 'amount', invalid_amount: 'amount', over_daily_cap: 'amount', over_host_cap: 'amount',
  resource_not_https: 'link', resource_invalid: 'link', host_not_allowed: 'link',
  new_recipient: 'payee', duplicate_payment: 'payee', rate_limit: 'payee',
  validity_too_long: 'valid',
}
const money = (v: number) => (Number.isFinite(v) ? `$${v < 0.01 && v > 0 ? v : v.toFixed(2)}` : '—')
const groupOf = (code: string) => GROUP[code] ?? (code.startsWith('token_') ? 'token' : 'amount')
const DENY = new Set(['over_payment_cap', 'invalid_amount', 'over_daily_cap', 'over_host_cap', 'resource_not_https', 'resource_invalid', 'host_not_allowed', 'validity_too_long', 'duplicate_payment', 'rate_limit', 'token_not_contract', 'token_mint_live_owner', 'token_has_blacklist', 'network_not_allowed', 'asset_not_allowed', 'unsupported_decimals', 'amount_changed'])

function preview(input: StageInput): { decision: Decision; codes: string[] } | null {
  const amount = toBaseUnits(input.amount)
  if (!amount || !isAddress(input.payTo.trim())) return null
  const token = input.token.trim()
  const sample = samples.tokens.find((s) => s.token.toLowerCase() === token.toLowerCase())
  // A token we have no fact sheet for in the browser is read on the real run; the preview leaves it out.
  const buying = sample ? { token: sample.token, facts: sample.facts } : undefined
  const req = {
    network: ROBINHOOD_CHAIN, asset: USDG_ROBINHOOD, amount, decimals: 6, payTo: input.payTo.trim(),
    resourceUrl: input.resourceUrl.trim(), validForSeconds: Number(input.valid) || 0, now: Date.now(),
  }
  const policy = { ...defaultPolicy, allowPayTo: input.known ? [input.payTo.trim()] : [] }
  const res = evaluate(req, policy, [], buying as never) as { verdict: keyof typeof WORD; reasons: string[] }
  return { decision: WORD[res.verdict], codes: res.reasons }
}

export function GateStage({ input, answer, loading }: { input: StageInput; answer: GateAnswer | null; loading: boolean }) {
  const reduce = useReducedMotion()
  const local = useMemo(() => preview(input), [input])
  const decision = answer?.decision ?? local?.decision ?? null
  const codes = answer ? answer.reasons.map((r) => r.code) : (local?.codes ?? [])
  const lightFor = (group: string): Light => {
    const hits = codes.filter((c) => groupOf(c) === group)
    if (hits.some((c) => DENY.has(c))) return 'stop'
    if (hits.length) return 'hold'
    // On a BLOCK the rules report only the hard reasons and drop "a human checks" ones,
    // so a new payee or an amount above the ask line would wrongly look green.
    if (group === 'payee' && !input.known) return 'hold'
    if (group === 'amount' && usd > ASK_ABOVE) return 'hold'
    return 'pass'
  }

  const usd = Number(input.amount)
  const fill = Number.isFinite(usd) ? Math.min(usd / CAP, 1) : 0
  const tokenGiven = input.token.trim() !== ''
  const tokenKnownHere = samples.tokens.some((s) => s.token.toLowerCase() === input.token.trim().toLowerCase())
  const https = input.resourceUrl.trim().toLowerCase().startsWith('https://')
  // Re-run the walk whenever what Keep carries changes.
  const walkKey = `${input.amount}|${input.payTo}|${input.resourceUrl}|${input.valid}|${input.token}|${input.known}|${answer?.receipt.id ?? ''}`

  const checkpoints: { id: string; label: string; light: Light; big: string; small: string; meter?: number }[] = [
    { id: 'amount', label: 'Amount', light: lightFor('amount'), big: money(usd), small: `max ${money(CAP)} · a human checks above ${money(ASK_ABOVE)}`, meter: fill },
    { id: 'link', label: 'Link', light: lightFor('link'), big: https ? 'https' : 'not https', small: 'what it pays for' },
    { id: 'payee', label: 'Payee', light: lightFor('payee'), big: input.known ? 'known' : 'new', small: input.known ? 'on your list' : 'first payment here' },
    { id: 'valid', label: 'Signature', light: lightFor('valid'), big: `${Number(input.valid) || 0}s`, small: `at most ${MAX_VALID}s` },
    { id: 'token', label: 'Token', light: tokenGiven ? (answer || tokenKnownHere ? lightFor('token') : 'idle') : 'idle', big: tokenGiven ? (answer || tokenKnownHere ? 'read' : 'on run') : 'none', small: tokenGiven ? 'contract facts' : 'plain payment' },
  ]

  return (
    <div className="overflow-hidden rounded-[28px] bg-panel p-5 sm:p-7" aria-label="The gate, step by step">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="font-medium text-ink/65">{answer ? 'Signed answer from the gate' : loading ? 'Asking the gate…' : 'Live preview · same rules'}</span>
        {answer && <span className="font-mono text-ink/65">{answer.receipt.id}</span>}
      </div>

      {/* Keep walks the slip toward the gate */}
      <div className="mt-3 flex items-end gap-3 sm:gap-5">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.img
            key={decision ?? 'calm'}
            src={`/assets/${decision ? POSE[decision] : 'keep-calm'}.webp`}
            alt=""
            width={150}
            height={150}
            className="size-24 shrink-0 sm:size-[140px]"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          />
        </AnimatePresence>
        <motion.div
          key={walkKey}
          className="mb-6 flex flex-col rounded-xl border border-hair bg-white px-3.5 py-2.5 shadow-[0_2px_0_var(--color-hair)]"
          initial={reduce ? false : { x: -40, opacity: 0, rotate: -3 }}
          animate={{ x: 0, opacity: 1, rotate: -3 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        >
          <span className="text-[11px] font-semibold tracking-[0.06em] text-ink/65">PAYMENT</span>
          <span className="font-mono text-[20px] font-semibold">{money(usd)}</span>
          <span className="max-w-[160px] truncate font-mono text-[12px] text-ink/65">→ {input.payTo.trim().slice(0, 6)}…{input.payTo.trim().slice(-4)}</span>
        </motion.div>
        <svg aria-hidden width="90" height="16" viewBox="0 0 90 16" className="mb-12 hidden shrink-0 sm:block">
          <path d="M2 8 H80" stroke="currentColor" strokeWidth="2" strokeDasharray="4 6" strokeLinecap="round" />
          <path d="M76 3 L84 8 L76 13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* The gate: one checkpoint per kind of rule */}
      <div className="mt-2 flex items-center gap-3" aria-hidden>
        <div className="h-2.5 flex-1 rounded-full bg-[repeating-linear-gradient(135deg,var(--color-ink)_0_12px,var(--color-gold)_12px_24px)]" />
        <span className="text-[12px] font-bold tracking-[0.08em]">THE GATE</span>
        <div className="h-2.5 flex-1 rounded-full bg-[repeating-linear-gradient(135deg,var(--color-ink)_0_12px,var(--color-gold)_12px_24px)]" />
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {checkpoints.map((c, i) => (
          <motion.li
            key={c.id}
            className={cn('flex min-w-0 flex-col gap-1.5 rounded-2xl p-3', CARD[c.light])}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduce ? 0 : 0.15 + i * 0.08, duration: 0.25 }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold">{c.label}</span>
              <motion.span
                key={`${walkKey}-${c.light}`}
                className={cn('size-3 shrink-0 rounded-full', LIGHT[c.light])}
                initial={reduce ? false : { scale: 0.3 }}
                animate={{ scale: 1 }}
                transition={{ delay: reduce ? 0 : 0.3 + i * 0.1, type: 'spring', stiffness: 500, damping: 18 }}
              >
                <span className="sr-only">{c.light === 'pass' ? 'passed' : c.light === 'hold' ? 'held' : c.light === 'stop' ? 'blocked' : 'not checked'}</span>
              </motion.span>
            </div>
            <span className="truncate font-mono text-[17px] font-semibold">{c.big}</span>
            {c.meter !== undefined && (
              <div className="relative h-1.5 rounded-full bg-hair" aria-hidden>
                <motion.div className={cn('h-1.5 rounded-full', LIGHT[c.light])} animate={{ width: `${c.meter * 100}%` }} transition={{ duration: reduce ? 0 : 0.4 }} />
                <span className="absolute top-[-3px] h-3 w-px bg-ink/40" style={{ left: `${(ASK_ABOVE / CAP) * 100}%` }} />
              </div>
            )}
            <span className="text-[12px] leading-snug text-ink/65">{c.small}</span>
          </motion.li>
        ))}
      </ul>

      {/* The stamp */}
      <div className="mt-6 flex min-h-[96px] flex-wrap items-center gap-x-6 gap-y-3">
        <AnimatePresence mode="wait">
          {decision ? (
            <motion.div
              key={`${decision}-${walkKey}`}
              className={cn('flex flex-col items-center rounded-2xl border-[5px] px-5 py-1.5', STAMP[decision])}
              initial={reduce ? false : { scale: 1.6, opacity: 0, rotate: -14 }}
              animate={{ scale: 1, opacity: 1, rotate: -6 }}
              exit={{ opacity: 0 }}
              transition={{ delay: reduce ? 0 : 0.8, type: 'spring', stiffness: 420, damping: 20 }}
            >
              <span className="text-[40px] font-extrabold leading-none tracking-tight sm:text-[48px]">{decision}</span>
              <span className="text-[11px] font-bold uppercase tracking-[0.12em]">{NOTE[decision]}</span>
            </motion.div>
          ) : (
            <p className="text-[15px] text-ink/65">Fill in an amount and an address to send Keep to the gate.</p>
          )}
        </AnimatePresence>
        {decision && codes.length > 0 && (
          <ul className="flex min-w-0 flex-wrap gap-1.5">
            {codes.map((c) => (
              <li key={c} className={cn('rounded-full px-2.5 py-1 font-mono text-[12px]', DENY.has(c) ? 'bg-[#FFF1EE] text-block' : 'bg-[#FFF7EB] text-[#9A5A00]')}>{c}</li>
            ))}
          </ul>
        )}
      </div>
      {!answer && decision && <p className="mt-3 text-[13px] text-ink/65">Preview only. Run the gate for the signed answer and a receipt you can verify.</p>}
    </div>
  )
}
