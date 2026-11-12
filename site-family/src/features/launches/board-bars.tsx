import { motion, useReducedMotion } from 'motion/react'
import type { BoardDay } from './launches-api'

// Per day: three bars growing from the baseline. Seen (grey), re-checked a day later (gold), still trading (green).
const BARS = [
  { key: 'pools', cls: 'bg-ink/20', label: 'Seen' },
  { key: 'outcomes', cls: 'bg-gold', label: 'Re-checked a day later' },
  { key: 'alive', cls: 'bg-allow', label: 'Still trading' },
] as const

export function BoardBars({ days }: { days: BoardDay[] }) {
  const reduce = useReducedMotion()
  const max = Math.max(1, ...days.map((d) => d.pools))
  const summary = `Bars for ${days.length} days: launches seen, re-checked a day later, still trading. The numbers are in the list below.`
  return (
    <div className="mb-6 rounded-[28px] bg-panel p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-[13px]">
        <span className="font-medium text-ink/65">Last {days.length} days, one column each</span>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-ink/70">
          {BARS.map((b) => (
            <li key={b.key} className="flex items-center gap-1.5">
              <span aria-hidden className={`size-2.5 rounded-[3px] ${b.cls}`} />
              {b.label}
            </li>
          ))}
        </ul>
      </div>
      <div role="img" aria-label={summary} className="mt-5 grid grid-flow-col auto-cols-fr gap-1 sm:gap-2">
        {[...days].reverse().map((d, i) => (
          <div key={d.day} className="flex min-w-0 flex-col items-center gap-1.5" title={`${d.day}: ${d.pools} seen, ${d.outcomes} re-checked, ${d.alive} still trading`}>
            <div className="flex h-[150px] w-full items-end justify-center gap-[2px] border-b-2 border-ink/80 sm:h-[200px]">
              {BARS.map((b, k) => {
                const v = b.key === 'alive' ? d.alive : d[b.key]
                return (
                  <motion.span
                    key={b.key}
                    className={`block w-full max-w-3 origin-bottom rounded-t-[3px] ${b.cls}`}
                    style={{ height: v > 0 ? `max(3px, ${(v / max) * 100}%)` : 0 }}
                    initial={reduce ? false : { scaleY: 0 }}
                    whileInView={{ scaleY: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: reduce ? 0 : i * 0.04 + k * 0.07, type: 'spring', stiffness: 160, damping: 20 }}
                  />
                )
              })}
            </div>
            <span aria-hidden className="font-mono text-[10px] text-ink/65 sm:text-[11px]">{d.day.slice(-2)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
