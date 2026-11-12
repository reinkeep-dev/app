import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import type { Autopsy } from './launches-api'

type Look = { word: string; note: string; pose: string; stamp: string; stroke: string }
const LOOK: Record<string, Look> = {
  liquidity_pulled: { word: 'PULLED', note: 'The money was taken out', pose: 'keep-block', stamp: 'border-block text-block', stroke: 'var(--color-block)' },
  never_lived: { word: 'NEVER LIVED', note: 'Nobody ever traded', pose: 'keep-block', stamp: 'border-block text-block', stroke: 'var(--color-block)' },
  faded: { word: 'FADED', note: 'Trading dried up', pose: 'keep-review', stamp: 'border-review text-review', stroke: 'var(--color-review)' },
  still_trading: { word: 'STILL TRADING', note: 'Alive a day later', pose: 'keep-allow', stamp: 'border-allow text-allow', stroke: 'var(--color-allow)' },
}
const FALLBACK: Look = { word: 'UNKNOWN', note: 'No clear pattern', pose: 'keep-calm', stamp: 'border-ink/50 text-ink/65', stroke: 'var(--color-ink)' }
const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const W = 320, H = 150, X0 = 28, X1 = 292, TOP = 28, BASE = 120

// Liquidity at first sight and a day later, joined by one line. Idle: an empty chart waiting for a token.
export function AutopsyStage({ data, loading }: { data: Autopsy | null; loading: boolean }) {
  const reduce = useReducedMotion()
  const look = data ? (LOOK[data.pattern] ?? FALLBACK) : null
  const a = data?.firstSeen.liquidityUsd ?? null
  const b = data?.dayLater?.liquidityUsd ?? null
  const top = Math.max(a ?? 0, b ?? 0, 1)
  const y = (v: number) => BASE - (v / top) * (BASE - TOP)
  const hasLine = a !== null && b !== null
  const pose = look?.pose ?? 'keep-calm'
  const key = data ? `${data.token}-${data.pattern}` : loading ? 'loading' : 'idle'

  const label = data
    ? `Liquidity of ${data.symbol ?? 'the token'}: ${a === null ? 'unknown' : money(a)} when first seen, ${b === null ? 'unknown' : money(b)} a day later. Pattern: ${look?.word}.`
    : 'Empty chart. Look up a token to see its liquidity from first seen to a day later.'

  return (
    <div className="mb-6 max-w-[680px] overflow-hidden rounded-[28px] bg-panel p-5 sm:p-7">
      <div className="flex items-center justify-between gap-3 text-[13px] font-medium text-ink/65">
        <span>{data ? 'Liquidity, first seen to a day later' : loading ? 'Reading the pool…' : 'Waiting for a token'}</span>
      </div>
      <div className="mt-3 flex items-end gap-3">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.img key={pose} src={`/assets/${pose}.webp`} alt="" width={120} height={120} className="size-14 shrink-0 sm:size-[110px]" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />
        </AnimatePresence>
        <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} className="min-w-0 flex-1">
          <line x1={X0} x2={X1} y1={BASE} y2={BASE} stroke="currentColor" strokeOpacity="0.8" strokeWidth="2" strokeLinecap="round" />
          <line x1={X0} x2={X0} y1={TOP - 8} y2={BASE} stroke="var(--color-hair)" strokeWidth="2" strokeDasharray="3 5" />
          <line x1={X1} x2={X1} y1={TOP - 8} y2={BASE} stroke="var(--color-hair)" strokeWidth="2" strokeDasharray="3 5" />
          <text x={X0} y={H - 8} textAnchor="middle" fontSize="12" fill="currentColor" fillOpacity="0.6">first seen</text>
          <text x={X1} y={H - 8} textAnchor="middle" fontSize="12" fill="currentColor" fillOpacity="0.6">24h later</text>
          {!data && <line x1={X0} x2={X1} y1={(TOP + BASE) / 2} y2={(TOP + BASE) / 2} stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" strokeDasharray="2 9" strokeLinecap="round" />}
          {data && look && a !== null && (
            <g key={key}>
              {hasLine && (
                <>
                  <motion.path d={`M${X0} ${y(a)} L${X1} ${y(b)} L${X1} ${BASE} L${X0} ${BASE} Z`} fill={look.stroke} fillOpacity="0.1" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduce ? 0 : 0.9 }} />
                  <motion.path d={`M${X0} ${y(a)} L${X1} ${y(b)}`} fill="none" stroke={look.stroke} strokeWidth="3.5" strokeLinecap="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.25, duration: 0.8, ease: 'easeIn' }} />
                </>
              )}
              <circle cx={X0} cy={y(a)} r="5" fill={look.stroke} />
              <text x={X0 + 8} y={y(a) - 8} fontSize="13" fontWeight="600" fill="currentColor" className="font-mono">{money(a)}</text>
              {b !== null && (
                <motion.g initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduce ? 0 : 1 }}>
                  <circle cx={X1} cy={y(b)} r="5" fill={look.stroke} />
                  <text x={X1 - 8} y={b < top / 2 ? y(b) - 10 : y(b) + 20} textAnchor="end" fontSize="13" fontWeight="600" fill="currentColor" className="font-mono">{money(b)}</text>
                </motion.g>
              )}
            </g>
          )}
        </svg>
      </div>
      <div className="mt-4 flex min-h-[72px] flex-wrap items-center gap-x-5 gap-y-2">
        {data && look ? (
          <motion.div key={key} className={cn('flex flex-col items-center rounded-2xl border-[5px] px-5 py-1.5', look.stamp)} initial={reduce ? false : { scale: 1.7, opacity: 0, rotate: -14 }} animate={{ scale: 1, opacity: 1, rotate: -5 }} transition={{ delay: reduce ? 0 : 1.05, type: 'spring', stiffness: 420, damping: 20 }}>
            <span className="text-[28px] font-extrabold leading-none tracking-tight sm:text-[36px]">{look.word}</span>
            <span className="text-[11px] font-bold uppercase tracking-[0.12em]">{look.note}</span>
          </motion.div>
        ) : (
          <p className="text-[15px] text-ink/65">Paste a token address below. Keep draws its liquidity and stamps what happened.</p>
        )}
        {data && !hasLine && <p className="text-[13px] text-ink/65">{a === null ? 'No liquidity reading when first seen.' : 'Not re-checked a day later yet, so there is no line.'}</p>}
      </div>
    </div>
  )
}
