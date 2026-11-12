import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { AutopsyStage } from './autopsy-stage'
import { BoardBars } from './board-bars'
import { OddsDots } from './odds-dots'
import { RadarScope } from './radar-scope'
import { DataError, fetchAutopsy, fetchBoard, fetchOdds, fetchRadar, type Autopsy, type Band, type Board, type DataFailure, type Odds, type Radar } from './launches-api'

const ERRORS: Record<DataFailure, string> = {
  not_live: 'This goes live with the next update of the gate.',
  limit: 'You used today’s free reads. Come back tomorrow.',
  not_found: 'Our collector never saw a pool for this token, so there is nothing to look back on.',
  bad_address: 'That does not look like a token address. It starts with 0x and has 40 more characters.',
  no_data: 'Launch data is not available right now.',
  failed: 'Could not reach the gate. Try again in a moment; if it keeps failing, your network may block workers.dev, so try another connection.',
}

type Load<T> = { phase: 'loading' } | { phase: 'error'; kind: DataFailure } | { phase: 'done'; data: T }

// One read on mount. Errors become a sentence, never a blank box.
function useRead<T>(load: (signal: AbortSignal) => Promise<T>): Load<T> {
  const [state, setState] = useState<Load<T>>({ phase: 'loading' })
  useEffect(() => {
    const ctl = new AbortController()
    load(ctl.signal).then(
      (data) => setState({ phase: 'done', data }),
      (e) => {
        if ((e as Error).name !== 'AbortError') setState({ phase: 'error', kind: e instanceof DataError ? e.kind : 'failed' })
      },
    )
    return () => ctl.abort()
    // the loaders are module-level functions with fixed arguments
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return state
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const pct = (v: number | null) => (v === null ? '—' : `${v}%`)
const money = (v: number | null) => (v === null ? 'unknown' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }))
const bandLabel = (b: Band, unit: '$' | '') => {
  const f = (n: number) => (unit ? `$${n.toLocaleString('en-US')}` : n.toLocaleString('en-US'))
  return b.maxUsd === null ? `${f(b.minUsd)} or more` : `${f(b.minUsd)} to ${f(b.maxUsd)}`
}

// Body of one launch-data page. The page's own header carries the title and the explanation.
function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="mx-auto max-w-[1040px] px-5 pb-20 pt-6">
      {children}
    </section>
  )
}

function Status<T>({ state, children }: { state: Load<T>; children: (data: T) => ReactNode }) {
  if (state.phase === 'loading') return <p className="text-[15px] text-ink/65">Loading…</p>
  if (state.phase === 'error') return <p role="status" className="max-w-[680px] rounded-2xl bg-panel p-5 text-[15px] text-ink/80">{ERRORS[state.kind]}</p>
  return <>{children(state.data)}</>
}

function Coverage({ c }: { c: { pools: number; outcomes: number; note: string } }) {
  return (
    <p className="mt-3 max-w-[680px] text-[13px] text-ink/65">
      Based on {c.pools.toLocaleString('en-US')} pools seen and {c.outcomes.toLocaleString('en-US')} re-checked a day later. {c.note}
    </p>
  )
}

// A row of the still-trading share: the bar fills only when the share is shown (enough judged pools).
function ShareRow({ label, n, share }: { label: string; n: number; share: number | null }) {
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-3 sm:grid-cols-[200px_1fr_120px]">
      <span className="font-mono text-[13px]">{label}</span>
      <span className="col-span-2 row-start-2 h-2.5 overflow-hidden rounded-full bg-panel sm:col-span-1 sm:row-start-auto">
        {share !== null && <span className="block h-full rounded-full bg-allow" style={{ width: `${share}%` }} />}
      </span>
      <span className="text-right text-[14px]">
        <span className={cn('font-semibold', share === null && 'text-ink/65')}>{pct(share)}</span>
        <span className="text-ink/65"> · {n}</span>
      </span>
    </li>
  )
}

