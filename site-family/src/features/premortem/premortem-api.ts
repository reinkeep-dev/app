// POST /api/v1/premortem: a launch draft in, the gate's answer and the launch risks out. Shapes follow api/src/premortem.ts.
import { GATE } from '@/features/gate-tool/gate-api'

export type Decision = 'ALLOW' | 'REVIEW' | 'BLOCK'
export type Severity = 'high' | 'medium' | 'low'

export type Draft = {
  ticker: string
  contract: { mint: boolean; ownerRenounced: boolean; pause: boolean; blacklist: boolean; upgradeable: boolean }
  buyTaxPct: number
  sellTaxPct: number
  teamAllocationPct: number
  liquidityUsd: number
  liquidityLockDays: number
}

export type Risk = { code: string; severity: Severity; basis: 'gate rule' | 'rule of thumb' | 'collector data'; plain: string; fix: string }

export type PremortemAnswer = {
  draft: { name: string | null; ticker: string }
  gate: { decision: Decision; reasons: { code: string; plain: string }[] }
  risks: Risk[]
  ticker: { checked: boolean; earlierTokens: number | null; firstSeen: string | null }
  cohort: { minUsd: number; maxUsd: number | null; n: number; alive: number; dead: number; stillTradingPct: number | null; note: string } | null
  summary: Record<Severity, number>
}

export type PremortemFailure = 'limit' | 'not_live' | 'rejected' | 'failed'
export class PremortemError extends Error {
  kind: PremortemFailure
  detail?: string
  constructor(kind: PremortemFailure, detail?: string) {
    super(kind)
    this.kind = kind
    this.detail = detail
  }
}

export async function runPremortem(draft: Draft, signal?: AbortSignal): Promise<PremortemAnswer> {
  // Same time limit as the launch-data reads: a hung connection becomes a message, not an endless wait.
  const timer = new AbortController()
  const t = setTimeout(() => timer.abort(), 12_000)
  const onAbort = () => timer.abort()
  signal?.addEventListener('abort', onAbort)
  let res: Response
  try {
    res = await fetch(`${GATE}/api/v1/premortem`, { method: 'POST', signal: timer.signal, headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(draft) })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new PremortemError('failed')
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', onAbort)
  }
  if (res.status === 404 || res.status === 405) throw new PremortemError('not_live')
  if (res.status === 429) throw new PremortemError('limit')
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new PremortemError('rejected', body?.error?.message)
  }
  if (!res.ok) throw new PremortemError('failed')
  try {
    return (await res.json()) as PremortemAnswer
  } catch {
    throw new PremortemError('failed')
  }
}
