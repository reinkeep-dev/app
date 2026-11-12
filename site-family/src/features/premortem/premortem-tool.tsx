import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { ScrollReveal } from '@/components/scroll-reveal'
import { PremortemStage } from './premortem-stage'
import { PremortemError, runPremortem, type Draft, type PremortemAnswer, type PremortemFailure, type Severity } from './premortem-api'

const TONE = { ALLOW: 'text-allow', REVIEW: 'text-review', BLOCK: 'text-block' } as const
const SEVERITY_TONE: Record<Severity, string> = { high: 'text-block', medium: 'text-review', low: 'text-ink/65' }
const ERRORS: Record<PremortemFailure, string> = {
  limit: 'You used today’s 60 pre-mortems. Come back tomorrow.',
  not_live: 'The pre-mortem goes live with the next update of the gate.',
  rejected: 'The gate could not read that draft.',
  failed: 'Could not reach the gate. Try again in a moment; if it keeps failing, try another connection.',
}

type Powers = Draft['contract']
const POWERS: [keyof Powers, string][] = [
  ['mint', 'The contract can mint more tokens'],
  ['ownerRenounced', 'The owner is renounced'],
  ['pause', 'Transfers can be paused'],
  ['blacklist', 'Wallets can be blacklisted'],
  ['upgradeable', 'The code can be upgraded (proxy)'],
]

type Numbers = { buyTaxPct: string; sellTaxPct: string; teamAllocationPct: string; liquidityUsd: string; liquidityLockDays: string }
const NUMBERS: [keyof Numbers, string, string][] = [
  ['buyTaxPct', 'Buy tax', '%'],
  ['sellTaxPct', 'Sell tax', '%'],
  ['teamAllocationPct', 'Team share of supply', '%'],
  ['liquidityUsd', 'Starting liquidity', 'USD'],
  ['liquidityLockDays', 'Liquidity locked for', 'days'],
]

type State = { phase: 'idle' } | { phase: 'loading' } | { phase: 'error'; kind: PremortemFailure; detail?: string } | { phase: 'done'; answer: PremortemAnswer }

const field = 'min-h-12 w-full min-w-0 rounded-xl bg-panel px-4 text-[15px] outline-none ring-2 ring-transparent transition-shadow placeholder:text-ink/40 focus-visible:ring-ink'

