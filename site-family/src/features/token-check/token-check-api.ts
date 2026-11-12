// Single place that knows where the verdict endpoint lives and what it returns.
// Live gate by default. For a local test against `wrangler dev`, run Vite with VITE_GATE_URL=http://127.0.0.1:8799
import { GATE } from '@/features/gate-tool/gate-api'

export const VERDICT_API_BASE: string = GATE

export type Decision = 'ALLOW' | 'REVIEW' | 'BLOCK'

export type TokenFacts = {
  is_contract: boolean | null
  mint_with_live_owner: boolean | null
  has_blacklist: boolean | null
  has_pause: boolean | null
  is_proxy: boolean | null
  has_upgrade: boolean | null
  ticker_clone_of_older: boolean | null
  seen_liquidity_usd: number | null
  symbol?: string | null
}

export type Verdict = {
  token: string
  decision: Decision
  reasons: { code: string; plain: string }[]
  facts: TokenFacts
  explanation: { text: string; source: 'ai' | 'rules'; model?: string }
  checkedAt: string | number
}

export type CheckFailure = 'bad_address' | 'limit' | 'not_live' | 'failed'

export class CheckError extends Error {
  kind: CheckFailure
  constructor(kind: CheckFailure) {
    super(kind)
    this.kind = kind
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
export const isAddress = (value: string) => ADDRESS.test(value)

export async function fetchVerdict(address: string, signal?: AbortSignal): Promise<Verdict> {
  let res: Response
  try {
    res = await fetch(`${VERDICT_API_BASE}/api/v1/verdict/${address}`, { signal, headers: { accept: 'application/json' } })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new CheckError('failed')
  }
  if (res.status === 404) throw new CheckError('not_live')
  if (res.status === 429) throw new CheckError('limit')
  if (res.status === 400) throw new CheckError('bad_address')
  if (!res.ok) throw new CheckError('failed')
  try {
    return (await res.json()) as Verdict
  } catch {
    throw new CheckError('failed')
  }
}