function OddsRow({ label, n, share }: { label: string; n: number; share: number | null }) {
  return (
    <li className="py-3">
      <div className="mb-2 flex items-baseline justify-between gap-3 text-[14px]">
        <span className="font-mono text-[13px]">{label}</span>
        <span>
          <span className={cn('font-semibold', share === null && 'text-ink/65')}>{pct(share)}</span>
          <span className="text-ink/65"> · {n}</span>
        </span>
      </div>
      <OddsDots share={share} />
    </li>
  )
}

function OddsTable({ title, bands, unit }: { title: string; bands: Band[]; unit: '$' | '' }) {
  return (
    <div>
      <h3 className="text-[14px] font-semibold text-ink/65">{title}</h3>
      <ul className="mt-1 divide-y divide-hair border-y border-hair">
        {bands.map((b) => (
          <OddsRow key={b.minUsd} label={bandLabel(b, unit)} n={b.n} share={b.stillTradingPct} />
        ))}
      </ul>
    </div>
  )
}

export function OddsPart() {
  const state = useRead<Odds>((s) => fetchOdds(s))
  return (
    <Part label="Odds">
      <Status state={state}>
        {(o) => (
          <>
            <div className="grid gap-8 lg:grid-cols-2">
              <OddsTable title="By liquidity when first seen" bands={o.byFirstLiquidityUsd} unit="$" />
              <OddsTable title="By swaps in the first day" bands={o.byFirstSwaps} unit="" />
            </div>
            <p className="mt-4 max-w-[680px] text-[14px] text-ink/70">{o.definition}</p>
            <Coverage c={o.coverage} />
          </>
        )}
      </Status>
    </Part>
  )
}

export function BoardPart() {
  const state = useRead<Board>((s) => fetchBoard(14, s))
  return (
    <Part label="Launch board">
      <Status state={state}>
        {(b) =>
          b.days.length === 0 ? (
            <p className="text-[15px] text-ink/65">No pools in the last two weeks.</p>
          ) : (
            <>
              <BoardBars days={b.days} />
              <ul className="divide-y divide-hair border-y border-hair">
                {b.days.map((d) => (
                  <ShareRow key={d.day} label={`${d.day} · ${d.pools} seen, ${d.outcomes} re-checked`} n={d.alive + d.dead} share={d.stillTradingPct} />
                ))}
              </ul>
              <Coverage c={b.coverage} />
            </>
          )
        }
      </Status>
    </Part>
  )
}

