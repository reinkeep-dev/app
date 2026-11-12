import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import type { Decision, PremortemAnswer, Severity } from './premortem-api'

// The pre-mortem as a road: Keep starts at launch, every real risk from the answer is a hazard on the road
// (worst first, as the API sorts them), and the gate's decision is stamped at the finish.
// No times or odds are invented: the hazards are placed by order only, the cohort row uses the real counts.

const POSE: Record<Decision, string> = { ALLOW: 'keep-allow', REVIEW: 'keep-review', BLOCK: 'keep-block' }
const STAMP: Record<Decision, string> = { ALLOW: 'border-allow text-allow', REVIEW: 'border-review text-review', BLOCK: 'border-block text-block' }
const NOTE: Record<Decision, string> = { ALLOW: 'Agents would buy', REVIEW: 'A human decides', BLOCK: 'Agents would refuse' }
const DOT: Record<Severity, string> = { high: 'bg-block', medium: 'bg-review', low: 'bg-ink/30' }
const CARD: Record<Severity, string> = { high: 'bg-[#FFF1EE] ring-1 ring-block', medium: 'bg-[#FFF7EB] ring-1 ring-review', low: 'bg-white' }
const MAX_DOTS = 20

export function PremortemStage({ answer, loading }: { answer: PremortemAnswer | null; loading: boolean }) {
  const reduce = useReducedMotion()
  const risks = answer?.risks ?? []
  const decision = answer?.gate.decision ?? null
  const cohort = answer?.cohort ?? null
  const step = reduce ? 0 : 0.35
  const stampDelay = reduce ? 0 : 0.4 + risks.length * step
  const status = answer ? `${answer.draft.ticker}: ${risks.length} risk${risks.length === 1 ? '' : 's'} on the road` : loading ? 'Walking the road…' : 'Press run and Keep walks your launch'

  return (
    <div className="overflow-hidden rounded-[28px] bg-panel p-5 sm:p-7" aria-label="The launch road, step by step">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="font-medium text-ink/65">{status}</span>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-8">
        {/* Keep and the finish line */}
        <div className="flex min-w-0 items-center gap-3 sm:flex-col sm:items-start sm:gap-4">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.img
              key={decision ?? 'calm'}
              src={`/assets/${decision ? POSE[decision] : 'keep-calm'}.webp`}
              alt=""
              width={150}
              height={150}
              className="size-24 shrink-0 sm:size-[140px]"
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={loading && !reduce ? { opacity: 1, y: [0, -6, 0] } : { opacity: 1, y: 0 }}
              // Own transition: otherwise the exit inherits the loading bob's repeat: Infinity, never finishes,
              // and the old pose stays behind the new one, blinking.
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={loading && !reduce ? { duration: 0.7, repeat: Infinity } : { duration: 0.25 }}
            />
          </AnimatePresence>
          <div className="min-h-[88px]">
            <AnimatePresence mode="wait">
              {decision ? (
                <motion.div
                  key={`${decision}-${answer?.draft.ticker}-${risks.length}`}
                  className={cn('flex flex-col items-center rounded-2xl border-[5px] px-4 py-1.5 sm:px-5', STAMP[decision])}
                  initial={reduce ? false : { scale: 1.6, opacity: 0, rotate: -14 }}
                  animate={{ scale: 1, opacity: 1, rotate: -6 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: stampDelay, type: 'spring', stiffness: 420, damping: 20 }}
                >
                  <span className="text-[32px] font-extrabold leading-none tracking-tight sm:text-[40px]">{decision}</span>
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em]">{NOTE[decision]}</span>
                </motion.div>
              ) : (
                <p className="max-w-[200px] text-[14px] text-ink/65">{loading ? 'Counting what could go wrong…' : 'The verdict gets stamped at the finish.'}</p>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* The road */}
        <div className="min-w-0">
          <ol className="relative grid gap-2.5 pl-7">
            <span aria-hidden className="absolute bottom-3 left-[9px] top-3 w-0.5 bg-[repeating-linear-gradient(180deg,var(--color-ink)_0_6px,transparent_6px_12px)] opacity-30" />
            <RoadStop label="Launch" />
            {answer && risks.length === 0 && <li className="rounded-2xl bg-white p-3 text-[14px] text-ink/70">Clear road. None of our rules found a risk.</li>}
            {!answer &&
              [0, 1, 2].map((i) => (
                <li key={i} className="relative h-12 rounded-2xl border border-dashed border-ink/20">
                  <span aria-hidden className="absolute -left-7 top-1/2 size-3 -translate-y-1/2 rounded-full bg-ink/15 ring-4 ring-panel" />
                  {loading && !reduce && <motion.span aria-hidden className="absolute inset-0 rounded-2xl bg-ink/5" animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.25 }} />}
                </li>
              ))}
            {risks.map((r, i) => (
              <motion.li
                key={`${answer?.draft.ticker}-${r.code}`}
                className={cn('relative min-w-0 rounded-2xl p-3', CARD[r.severity])}
                initial={reduce ? false : { opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: reduce ? 0 : 0.2 + i * step, type: 'spring', stiffness: 300, damping: 24 }}
              >
                <motion.span
                  aria-hidden
                  className={cn('absolute -left-7 top-4 size-3 rounded-full ring-4 ring-panel', DOT[r.severity])}
                  initial={reduce ? false : { scale: 0.3 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: reduce ? 0 : 0.3 + i * step, type: 'spring', stiffness: 500, damping: 16 }}
                />
                <p className="text-[13px] font-semibold capitalize">
                  <span className={r.severity === 'high' ? 'text-block' : r.severity === 'medium' ? 'text-review' : 'text-ink/65'}>{r.severity}</span>
                  <span className="sr-only"> risk</span>
                </p>
                <p className="mt-0.5 text-[14px] leading-snug text-ink/80">{r.plain}</p>
              </motion.li>
            ))}
            <RoadStop label="24 hours later" />
          </ol>

          {cohort && cohort.n > 0 && <Cohort alive={cohort.alive} dead={cohort.dead} n={cohort.n} reduce={!!reduce} delay={stampDelay} />}
        </div>
      </div>
    </div>
  )
}

function RoadStop({ label }: { label: string }) {
  return (
    <li className="relative text-[12px] font-bold uppercase tracking-[0.1em] text-ink/65">
      <span aria-hidden className="absolute -left-7 top-1/2 size-5 -translate-x-1 -translate-y-1/2 rounded-full bg-gold ring-4 ring-panel" style={{ marginLeft: 4 }} />
      {label}
    </li>
  )
}

// One dot per past launch with similar liquidity (scaled down past 20), filled when it was still trading.
function Cohort({ alive, dead, n, reduce, delay }: { alive: number; dead: number; n: number; reduce: boolean; delay: number }) {
  const total = Math.min(n, MAX_DOTS)
  const live = Math.round((alive / n) * total)
  return (
    <div className="mt-5">
      <p className="text-[13px] text-ink/70">
        Of {n} past launches with similar liquidity, <span className="font-semibold text-allow">{alive} still trading</span>, <span className="font-semibold text-block">{dead} dead</span>.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <motion.span key={i} className={cn('size-3.5 rounded-full', i < live ? 'bg-allow' : 'bg-block/80')} initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: reduce ? 0 : delay + i * 0.03, type: 'spring', stiffness: 500, damping: 18 }} />
        ))}
      </div>
    </div>
  )
}
