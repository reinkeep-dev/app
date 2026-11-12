// The four launch-data reads (api/src/launch-data.ts): odds, board, radar, autopsy. Free, read-only.
import { GATE } from '@/features/gate-tool/gate-api'

export type Coverage = { pools: number; outcomes: number; note: string }
export type Band = { minUsd: number; maxUsd: number | null; n: number; alive: number; dead: number; stillTradingPct: number | null }
export type Odds = { byFirstLiquidityUsd: Band[]; byFirstSwaps: Band[]; minSample: number; definition: string; coverage: Coverage }
export type BoardDay = { day: string; pools: number; outcomes: number; alive: number; dead: number; stillTradingPct: number | null }
export type Board = { days: BoardDay[]; minSample: number; coverage: Coverage }
export type Wave = { ticker: string; recentTokens: number; totalTokens: number; first: { token: string; createdAt: string } | null; busiest: { token: string } | null }
export type Radar = { hours: number; waves: Wave[]; note: string; coverage: Coverage }
export type Snap = { at: string; liquidityUsd: number | null; volumeH24Usd: number | null; swapsH24: number | null }
export type Autopsy = { token: string; symbol: string | null; pattern: string; plain: string; firstSeen: Snap; dayLater: (Snap & { ageHours: number }) | null; otherPools: number; note: string }

export type DataFailure = 'not_live' | 'limit' | 'not_found' | 'bad_address' | 'no_data' | 'failed'
export class DataError extends Error {
  kind: DataFailure
  constructor(kind: DataFailure) {
    super(kind)
    this.kind = kind
  }
}

// A read that hangs (a network that blocks the gate's host, a dropped connection) gives up after this long and says
// so, instead of showing "Loading…" forever.
export const READ_TIMEOUT_MS = 12_000

async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const timer = new AbortController()
  const t = setTimeout(() => timer.abort(), READ_TIMEOUT_MS)
  const onAbort = () => timer.abort()
  signal?.addEventListener('abort', onAbort)
  let res: Response
  try {
    res = await fetch(GATE + path, { signal: timer.signal, headers: { accept: 'application/json' } })
  } catch (e) {
    // The caller's own abort (page left) stays an AbortError; our time limit becomes a plain failure.
    if (signal?.aborted) throw e
    throw new DataError('failed')
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', onAbort)
  }
  if (res.status === 404) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null
    throw new DataError(body?.error?.code === 'token_not_collected' ? 'not_found' : 'not_live')
  }
  if (res.status === 429) throw new DataError('limit')
  if (res.status === 400) throw new DataError('bad_address')
  if (res.status === 503) throw new DataError('no_data')
  if (!res.ok) throw new DataError('failed')
  return (await res.json()) as T
}

export const fetchOdds = (signal?: AbortSignal) => read<Odds>('/api/v1/odds', signal)
export const fetchBoard = (days: number, signal?: AbortSignal) => read<Board>(`/api/v1/board?days=${days}`, signal)
export const fetchRadar = (hours: number, signal?: AbortSignal) => read<Radar>(`/api/v1/radar?hours=${hours}`, signal)
export const fetchAutopsy = (address: string, signal?: AbortSignal) => read<Autopsy>(`/api/v1/autopsy/${address}`, signal)
