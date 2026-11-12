import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import type { Decision, TokenFacts, Verdict } from './token-check-api'

// The check as a scene: Keep holds the contract card, a magnifier sweeps it while we wait,
// then every fact the API really returned lands as a tick / hold / cross line and a stamp comes down.

type Mark = 'tick' | 'hold' | 'cross'
type Line = { key: string; label: string; value: string; mark: Mark }

const POSE: Record<Decision, string> = { ALLOW: 'keep-allow', REVIEW: 'keep-review', BLOCK: 'keep-block' }
const STAMP: Record<Decision, string> = { ALLOW: 'border-allow text-allow', REVIEW: 'border-review text-review', BLOCK: 'border-block text-block' }
const NOTE: Record<Decision, string> = { ALLOW: 'Looks safe', REVIEW: 'Look closer', BLOCK: 'Stay away' }
const DOT: Record<Mark, string> = { tick: 'bg-allow', hold: 'bg-review', cross: 'bg-block' }
const MARK_TEXT: Record<Mark, string> = { tick: 'ok', hold: 'check', cross: 'bad' }

// `good` = the value we want. `bad` = marks a hard cross when it is the value; otherwise a mismatch is only a hold.
const FACTS: { key: keyof TokenFacts; label: string; good: boolean; hard: boolean }[] = [
  { key: 'is_contract', label: 'Is a contract', good: true, hard: true },
  { key: 'mint_with_live_owner', label: 'Owner can mint more', good: false, hard: true },
  { key: 'has_blacklist', label: 'Can blacklist wallets', good: false, hard: true },
  { key: 'has_pause', label: 'Can pause transfers', good: false, hard: false },
  { key: 'is_proxy', label: 'Is a proxy', good: false, hard: false },
  { key: 'has_upgrade', label: 'Code can be upgraded', good: false, hard: false },
  { key: 'ticker_clone_of_older', label: 'Copies an older ticker', good: false, hard: true },
]

function toLines(facts: TokenFacts): Line[] {
  const lines = FACTS.map<Line>(({ key, label, good, hard }) => {
    const v = facts[key] as boolean | null | undefined
    if (v === null || v === undefined) return { key, label, value: 'Unknown', mark: 'hold' }
    const ok = v === good
    return { key, label, value: v ? 'Yes' : 'No', mark: ok ? 'tick' : hard ? 'cross' : 'hold' }
  })
  const liq = facts.seen_liquidity_usd
  lines.push(
    typeof liq === 'number'
      ? { key: 'liq', label: 'Liquidity seen', value: liq.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }), mark: liq > 0 ? 'tick' : 'hold' }
      : { key: 'liq', label: 'Liquidity seen', value: 'Unknown', mark: 'hold' },
  )
  return lines
}

function MarkIcon({ mark }: { mark: Mark }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      {mark === 'tick' && <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />}
      {mark === 'hold' && <path d="M4 8h8" />}
      {mark === 'cross' && <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />}
    </svg>
  )
}

export function TokenCheckScanner({ address, loading, verdict }: { address: string; loading: boolean; verdict: Verdict | null }) {
  const reduce = useReducedMotion()
  const shown = verdict?.token ?? address
  const lines = verdict ? toLines(verdict.facts) : []
  const step = reduce ? 0 : 0.14
  const stampDelay = reduce ? 0 : 0.25 + lines.length * step

  return (
    <div className="overflow-hidden rounded-[28px] bg-panel p-5 sm:p-7">
      <p className="text-[13px] font-medium text-ink/65" aria-hidden>
        {verdict ? 'The gate read this contract' : loading ? 'Reading the contract…' : 'Waiting for a token'}
      </p>

      <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-8">
        <div className="flex min-w-0 items-end gap-3 sm:w-[46%] sm:flex-col sm:items-stretch sm:gap-4">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.img
              key={verdict ? verdict.decision : 'calm'}
              src={`/assets/${verdict ? POSE[verdict.decision] : 'keep-calm'}.webp`}
              alt=""
              width={140}
              height={140}
              className="size-20 shrink-0 sm:size-[120px]"
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            />
          </AnimatePresence>

          {/* The contract card, with the magnifier sweeping over it */}
          <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl sm:flex-none border border-hair bg-white px-3.5 py-3 shadow-[0_2px_0_var(--color-hair)]">
            <span className="text-[11px] font-semibold tracking-[0.06em] text-ink/65">CONTRACT</span>
            <span className="mt-0.5 block break-all font-mono text-[12.5px] leading-snug text-ink/80">{shown || '0x…'}</span>
            {verdict?.facts.symbol && <span className="mt-1 block font-mono text-[15px] font-semibold">{verdict.facts.symbol}</span>}
            <div className="mt-2.5 space-y-1.5" aria-hidden>
              {[72, 54, 64].map((w) => (
                <div key={w} className="h-1.5 rounded-full bg-hair" style={{ width: `${w}%` }} />
              ))}
            </div>
            {loading && !reduce && (
              <motion.svg
                aria-hidden
                viewBox="0 0 48 48"
                className="pointer-events-none absolute top-1 size-12 text-ink"
                initial={{ left: '0%' }}
                animate={{ left: ['0%', 'calc(100% - 48px)', '0%'], rotate: [-8, 8, -8] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              >
                <circle cx="20" cy="20" r="13" fill="#F5B731" fillOpacity="0.25" stroke="currentColor" strokeWidth="3.5" />
                <path d="M30 30 42 42" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
              </motion.svg>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {verdict ? (
            <ul className="divide-y divide-hair rounded-2xl bg-white px-3.5">
              {lines.map((l, i) => (
                <motion.li
                  key={`${verdict.token}-${verdict.checkedAt}-${l.key}`}
                  className="flex items-center gap-3 py-2 text-[14px]"
                  initial={reduce ? false : { opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * step, duration: 0.22 }}
                >
                  <motion.span
                    className={cn('grid size-5 shrink-0 place-items-center rounded-full', DOT[l.mark])}
                    initial={reduce ? false : { scale: 0.3 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.15 + i * step, type: 'spring', stiffness: 500, damping: 18 }}
                  >
                    <MarkIcon mark={l.mark} />
                    <span className="sr-only">{MARK_TEXT[l.mark]}</span>
                  </motion.span>
                  <span className="min-w-0 flex-1 text-ink/80">{l.label}</span>
                  <span className={cn('font-mono text-[13px]', l.value === 'Unknown' ? 'text-ink/65' : 'text-ink')}>{l.value}</span>
                </motion.li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl border border-dashed border-ink/20 px-4 py-5 text-[14px] text-ink/65">
              {loading ? 'Each check shows up here as soon as the answer is in.' : 'Paste an address or pick a sample. Keep reads the contract and ticks off each check.'}
            </p>
          )}

          <div className="mt-5 min-h-[88px]">
            {verdict && (
              <motion.div
                key={`${verdict.decision}-${verdict.token}-${verdict.checkedAt}`}
                className={cn('inline-flex flex-col items-center rounded-2xl border-[5px] px-5 py-1.5', STAMP[verdict.decision])}
                initial={reduce ? false : { scale: 1.6, opacity: 0, rotate: -14 }}
                animate={{ scale: 1, opacity: 1, rotate: -6 }}
                transition={{ delay: stampDelay, type: 'spring', stiffness: 420, damping: 20 }}
              >
                <span className="text-[40px] font-extrabold leading-none tracking-tight sm:text-[48px]">{verdict.decision}</span>
                <span className="text-[11px] font-bold uppercase tracking-[0.12em]">{NOTE[verdict.decision]}</span>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
