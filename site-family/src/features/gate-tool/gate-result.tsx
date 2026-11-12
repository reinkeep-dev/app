import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { GateError, loadSigner, verifyReceipt, type Decision, type GateAnswer, type Verification } from './gate-api'

const TONE: Record<Decision, string> = { ALLOW: 'text-allow', REVIEW: 'text-review', BLOCK: 'text-block' }
const POSE: Record<Decision, string> = { ALLOW: 'keep-allow', REVIEW: 'keep-review', BLOCK: 'keep-block' }

const FACT_ROWS: [string, string][] = [
  ['is_contract', 'Is a contract'],
  ['mint_with_live_owner', 'Owner can mint more'],
  ['has_blacklist', 'Can blacklist wallets'],
  ['has_pause', 'Can pause transfers'],
  ['is_proxy', 'Is a proxy'],
  ['has_upgrade', 'Code can be upgraded'],
  ['ticker_clone_of_older', 'Copies an older ticker'],
]
const yesNo = (v: unknown) => (v === true ? 'Yes' : v === false ? 'No' : 'Unknown')
const usd = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : 'Unknown')
const when = (sec: number) => (Number.isFinite(sec) ? new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'Unknown')

type Check = { phase: 'idle' } | { phase: 'loading' } | { phase: 'done'; result: Verification } | { phase: 'error'; message: string }

export function GateResult({ answer, freeLeft }: { answer: GateAnswer; freeLeft: string | null }) {
  const { decision, reasons, explanation, receipt, shareUrl } = answer
  const buying = receipt.body?.buying
  const facts = buying?.facts ?? null
  const [signer, setSigner] = useState<string | null>(null)
  const [check, setCheck] = useState<Check>({ phase: 'idle' })

  useEffect(() => {
    const ctl = new AbortController()
    void loadSigner(ctl.signal).then(setSigner)
    return () => ctl.abort()
  }, [])

  async function verify() {
    setCheck({ phase: 'loading' })
    try {
      setCheck({ phase: 'done', result: await verifyReceipt(receipt) })
    } catch (e) {
      setCheck({ phase: 'error', message: e instanceof GateError && e.failure.message ? e.failure.message : 'Could not reach the gate to verify. Try again in a moment.' })
    }
  }

  return (
    <motion.div className="rounded-2xl border border-hair bg-white p-5 shadow-sm" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.2, 0.7, 0.1, 1] }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink/60">The gate answers</p>
          <p className={cn('mt-1 text-[48px] font-semibold leading-none tracking-tight min-[400px]:text-[64px]', TONE[decision])}>{decision}</p>
        </div>
        <img src={`/assets/${POSE[decision]}.webp`} alt="" width={110} height={110} className="size-20 shrink-0 sm:size-[110px]" />
      </div>

      {explanation && (
        <div className="mt-5">
          <p className="text-[13px] font-medium text-ink/60">{explanation.source === 'ai' ? 'Explained by AI' : 'From the rules'}</p>
          <p className="mt-1 text-[16px] leading-relaxed">{explanation.text}</p>
        </div>
      )}

      <h3 className="mt-5 text-[13px] font-medium text-ink/60">Every check that fired</h3>
      <ul className="mt-1 divide-y divide-hair border-y border-hair text-[14px]">
        {reasons.length === 0 && <li className="py-2.5 text-ink/60">No rule fired. Everything passed.</li>}
        {reasons.map((r) => (
          <li key={r.code} className="grid gap-1 py-2.5 sm:grid-cols-[210px_1fr] sm:gap-3">
            <code className="break-words font-mono text-[13px]">{r.code}</code>
            <span className="text-ink/70">{r.plain}</span>
          </li>
        ))}
      </ul>

      {buying && (
        <>
          <h3 className="mt-5 text-[13px] font-medium text-ink/60">The token it buys</h3>
          <p className="mt-1 break-all font-mono text-[12.5px] text-ink/60">{facts && typeof facts.ticker === 'string' ? `${facts.ticker} · ` : ''}{buying.token}</p>
          {facts ? (
            <dl className="mt-1 divide-y divide-hair border-y border-hair text-[14px]">
              {FACT_ROWS.map(([key, label]) => (
                <Fact key={key} label={label} value={yesNo(facts[key])} />
              ))}
              <Fact label="Liquidity seen" value={usd(facts.seen_liquidity_usd)} />
            </dl>
          ) : (
            <p className="mt-1 border-y border-hair py-2.5 text-[14px] text-ink/60">No facts on this token yet, so it cannot pass.</p>
          )}
        </>
      )}

      <h3 className="mt-5 text-[13px] font-medium text-ink/60">Signed receipt</h3>
      <dl className="mt-1 divide-y divide-hair border-y border-hair text-[14px]">
        <Fact label="Receipt id" value={receipt.id} />
        <Fact label="Issued" value={when(receipt.issuedAt)} />
        <Fact label="Signer" value={signer ?? 'Could not load'} wrap />
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <button type="button" onClick={() => void verify()} disabled={check.phase === 'loading'} className="min-h-11 rounded-full bg-panel px-5 text-[14px] font-medium outline-none transition-colors hover:bg-hair focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-60">
          {check.phase === 'loading' ? 'Verifying…' : 'Verify receipt'}
        </button>
        {shareUrl && (
          <a href={shareUrl} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-md text-[14px] font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ink">
            Open share page<span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
      <div aria-live="polite">
        {check.phase === 'done' && (
          <p className={cn('mt-2 text-[14px]', check.result.valid ? 'text-allow' : 'text-block')}>
            {check.result.valid ? <>Signature is valid. Signed by <span className="break-all font-mono text-[13px]">{check.result.signer}</span>.</> : `Signature did not check out${check.result.reason ? `: ${check.result.reason}` : '.'}`}
          </p>
        )}
        {check.phase === 'error' && <p className="mt-2 text-[14px] text-ink/70">{check.message}</p>}
      </div>
      {freeLeft !== null && <p className="mt-4 text-[13px] text-ink/60">Free checks left today from this connection: {freeLeft}</p>}
    </motion.div>
  )
}

function Fact({ label, value, wrap }: { label: string; value: string; wrap?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-ink/70">{label}</dt>
      <dd className={cn('min-w-0 text-right font-mono text-[13px]', wrap ? 'break-all' : 'break-words', value === 'Unknown' ? 'text-ink/60' : 'text-ink')}>{value}</dd>
    </div>
  )
}
