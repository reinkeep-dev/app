import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { evaluate, defaultPolicy, ROBINHOOD_CHAIN, USDG_ROBINHOOD } from '@engine/policy.js'
import rules from '@data/rules.json'
import samples from '@data/sample-tokens.json'
import { cn } from '@/lib/utils'

// The live demo: the real rules engine, running in the browser. Same inputs and fixed clock as the
// old site's demo (../site/app.js), so the same choices give the same receipt.
const KNOWN = '0x1111111111111111111111111111111111111111'
const STRANGER = '0x000000000000000000000000000000000000dEaD'
const ETH_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const NOW = 1_700_000_000_000
const WORD = { allow: 'ALLOW', approve: 'REVIEW', deny: 'BLOCK' } as const
const TONE = { allow: 'text-allow', approve: 'text-review', deny: 'text-block' } as const
const POSE = { allow: 'keep-allow', approve: 'keep-review', deny: 'keep-block' } as const
const PLAIN: Record<string, string> = Object.fromEntries(rules.map((r) => [r.code, r.plain]))

type Payee = 'known' | 'new' | 'stranger'
// "What it buys": nothing (a plain payment), one of the real fact sheets exported by scripts/export-sample-tokens.ts,
// or a token the collector has never seen (no facts, so the engine must say REVIEW).
const UNSEEN = '0x000000000000000000000000000000000000beef'
const BUY_OPTIONS = [
  { value: 'none', label: 'Nothing, a plain payment' },
  ...samples.tokens.map((s) => ({ value: s.token, label: `${s.ticker}, ${s.token.slice(0, 6)}…${s.token.slice(-4)}` })),
  { value: UNSEEN, label: 'A token we have never seen' },
]
const SAMPLE_DAY = new Date(samples.readAtMs).toISOString().slice(0, 10)

