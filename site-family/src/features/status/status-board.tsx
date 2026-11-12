import { useCallback, useEffect, useRef, useState } from 'react'
import { GATE } from '@/features/gate-tool/gate-api'
import { cn } from '@/lib/utils'

type Check = { ok: boolean; detail?: string; critical?: boolean }
type Status = { ok: boolean; checkedAt: string | number; checks: Record<string, Check> }
type State = { phase: 'loading' } | { phase: 'done'; status: Status } | { phase: 'not_live' } | { phase: 'error' }

// Plain names for the checks api/src/status.ts reports.
const LABELS: Record<string, string> = {
  signer: 'Receipt signer',
  d1: 'Receipt storage',
  chainRpc: 'Robinhood Chain connection',
  payments: 'Paid checks (x402)',
  ai: 'AI explanations',
  freeTier: 'Free-check counter',
}

function isStatus(v: unknown): v is Status {
  const s = v as Status
  return !!s && typeof s.ok === 'boolean' && !!s.checks && typeof s.checks === 'object'
}

const stamp = (v: string | number) => {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

export function StatusBoard() {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const abort = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`${GATE}/api/status`, { signal: ctl.signal, headers: { accept: 'application/json' } })
      if (res.status === 404) return setState({ phase: 'not_live' })
      // a 503 still carries the JSON body (a critical check failed), so read it before judging
      const body: unknown = await res.json().catch(() => null)
      setState(isStatus(body) ? { phase: 'done', status: body } : { phase: 'error' })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setState({ phase: 'error' })
    }
  }, [])

  useEffect(() => {
    void load()
    return () => abort.current?.abort()
  }, [load])

  const loading = state.phase === 'loading'
  return (
    <div className="max-w-[760px]">
      <div aria-live="polite" aria-busy={loading}>
        {loading && <p className="text-[15px] text-ink/65">Asking the gate how it is doing…</p>}
        {state.phase === 'not_live' && <p className="rounded-2xl bg-panel p-5 text-[16px] text-ink/80">Status goes live with the next update.</p>}
        {state.phase === 'error' && <p className="rounded-2xl bg-panel p-5 text-[16px] text-ink/80">Could not reach the gate just now. That does not tell us it is down. Try again in a moment.</p>}
        {state.phase === 'done' && <Board status={state.status} />}
      </div>
      <button type="button" onClick={() => void load()} disabled={loading} className="mt-6 min-h-12 rounded-full bg-panel px-6 text-[15px] font-medium outline-none transition-colors hover:bg-hair focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-60">
        {loading ? 'Checking…' : 'Refresh'}
      </button>
    </div>
  )
}

function Board({ status }: { status: Status }) {
  const rows = Object.entries(status.checks)
  return (
    <>
      <p className={cn('text-[22px] font-semibold leading-snug', status.ok ? 'text-allow' : 'text-block')}>
        {status.ok ? 'The gate is up. Everything it needs is working.' : 'Something the gate needs is down.'}
      </p>
      <p className="mt-1 text-[14px] text-ink/65">Checked at {stamp(status.checkedAt)}</p>
      <ul className="mt-5 divide-y divide-hair border-y border-hair">
        {rows.map(([key, c]) => (
          <li key={key} className="flex items-start gap-3 py-3.5">
            <span aria-hidden="true" className={cn('mt-1.5 size-3 shrink-0 rounded-full', c.ok ? 'bg-allow' : 'bg-block')} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="text-[16px] font-medium">{LABELS[key] ?? key}</span>
                <span className={cn('text-[14px] font-semibold', c.ok ? 'text-allow' : 'text-block')}>{c.ok ? 'Working' : 'Down'}</span>
              </p>
              {c.detail && <p className="mt-0.5 break-words text-[14px] text-ink/65">{c.detail}</p>}
              {c.critical && <p className="mt-0.5 text-[13px] text-ink/65">The gate cannot answer without this.</p>}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
