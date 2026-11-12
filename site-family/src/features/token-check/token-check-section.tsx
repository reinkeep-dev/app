import { useEffect, useRef, useState, type FormEvent } from 'react'
import { motion } from 'motion/react'
import samples from '@data/sample-tokens.json'
import { cn } from '@/lib/utils'
import { ScrollReveal } from '@/components/scroll-reveal'
import { CheckError, fetchVerdict, isAddress, type CheckFailure, type Decision, type TokenFacts, type Verdict } from './token-check-api'

const WORD: Record<Decision, string> = { ALLOW: 'ALLOW', REVIEW: 'REVIEW', BLOCK: 'BLOCK' }
const TONE: Record<Decision, string> = { ALLOW: 'text-allow', REVIEW: 'text-review', BLOCK: 'text-block' }
const POSE: Record<Decision, string> = { ALLOW: 'keep-allow', REVIEW: 'keep-review', BLOCK: 'keep-block' }

const EXAMPLES = [
  { label: 'USDG', address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' },
  ...samples.tokens.map((t) => ({ label: t.ticker, address: t.token })),
]

const ERRORS: Record<CheckFailure, string> = {
  bad_address: 'That does not look like a token address. It starts with 0x and has 40 more characters.',
  limit: 'You used today’s 60 checks. Come back tomorrow.',
  not_live: 'This check goes live soon.',
  failed: 'Could not reach the checker just now. Try again in a moment.',
}

const FACT_ROWS: [keyof TokenFacts, string][] = [
  ['is_contract', 'Is a contract'],
  ['mint_with_live_owner', 'Owner can mint more'],
  ['has_blacklist', 'Can blacklist wallets'],
  ['has_pause', 'Can pause transfers'],
  ['is_proxy', 'Is a proxy'],
  ['has_upgrade', 'Code can be upgraded'],
  ['ticker_clone_of_older', 'Copies an older ticker'],
]

const yesNo = (v: boolean | null | undefined) => (v === true ? 'Yes' : v === false ? 'No' : 'Unknown')
const usd = (v: number | null | undefined) =>
  typeof v === 'number' ? v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : 'Unknown'

type State = { phase: 'idle' } | { phase: 'loading' } | { phase: 'error'; kind: CheckFailure } | { phase: 'done'; verdict: Verdict }

export function TokenCheckSection() {
  const [value, setValue] = useState('')
  const [state, setState] = useState<State>({ phase: 'idle' })
  const [touched, setTouched] = useState(false)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const trimmed = value.trim()
  const invalid = touched && trimmed !== '' && !isAddress(trimmed)
  const loading = state.phase === 'loading'

  async function run(address: string) {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setState({ phase: 'loading' })
    try {
      const verdict = await fetchVerdict(address, ctl.signal)
      setState({ phase: 'done', verdict })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setState({ phase: 'error', kind: e instanceof CheckError ? e.kind : 'failed' })
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!isAddress(trimmed)) return
    void run(trimmed)
  }

  function pick(address: string) {
    setValue(address)
    setTouched(true)
    void run(address)
  }

  return (
    <section id="check" aria-label="Token check">
      <div className="mx-auto max-w-[1040px] px-5 pb-20 pt-6">
        <ScrollReveal>
          <form onSubmit={submit} noValidate className="max-w-[680px]">
            <label htmlFor="check-address" className="block text-[15px] font-medium">Token address</label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <input
                id="check-address"
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="0x…"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => setTouched(true)}
                onPaste={() => setTouched(true)}
                aria-invalid={invalid}
                aria-describedby={invalid ? 'check-address-error' : undefined}
                className={cn(
                  'min-h-12 w-full min-w-0 rounded-xl bg-panel px-4 font-mono text-[15px] outline-none ring-2 ring-transparent transition-shadow placeholder:text-ink/40 focus-visible:ring-ink',
                  invalid && 'ring-block',
                )}
              />
              <button
                type="submit"
                disabled={loading}
                className="min-h-12 shrink-0 rounded-full bg-ink px-6 text-[15px] font-medium text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.97] disabled:opacity-60"
              >
                {loading ? 'Checking…' : 'Check'}
              </button>
            </div>
            {invalid && (
              <p id="check-address-error" className="mt-2 text-[14px] text-block">
                {ERRORS.bad_address}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-[14px]">
              <span className="text-ink/60">Try one:</span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.address}
                  type="button"
                  onClick={() => pick(ex.address)}
                  disabled={loading}
                  title={ex.address}
                  className="min-h-10 rounded-full border border-hair px-4 font-mono text-[13px] outline-none transition-colors hover:bg-panel focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-60"
                >
                  {ex.label}
                </button>
              ))}
            </div>
            <p className="mt-4 text-[13px] text-ink/60">Free, 60 checks a day. Rules decide; AI only explains.</p>
          </form>
        </ScrollReveal>

        <div className="mt-8" aria-live="polite" aria-busy={loading}>
          {state.phase === 'loading' && <p className="text-[15px] text-ink/60">Reading the contract…</p>}
          {state.phase === 'error' && state.kind !== 'bad_address' && (
            <p role="status" className="max-w-[680px] rounded-2xl bg-panel p-5 text-[15px] text-ink/80">
              {ERRORS[state.kind]}
            </p>
          )}
          {state.phase === 'done' && <ResultCard verdict={state.verdict} />}
        </div>
      </div>
    </section>
  )
}

