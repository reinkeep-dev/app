import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import samples from '@data/sample-tokens.json'
import { cn } from '@/lib/utils'
import { GateError, NETWORK, USDG, isAddress, runGate, toBaseUnits, type GateAnswer, type GateFailure } from './gate-api'
import { GateResult } from './gate-result'

const EXAMPLES = [{ label: 'USDG', address: USDG }, ...samples.tokens.map((t) => ({ label: t.ticker, address: t.token }))]

const field = 'mt-1.5 min-h-12 w-full min-w-0 rounded-xl bg-panel px-4 text-[15px] outline-none ring-2 ring-transparent transition-shadow placeholder:text-ink/40 focus-visible:ring-ink aria-[invalid=true]:ring-block'

type Run = { phase: 'idle' } | { phase: 'loading' } | { phase: 'error'; failure: GateFailure } | { phase: 'done'; answer: GateAnswer; freeLeft: string | null }

function failureText(f: GateFailure) {
  switch (f.kind) {
    case 'limit':
      return null // rendered with a link
    case 'rejected':
      return f.message ?? 'The gate could not read that request. Check the fields and try again.'
    case 'network':
      return 'Could not reach the gate just now. Try again in a moment.'
    default:
      return 'The gate hit a problem answering that. Try again in a moment.'
  }
}

