import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import type { Wave } from './launches-api'

const PERIOD = 6 // seconds per sweep

// A ticker always lands on the same spot: angle and distance come from its letters, size from the number of copies.
function spot(ticker: string) {
  let h = 2166136261
  for (const c of ticker) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  const u = (h >>> 0) / 4294967296
  const v = (Math.imul(h, 2654435761) >>> 0) / 4294967296
  return { angle: u * 360, dist: 0.3 + v * 0.55 }
}

// Rotating sweep. Each ticker with copies is a blip that shows up when the sweep first passes it.
export function RadarScope({ waves, active, onActive }: { waves: Wave[]; active: string | null; onActive: (t: string | null) => void }) {
  const reduce = useReducedMotion()
  const max = Math.max(1, ...waves.map((w) => w.recentTokens))
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[380px] rounded-full bg-panel p-3">
      <div className="relative size-full overflow-hidden rounded-full">
        <svg aria-hidden viewBox="0 0 100 100" className="absolute inset-0 size-full">
          {[16, 32, 48].map((r) => <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="var(--color-hair)" strokeWidth="0.8" />)}
          <path d="M50 2 V98 M2 50 H98" stroke="var(--color-hair)" strokeWidth="0.8" />
        </svg>
        {!reduce && (
          <motion.div aria-hidden className="absolute inset-0" animate={{ rotate: 360 }} transition={{ duration: PERIOD, repeat: Infinity, ease: 'linear' }}>
            <svg viewBox="0 0 100 100" className="size-full">
              <path d="M50 50 L50 2 A48 48 0 0 0 26 8.4 Z" fill="var(--color-allow)" fillOpacity="0.2" />
              <path d="M50 50 V2" stroke="var(--color-allow)" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </motion.div>
        )}
        <img src="/assets/keep-calm.webp" alt="" width={48} height={48} className="absolute left-1/2 top-1/2 size-12 -translate-x-1/2 -translate-y-1/2" />
        {waves.map((w) => {
          const { angle, dist } = spot(w.ticker)
          const rad = (angle * Math.PI) / 180
          const x = 50 + Math.sin(rad) * dist * 48
          const y = 50 - Math.cos(rad) * dist * 48
          const size = 16 + Math.sqrt(w.recentTokens / max) * 26
          const on = active === w.ticker
          return (
            <motion.button
              key={w.ticker}
              type="button"
              aria-label={`${w.ticker}, ${w.recentTokens} new copies`}
              aria-pressed={on}
              onMouseEnter={() => onActive(w.ticker)}
              onMouseLeave={() => onActive(null)}
              onFocus={() => onActive(w.ticker)}
              onBlur={() => onActive(null)}
              onClick={() => onActive(on ? null : w.ticker)}
              className={cn('absolute flex items-center justify-center rounded-full border-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2', on ? 'z-10 border-ink bg-gold' : 'border-gold bg-gold/55')}
              style={{ left: `${x}%`, top: `${y}%`, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}
              initial={reduce ? false : { scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: reduce ? 0 : (angle / 360) * PERIOD, type: 'spring', stiffness: 380, damping: 14 }}
            >
              {size > 30 && <span className="font-mono text-[10px] font-bold">{w.recentTokens}</span>}
            </motion.button>
          )
        })}
      </div>
      <p aria-hidden className="absolute inset-x-0 bottom-1 text-center font-mono text-[12px] font-semibold text-ink/70">{active ?? ' '}</p>
    </div>
  )
}
