// Everything the Gate page knows about the live API: base URL, request building and the answer shapes.
// Shapes follow reinkeep/api/README.md and api/src/gate-service.ts.
export const GATE: string = import.meta.env.VITE_GATE_URL || 'https://reinkeep-gate.reinkeep.workers.dev'

export const NETWORK = 'eip155:4663'
export const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
export const DEFAULT_POLICY = 'reinkeep-default-v1'

export type Decision = 'ALLOW' | 'REVIEW' | 'BLOCK'
export type Reason = { code: string; plain: string }
export type Receipt = { id: string; decision: Decision; issuedAt: number; body?: { buying?: { token: string; facts: Record<string, unknown> | null } | null } } & Record<string, unknown>
export type GateAnswer = {
  id: string
  decision: Decision
  reasons: Reason[]
  receipt: Receipt
  explanation?: { text: string; source: 'ai' | 'rules'; model?: string }
  shareUrl?: string
}

export type GateInput = {
  amountUsdg: string
  payTo: string
  resourceUrl: string
  validForSeconds: number
  token: string
  knownPayee: boolean
}

export type GateFailure = { kind: 'limit' | 'rejected' | 'network' | 'failed'; message?: string }
export class GateError extends Error {
  failure: GateFailure
  constructor(failure: GateFailure) {
    super(failure.kind)
    this.failure = failure
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
export const isAddress = (v: string) => ADDRESS.test(v)

// "0.01" -> "10000". String maths, so no float rounding. Returns null when it is not a positive amount with at most 6 decimals.
export function toBaseUnits(usdg: string): string | null {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(usdg.trim())
  if (!m) return null
  const units = (m[1] + (m[2] ?? '').padEnd(6, '0')).replace(/^0+(?=\d)/, '')
  return /^0+$/.test(units) ? null : units
}

async function readError(res: Response): Promise<string | undefined> {
  try {
    const body = await res.json()
    const e = body?.error
    return typeof e === 'string' ? e : typeof e?.message === 'string' ? e.message : undefined
  } catch {
    return undefined
  }
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(`${GATE}${path}`, { method: 'POST', signal, headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new GateError({ kind: 'network' })
  }
}

export async function loadPreset(signal?: AbortSignal): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${GATE}/api/v1/gate/presets`, { signal })
    const body = await res.json()
    const preset = body?.presets?.[DEFAULT_POLICY]
    if (!res.ok || !preset) throw new Error('no preset')
    return preset
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new GateError({ kind: 'network' })
  }
}

export async function runGate(input: GateInput, signal?: AbortSignal): Promise<{ answer: GateAnswer; freeLeft: string | null }> {
  const amount = toBaseUnits(input.amountUsdg)
  if (!amount) throw new GateError({ kind: 'rejected', message: 'The amount must be a number above zero with at most 6 decimals.' })
  const policy = input.knownPayee ? { ...(await loadPreset(signal)), allowPayTo: [input.payTo.trim()] } : DEFAULT_POLICY
  const body: Record<string, unknown> = {
    request: { network: NETWORK, asset: USDG, amount, decimals: 6, payTo: input.payTo.trim(), resourceUrl: input.resourceUrl.trim(), validForSeconds: input.validForSeconds },
    policy,
  }
  if (input.token.trim()) body.token = input.token.trim()
  const res = await post('/api/v1/gate', body, signal)
  if (res.status === 402) throw new GateError({ kind: 'limit' })
  if (res.status === 400) throw new GateError({ kind: 'rejected', message: await readError(res) })
  if (!res.ok) throw new GateError({ kind: 'failed' })
  try {
    return { answer: (await res.json()) as GateAnswer, freeLeft: res.headers.get('x-free-calls-left') }
  } catch {
    throw new GateError({ kind: 'failed' })
  }
}

export async function loadSigner(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`${GATE}/api/v1/receipts/signer`, { signal })
    if (!res.ok) return null
    const body = await res.json()
    return typeof body?.signer === 'string' ? body.signer : null
  } catch {
    return null
  }
}

export type Verification = { valid: true; signer: string } | { valid: false; reason?: string }
export async function verifyReceipt(receipt: Receipt, signal?: AbortSignal): Promise<Verification> {
  const res = await post('/api/v1/receipts/verify', { receipt }, signal)
  if (!res.ok) throw new GateError({ kind: res.status === 400 ? 'rejected' : 'failed', message: await readError(res) })
  try {
    return (await res.json()) as Verification
  } catch {
    throw new GateError({ kind: 'failed' })
  }
}