export function PremortemTool() {
  const [ticker, setTicker] = useState('')
  const [powers, setPowers] = useState<Powers>({ mint: false, ownerRenounced: true, pause: false, blacklist: false, upgradeable: false })
  const [nums, setNums] = useState<Numbers>({ buyTaxPct: '0', sellTaxPct: '0', teamAllocationPct: '5', liquidityUsd: '5000', liquidityLockDays: '180' })
  const [state, setState] = useState<State>({ phase: 'idle' })
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const loading = state.phase === 'loading'

  const parsed = Object.fromEntries(NUMBERS.map(([k]) => [k, Number(nums[k])])) as Record<keyof Numbers, number>
  const badNumber = NUMBERS.find(([k]) => nums[k].trim() === '' || !Number.isFinite(parsed[k]) || parsed[k] < 0)
  const badTicker = ticker.trim() === ''

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (badTicker || badNumber) return
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setState({ phase: 'loading' })
    try {
      const answer = await runPremortem({ ticker: ticker.trim(), contract: powers, ...parsed }, ctl.signal)
      setState({ phase: 'done', answer })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setState(err instanceof PremortemError ? { phase: 'error', kind: err.kind, detail: err.detail } : { phase: 'error', kind: 'failed' })
    }
  }

  return (
    <section aria-label="Pre-mortem" className="mx-auto max-w-[1040px] px-5 pb-20 pt-6">
      <ScrollReveal>
        <form onSubmit={submit} noValidate className="grid max-w-[760px] gap-8">
          <div>
            <label htmlFor="pm-ticker" className="block text-[15px] font-medium">Ticker</label>
            <input id="pm-ticker" className={cn(field, 'mt-2 max-w-[280px] font-mono uppercase')} value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="KEEP" maxLength={32} autoComplete="off" spellCheck={false} />
          </div>

          <fieldset>
            <legend className="text-[15px] font-medium">What the contract can do</legend>
            <div className="mt-2 divide-y divide-hair border-y border-hair">
              {POWERS.map(([k, label]) => (
                <label key={k} className="flex min-h-12 cursor-pointer items-center justify-between gap-4 text-[15px]">
                  <span className="text-ink/80">{label}</span>
                  <input type="checkbox" checked={powers[k]} onChange={(e) => setPowers({ ...powers, [k]: e.target.checked })} className="size-5 shrink-0 accent-ink" />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-[15px] font-medium">Numbers at launch</legend>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              {NUMBERS.map(([k, label, unit]) => (
                <div key={k}>
                  <label htmlFor={`pm-${k}`} className="block text-[14px] text-ink/70">
                    {label} <span className="text-ink/65">({unit})</span>
                  </label>
                  <input id={`pm-${k}`} inputMode="decimal" className={cn(field, 'mt-1 font-mono', badNumber?.[0] === k && 'ring-block')} value={nums[k]} onChange={(e) => setNums({ ...nums, [k]: e.target.value })} />
                </div>
              ))}
            </div>
          </fieldset>

          <div>
            <button type="submit" disabled={loading || badTicker || !!badNumber} className="min-h-12 rounded-full bg-ink px-6 text-[15px] font-medium text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.97] disabled:opacity-50">
              {loading ? 'Reading the draft…' : 'Run the pre-mortem'}
            </button>
            <p className="mt-3 text-[13px] text-ink/65">Free, 60 a day. Nothing you type is stored.</p>
          </div>
        </form>
      </ScrollReveal>

      <div className="mt-10 max-w-[1040px]" aria-live="polite" aria-busy={loading}>
        {state.phase !== 'error' && <PremortemStage answer={state.phase === 'done' ? state.answer : null} loading={loading} />}
        <div className="mt-6" />
        {state.phase === 'error' && (
          <p role="status" className="max-w-[760px] rounded-2xl bg-panel p-5 text-[15px] text-ink/80">
            {ERRORS[state.kind]} {state.detail}
          </p>
        )}
        {state.phase === 'done' && <PremortemReport answer={state.answer} />}
      </div>
    </section>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-6">
      <h3 className="text-[13px] font-medium text-ink/65">{title}</h3>
      {children}
    </div>
  )
}

function PremortemReport({ answer }: { answer: PremortemAnswer }) {
  const { gate, risks, ticker, cohort } = answer
  return (
    <motion.div className="max-w-[760px] rounded-2xl border border-hair bg-white p-5 shadow-sm" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.2, 0.7, 0.1, 1] }}>
      <p className="text-[13px] font-medium text-ink/65">{answer.draft.ticker} · Agents buying it would get</p>
      <p className={cn('mt-1 text-[48px] font-semibold leading-none tracking-tight min-[400px]:text-[64px]', TONE[gate.decision])}>{gate.decision}</p>

      <Block title={`Risks, worst first (${risks.length})`}>
        <ul className="mt-1 divide-y divide-hair border-y border-hair text-[14px]">
          {risks.length === 0 && <li className="py-3 text-ink/65">None of our rules found a risk in this draft.</li>}
          {risks.map((r) => (
            <li key={r.code} className="py-3">
              <p>
                <span className={cn('font-semibold capitalize', SEVERITY_TONE[r.severity])}>{r.severity}</span>
                <span className="text-ink/65"> · {r.basis}</span>
              </p>
              <p className="mt-1 text-ink/80">{r.plain}</p>
              {r.fix && <p className="mt-1 text-ink/65">Fix: {r.fix}</p>}
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Ticker">
        <p className="mt-1 text-[15px] text-ink/80">
          {!ticker.checked
            ? 'Not checked: launch data is not available right now.'
            : ticker.earlierTokens
              ? `${ticker.earlierTokens} token${ticker.earlierTokens === 1 ? '' : 's'} on the chain already use this ticker. Agents will see yours as a copy.`
              : 'No token we have seen uses this ticker.'}
        </p>
      </Block>

      <Block title="Launches that started with similar liquidity">
        <p className="mt-1 text-[15px] text-ink/80">{cohort ? cohort.note : 'Launch data is not available right now.'}</p>
      </Block>
    </motion.div>
  )
}