function ResultCard({ verdict }: { verdict: Verdict }) {
  const { decision, facts, reasons, explanation } = verdict
  const symbol = facts.symbol
  return (
    <motion.div
      key={verdict.token + verdict.checkedAt}
      className="max-w-[760px] rounded-2xl border border-hair bg-white p-5 shadow-sm"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0.7, 0.1, 1] }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink/60">{symbol ? `${symbol} · ` : ''}The gate answers</p>
          <p className={cn('mt-1 text-[48px] font-semibold leading-none tracking-tight min-[400px]:text-[64px]', TONE[decision])}>{WORD[decision]}</p>
          <p className="mt-2 break-all font-mono text-[12.5px] text-ink/60">{verdict.token}</p>
        </div>
        <img src={`/assets/${POSE[decision]}.webp`} alt="" width={110} height={110} className="size-20 shrink-0 sm:size-[110px]" />
      </div>

      <div className="mt-5">
        <p className="text-[13px] font-medium text-ink/60">{explanation.source === 'ai' ? 'Explained by AI' : 'From the rules'}</p>
        <p className="mt-1 text-[16px] leading-relaxed">{explanation.text}</p>
      </div>

      <h3 className="mt-5 text-[13px] font-medium text-ink/60">Reasons</h3>
      <ul className="mt-1 divide-y divide-hair border-y border-hair text-[14px]">
        {reasons.length === 0 && <li className="py-2.5 text-ink/60">No rule fired.</li>}
        {reasons.map((r) => (
          <li key={r.code} className="grid gap-1 py-2.5 sm:grid-cols-[210px_1fr] sm:gap-3">
            <code className="break-words font-mono text-[13px] text-ink">{r.code}</code>
            <span className="text-ink/70">{r.plain}</span>
          </li>
        ))}
      </ul>

      <h3 className="mt-5 text-[13px] font-medium text-ink/60">What we could read</h3>
      <dl className="mt-1 divide-y divide-hair border-y border-hair text-[14px]">
        {FACT_ROWS.map(([key, label]) => (
          <Fact key={key} label={label} value={yesNo(facts[key] as boolean | null | undefined)} />
        ))}
        <Fact label="Liquidity seen" value={usd(facts.seen_liquidity_usd)} />
      </dl>
    </motion.div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-ink/70">{label}</dt>
      <dd className={cn('font-mono text-[13px]', value === 'Unknown' ? 'text-ink/60' : 'text-ink')}>{value}</dd>
    </div>
  )
}