export function GateTool() {
  const [amount, setAmount] = useState('0.01')
  const [payTo, setPayTo] = useState('0x1111111111111111111111111111111111111111')
  const [resourceUrl, setResourceUrl] = useState('https://api.example.com/v1/data')
  const [valid, setValid] = useState('90')
  const [token, setToken] = useState('')
  const [known, setKnown] = useState(false)
  const [touched, setTouched] = useState(false)
  const [run, setRun] = useState<Run>({ phase: 'idle' })
  const abort = useRef<AbortController | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    if (run.phase === 'done' || run.phase === 'error') resultRef.current?.focus()
  }, [run])

  const errors = {
    amount: toBaseUnits(amount) ? null : 'Use a number above zero with at most 6 decimals, like 0.01.',
    payTo: isAddress(payTo.trim()) ? null : 'An address starts with 0x and has 40 more characters.',
    resourceUrl: resourceUrl.trim() ? null : 'Add the link the agent is paying.',
    valid: /^\d+$/.test(valid) && Number(valid) <= 31536000 ? null : 'Whole seconds, 0 to 31,536,000.',
    token: token.trim() === '' || isAddress(token.trim()) ? null : 'A token address starts with 0x and has 40 more characters.',
  }
  const hasErrors = Object.values(errors).some(Boolean)
  const loading = run.phase === 'loading'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (hasErrors) return
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setRun({ phase: 'loading' })
    try {
      const out = await runGate({ amountUsdg: amount, payTo, resourceUrl, validForSeconds: Number(valid), token, knownPayee: known }, ctl.signal)
      setRun({ phase: 'done', ...out })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setRun({ phase: 'error', failure: err instanceof GateError ? err.failure : { kind: 'failed' } })
    }
  }

  const show = (k: keyof typeof errors) => (touched ? errors[k] : null)
  const err = (id: string, k: keyof typeof errors) => (show(k) ? <p id={id} className="mt-1.5 text-[14px] text-block">{show(k)}</p> : null)

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <form onSubmit={submit} noValidate aria-label="Payment request" className="min-w-0">
        <h2 className="text-[22px] font-semibold">The payment</h2>
        <p className="mt-1 text-[15px] text-ink/60">What your agent is about to pay. The gate checks it before any money moves.</p>

        <div className="mt-5">
          <label htmlFor="g-amount" className="block text-[15px] font-medium">Amount in USDG</label>
          <input id="g-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!show('amount')} aria-describedby={show('amount') ? 'g-amount-e' : undefined} className={cn(field, 'font-mono')} />
          {err('g-amount-e', 'amount')}
        </div>
        <div className="mt-4">
          <label htmlFor="g-payto" className="block text-[15px] font-medium">Pay to</label>
          <input id="g-payto" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} placeholder="0x…" value={payTo} onChange={(e) => setPayTo(e.target.value)} aria-invalid={!!show('payTo')} aria-describedby={show('payTo') ? 'g-payto-e' : undefined} className={cn(field, 'font-mono text-[14px]')} />
          {err('g-payto-e', 'payTo')}
        </div>
        <div className="mt-4">
          <label htmlFor="g-url" className="block text-[15px] font-medium">What it pays for (link)</label>
          <input id="g-url" type="url" autoComplete="off" spellCheck={false} value={resourceUrl} onChange={(e) => setResourceUrl(e.target.value)} aria-invalid={!!show('resourceUrl')} aria-describedby={show('resourceUrl') ? 'g-url-e' : undefined} className={field} />
          {err('g-url-e', 'resourceUrl')}
        </div>
        <div className="mt-4">
          <label htmlFor="g-valid" className="block text-[15px] font-medium">Signature valid for (seconds)</label>
          <input id="g-valid" inputMode="numeric" autoComplete="off" value={valid} onChange={(e) => setValid(e.target.value)} aria-invalid={!!show('valid')} aria-describedby={show('valid') ? 'g-valid-e' : undefined} className={cn(field, 'font-mono sm:max-w-40')} />
          {err('g-valid-e', 'valid')}
        </div>

        <dl className="mt-5 divide-y divide-hair border-y border-hair text-[14px]">
          <div className="flex flex-wrap justify-between gap-x-4 py-2">
            <dt className="text-ink/60">Network</dt>
            <dd className="font-mono">{NETWORK} (Robinhood Chain)</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-x-4 py-2">
            <dt className="text-ink/60">Token paid</dt>
            <dd className="min-w-0 break-all font-mono">USDG, {USDG.slice(0, 8)}…{USDG.slice(-4)}</dd>
          </div>
        </dl>

        <h2 className="mt-8 text-[22px] font-semibold">What it buys</h2>
        <div className="mt-3">
          <label htmlFor="g-token" className="block text-[15px] font-medium">Token address <span className="font-normal text-ink/60">(optional)</span></label>
          <input id="g-token" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} placeholder="0x…" value={token} onChange={(e) => setToken(e.target.value)} aria-invalid={!!show('token')} aria-describedby={show('token') ? 'g-token-e' : undefined} className={cn(field, 'font-mono text-[14px]')} />
          {err('g-token-e', 'token')}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[14px]">
            <span className="text-ink/60">Fill in:</span>
            {EXAMPLES.map((ex) => (
              <button key={ex.address} type="button" onClick={() => setToken(ex.address)} title={ex.address} aria-pressed={token.toLowerCase() === ex.address.toLowerCase()} className="min-h-10 rounded-full border border-hair px-4 font-mono text-[13px] outline-none transition-colors hover:bg-panel focus-visible:ring-2 focus-visible:ring-ink aria-pressed:border-ink">
                {ex.label}
              </button>
            ))}
            {token && (
              <button type="button" onClick={() => setToken('')} className="min-h-10 rounded-full px-3 text-[14px] text-ink/70 underline underline-offset-4 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ink">
                Clear
              </button>
            )}
          </div>
        </div>

        <h2 className="mt-8 text-[22px] font-semibold">Your rules</h2>
        <p className="mt-1 text-[15px] text-ink/60">Policy <code className="font-mono text-[14px] text-ink">reinkeep-default-v1</code>: $0.10 per payment, $1 a day, https only.</p>
        <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 text-[15px]">
          <input type="checkbox" checked={known} onChange={(e) => setKnown(e.target.checked)} className="mt-1 size-5 shrink-0 accent-ink" />
          <span>I already know this payee. Without this, a first payment to a new address waits for a human.</span>
        </label>

        <button type="submit" disabled={loading} className="mt-6 min-h-12 w-full rounded-full bg-ink px-6 text-[15px] font-medium text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.97] disabled:opacity-60 sm:w-auto">
          {loading ? 'Running the gate…' : 'Run the Gate'}
        </button>
        <p className="mt-3 text-[13px] text-ink/60">25 free checks a day from your connection. Rules decide; AI only explains. Not audited.</p>
      </form>

      <div ref={resultRef} tabIndex={-1} aria-live="polite" aria-busy={loading} className="min-w-0 outline-none lg:sticky lg:top-24">
        {run.phase === 'idle' && (
          <div className="rounded-2xl bg-panel p-6">
            <img src="/assets/keep-calm.webp" alt="" width={120} height={120} className="size-24" />
            <p className="mt-3 text-[17px] font-medium">Keep is waiting at the gate.</p>
            <p className="mt-1 text-[15px] text-ink/60">Change the payment if you like, then run it. You get the answer, every rule that decided it, and a signed receipt.</p>
          </div>
        )}
        {loading && <p className="rounded-2xl bg-panel p-6 text-[15px] text-ink/70">Asking the gate…</p>}
        {run.phase === 'error' && (
          <div role="status" className="rounded-2xl bg-panel p-6 text-[15px] text-ink/80">
            {run.failure.kind === 'limit' ? (
              <>
                <p>Today’s 25 free checks from this connection are used. Agents pay $0.01 in USDG per check over x402.</p>
                <p className="mt-3">
                  <Link to="/docs#paying" className="font-medium text-ink underline underline-offset-4">How paying works</Link>
                </p>
              </>
            ) : (
              <p>{failureText(run.failure)}</p>
            )}
          </div>
        )}
        {run.phase === 'done' && <GateResult answer={run.answer} freeLeft={run.freeLeft} />}
      </div>
    </div>
  )
}