async function sha8(text: string) {
  if (!crypto.subtle) return 'n/a'
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function GateDemo() {
  const [limit, setLimit] = useState(0.1)
  const [amount, setAmount] = useState(0.04)
  const [payee, setPayee] = useState<Payee>('known')
  const [wrongChain, setWrongChain] = useState(false)
  const [moved, setMoved] = useState(false)
  const [http, setHttp] = useState(false)
  const [buy, setBuy] = useState('none')
  const [receipt, setReceipt] = useState('')

  const { req, res, buying } = useMemo(() => {
    const units = BigInt(Math.round(amount * 1e6))
    const req = {
      network: wrongChain ? 'eip155:1' : ROBINHOOD_CHAIN,
      asset: wrongChain ? ETH_USDC : USDG_ROBINHOOD,
      amount: units.toString(),
      decimals: 6,
      payTo: payee === 'stranger' ? STRANGER : KNOWN.replace(/1/g, payee === 'new' ? '2' : '1'),
      resourceUrl: (http ? 'http' : 'https') + '://api.example-vendor.com/data',
      validForSeconds: 60,
      quotedAmount: moved ? ((units * 100n) / 108n).toString() : undefined,
      now: NOW,
    }
    const buying = buy === 'none' ? undefined : { token: buy, facts: samples.tokens.find((s) => s.token === buy)?.facts ?? null }
    const res = evaluate(req, { ...defaultPolicy, perPaymentUsd: limit, allowPayTo: [KNOWN] }, [], buying) as { verdict: keyof typeof WORD; reasons: string[] }
    return { req, res, buying }
  }, [limit, amount, payee, wrongChain, moved, http, buy])

  useEffect(() => {
    let live = true
    // A plain payment hashes exactly as before (so its receipt stays rk_7110090a); a purchase adds the token and its facts.
    const text = JSON.stringify(req, null, 2) + res.verdict + res.reasons.join(',') + (buying ? JSON.stringify(buying) : '')
    sha8(text).then((h) => live && setReceipt('rk_' + h))
    return () => {
      live = false
    }
  }, [req, res, buying])

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <form className="rounded-2xl bg-white p-5 shadow-sm" onSubmit={(e) => e.preventDefault()} aria-label="Payment request">
        <p className="text-[13px] font-medium text-ink/65">Payment request · change any line</p>
        <label className="mt-4 flex items-center gap-4 text-[15px]">
          <span className="w-24 shrink-0 text-ink/65">Your limit</span>
          <input type="range" min={0.01} max={1} step={0.01} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-full accent-ink" />
          <output className="w-14 text-right font-mono">${limit.toFixed(2)}</output>
        </label>
        <label className="mt-3 flex items-center gap-4 text-[15px]">
          <span className="w-24 shrink-0 text-ink/65">Amount</span>
          <input type="range" min={0.01} max={2} step={0.01} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="w-full accent-ink" />
          <output className="w-14 text-right font-mono">${amount.toFixed(2)}</output>
        </label>
        <label className="mt-4 block text-[15px]">
          <span className="text-ink/65">Pay to</span>
          <select value={payee} onChange={(e) => setPayee(e.target.value as Payee)} className="mt-1.5 min-h-11 w-full rounded-xl bg-panel px-3">
            <option value="known">A vendor on your list</option>
            <option value="new">A vendor you have never paid</option>
            <option value="stranger">0x…dEaD, asked for by a web page</option>
          </select>
        </label>
        <label className="mt-4 block text-[15px]">
          <span className="text-ink/65">What it buys</span>
          <select value={buy} onChange={(e) => setBuy(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl bg-panel px-3">
            {BUY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {buy !== 'none' && buy !== UNSEEN && <span className="mt-1.5 block text-[12.5px] text-ink/65">Real facts, read from Robinhood Chain on {SAMPLE_DAY}.</span>}
        </label>
        {[
          ['Ethereum USDC instead of USDG on Robinhood Chain', wrongChain, setWrongChain],
          ['Price moved after the quote (+8%)', moved, setMoved],
          ['Payment link is plain http', http, setHttp],
        ].map(([label, value, set]) => (
          <label key={label as string} className="mt-3 flex min-h-8 cursor-pointer items-center gap-3 text-[15px]">
            <input type="checkbox" checked={value as boolean} onChange={(e) => (set as (v: boolean) => void)(e.target.checked)} className="size-5 accent-ink" />
            {label as string}
          </label>
        ))}
      </form>

      <div className="flex flex-col rounded-2xl bg-white p-5 shadow-sm" aria-live="polite">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink/65">The gate answers</p>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.p
                key={res.verdict}
                className={cn('mt-1 text-[48px] font-semibold min-[400px]:text-[64px] leading-none tracking-tight', TONE[res.verdict])}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -20, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              >
                {WORD[res.verdict]}
              </motion.p>
            </AnimatePresence>
          </div>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.img
              key={res.verdict}
              src={`/assets/${POSE[res.verdict]}.webp`}
              alt=""
              width={110}
              height={110}
              className="size-20 shrink-0 sm:size-[110px]"
              initial={{ scale: 0.6, rotate: -8, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            />
          </AnimatePresence>
        </div>
        <ul className="mt-4 flex-1 divide-y divide-hair border-y border-hair text-[14px]">
          {res.reasons.length === 0 && <li className="py-2.5 text-ink/65">No rule fired. Safe to sign.</li>}
          {res.reasons.map((code) => (
            <li key={code} className="grid gap-1 py-2.5 sm:grid-cols-[190px_1fr] sm:gap-3">
              <code className="font-mono text-[13px] text-ink">{code}</code>
              <span className="text-ink/65">{PLAIN[code]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex items-baseline justify-between gap-3 text-[13px] text-ink/65">
          Receipt <code className="font-mono text-[17px] text-ink">{receipt}</code>
        </p>
        <p className="mt-1 text-[12.5px] text-ink/65">First 8 hex of sha256 of the request and the answer. Nothing leaves your browser.</p>
      </div>
    </div>
  )
}