export function RadarPart() {
  const [active, setActive] = useState<string | null>(null)
  const state = useRead<Radar>((s) => fetchRadar(48, s))
  return (
    <Part label="Ticker radar">
      <Status state={state}>
        {(r) =>
          r.waves.length === 0 ? (
            <p className="text-[15px] text-ink/65">No reused tickers in the last 48 hours.</p>
          ) : (
            <div className="grid items-start gap-6 lg:grid-cols-[380px_1fr] lg:gap-10">
              <div className="lg:sticky lg:top-24"><RadarScope waves={r.waves} active={active} onActive={setActive} /></div>
              <div>
              <ul className="divide-y divide-hair border-y border-hair text-[14px]">
                {r.waves.map((w) => (
                  <li key={w.ticker} onMouseEnter={() => setActive(w.ticker)} onMouseLeave={() => setActive(null)} className={cn('grid gap-1 px-2 py-3 transition-colors sm:grid-cols-[160px_1fr] sm:gap-4', active === w.ticker && 'bg-gold/15')}>
                    <button type="button" aria-pressed={active === w.ticker} onClick={() => setActive(active === w.ticker ? null : w.ticker)} className="w-fit rounded font-mono font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ink">{w.ticker}</button>
                    <span className="text-ink/70">
                      {w.recentTokens} new tokens, {w.totalTokens} in all.
                      {w.first && <> Earliest: <code className="font-mono text-[13px]" title={w.first.token}>{short(w.first.token)}</code>.</>}
                      {w.busiest && <> Busiest: <code className="font-mono text-[13px]" title={w.busiest.token}>{short(w.busiest.token)}</code>.</>}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 max-w-[680px] text-[13px] text-ink/65">{r.note}</p>
              </div>
            </div>
          )
        }
      </Status>
    </Part>
  )
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const PATTERN_TONE: Record<string, string> = { still_trading: 'text-allow', liquidity_pulled: 'text-block', faded: 'text-review', never_lived: 'text-block' }

export function AutopsyPart() {
  const [value, setValue] = useState('')
  const [state, setState] = useState<{ phase: 'idle' } | Load<Autopsy>>({ phase: 'idle' })
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const trimmed = value.trim()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ADDRESS.test(trimmed)) return setState({ phase: 'error', kind: 'bad_address' })
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setState({ phase: 'loading' })
    try {
      setState({ phase: 'done', data: await fetchAutopsy(trimmed, ctl.signal) })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setState({ phase: 'error', kind: err instanceof DataError ? err.kind : 'failed' })
    }
  }

  return (
    <Part label="Autopsy">
      <form onSubmit={submit} noValidate className="max-w-[680px]">
        <label htmlFor="autopsy-address" className="block text-[15px] font-medium">Token address</label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input id="autopsy-address" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} className="min-h-12 w-full min-w-0 rounded-xl bg-panel px-4 font-mono text-[15px] outline-none ring-2 ring-transparent focus-visible:ring-ink" />
          <button type="submit" disabled={state.phase === 'loading'} className="min-h-12 shrink-0 rounded-full bg-ink px-6 text-[15px] font-medium text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.97] disabled:opacity-60">
            {state.phase === 'loading' ? 'Looking…' : 'Look back'}
          </button>
        </div>
      </form>
      <div className="mt-6">
        <AutopsyStage data={state.phase === 'done' ? state.data : null} loading={state.phase === 'loading'} />
      </div>
      <div aria-live="polite">
        {state.phase === 'error' && <p role="status" className="max-w-[680px] rounded-2xl bg-panel p-5 text-[15px] text-ink/80">{ERRORS[state.kind]}</p>}
        {state.phase === 'done' && (
          <div className="max-w-[680px] rounded-2xl border border-hair bg-white p-5 shadow-sm">
            <p className="text-[13px] font-medium text-ink/65">{state.data.symbol ?? short(state.data.token)}</p>
            <p className={cn('mt-1 text-[28px] font-semibold first-letter:uppercase', PATTERN_TONE[state.data.pattern] ?? 'text-ink')}>{state.data.pattern.replace(/_/g, ' ')}</p>
            <p className="mt-2 text-[15px] text-ink/80">{state.data.plain}</p>
            <dl className="mt-4 grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-1 text-[14px]">
              <dt className="text-ink/65" />
              <dd className="text-ink/65">First seen</dd>
              <dd className="text-ink/65">A day later</dd>
              <dt className="text-ink/70">Liquidity</dt>
              <dd className="font-mono text-[13px]">{money(state.data.firstSeen.liquidityUsd)}</dd>
              <dd className="font-mono text-[13px]">{state.data.dayLater ? money(state.data.dayLater.liquidityUsd) : '—'}</dd>
              <dt className="text-ink/70">Volume, 24h</dt>
              <dd className="font-mono text-[13px]">{money(state.data.firstSeen.volumeH24Usd)}</dd>
              <dd className="font-mono text-[13px]">{state.data.dayLater ? money(state.data.dayLater.volumeH24Usd) : '—'}</dd>
              <dt className="text-ink/70">Swaps, 24h</dt>
              <dd className="font-mono text-[13px]">{state.data.firstSeen.swapsH24 ?? 'unknown'}</dd>
              <dd className="font-mono text-[13px]">{state.data.dayLater ? (state.data.dayLater.swapsH24 ?? 'unknown') : '—'}</dd>
            </dl>
            <p className="mt-4 text-[13px] text-ink/65">{state.data.note}</p>
          </div>
        )}
      </div>
    </Part>
  )
}
