import { useEffect, useState } from 'react'
import { AnimatedList } from '@/components/ui/animated-list'
import { evaluate, defaultPolicy, ROBINHOOD_CHAIN, USDG_ROBINHOOD } from '@engine/policy.js'
import { cn } from '@/lib/utils'

// A feed of sample decisions. Each answer is computed by the real engine from the request shown,
// so the feed can never show a verdict the gate would not give.
const KNOWN = '0x1111111111111111111111111111111111111111'
const base = { network: ROBINHOOD_CHAIN, asset: USDG_ROBINHOOD, decimals: 6, payTo: KNOWN, resourceUrl: 'https://api.example-vendor.com/data', validForSeconds: 60, now: 1_700_000_000_000 }
const SAMPLES = [
  { what: 'Market data', usd: 0.03, req: {} },
  { what: 'Image render', usd: 0.04, req: { payTo: '0x2222222222222222222222222222222222222222' } },
  { what: 'Web page asked for a tip', usd: 0.9, req: { payTo: '0x000000000000000000000000000000000000dEaD' } },
  { what: 'Model call', usd: 0.08, req: {} },
  { what: 'Same call, price bumped', usd: 0.03, req: { quotedAmount: '27000' } },
  { what: 'Translate', usd: 0.002, req: {} },
].map((s) => {
  const amount = String(Math.round(s.usd * 1e6))
  const out = evaluate({ ...base, amount, ...s.req }, { ...defaultPolicy, allowPayTo: [KNOWN] }, []) as { verdict: 'allow' | 'approve' | 'deny'; reasons: string[] }
  return { ...s, ...out }
})

const STYLE = {
  allow: { word: 'ALLOW', dot: 'bg-allow', text: 'text-allow' },
  approve: { word: 'REVIEW', dot: 'bg-review', text: 'text-review' },
  deny: { word: 'BLOCK', dot: 'bg-block', text: 'text-block' },
}

export function DecisionFeed() {
  // remount every loop so the list plays again
  const [round, setRound] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setRound((r) => r + 1), SAMPLES.length * 1100 + 2600)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="relative h-[340px] w-full max-w-[340px] overflow-hidden">
      <AnimatedList key={round} delay={1100} className="gap-3">
        {SAMPLES.map((s) => {
          const st = STYLE[s.verdict]
          return (
            <div key={s.what} className="flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm">
              <span className={cn('size-2.5 shrink-0 rounded-full', st.dot)} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{s.what}</p>
                <p className="truncate font-mono text-[12px] text-ink/65">{s.reasons[0] ?? 'no rule fired'}</p>
              </div>
              <div className="text-right">
                <p className={cn('text-[13px] font-semibold', st.text)}>{st.word}</p>
                <p className="font-mono text-[12px] text-ink/65">${s.usd.toFixed(s.usd < 0.01 ? 3 : 2)}</p>
              </div>
            </div>
          )
        })}
      </AnimatedList>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-panel" />
      <p className="absolute left-0 top-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-ink/65">Sample requests</p>
    </div>
  )
}
