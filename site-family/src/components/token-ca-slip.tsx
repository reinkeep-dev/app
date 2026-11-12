import { useState } from 'react'
import { TOKEN_CA, TOKEN_EXPLORER } from '@/lib/token-ca'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

// The token's contract address under the hero buttons: copy it, open it on the explorer.
// Before launch (TOKEN_CA empty) it only says the address comes at launch, so nobody pastes a fake one from a reply.
export function TokenCaSlip() {
  const [copied, setCopied] = useState(false)
  const live = ADDRESS.test(TOKEN_CA)

  async function copy() {
    try {
      await navigator.clipboard.writeText(TOKEN_CA)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="pointer-events-auto mt-6 w-full max-w-[460px]">
      <div className="flex min-h-12 items-center gap-3 rounded-2xl border border-dashed border-ink/25 bg-white/80 px-4 py-2 text-left">
        <span className="shrink-0 text-[12px] font-bold uppercase tracking-[0.12em] text-ink/65">CA</span>
        {live ? (
          <>
            <a
              href={TOKEN_EXPLORER + TOKEN_CA}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ink"
              title={TOKEN_CA}
            >
              {TOKEN_CA}
              <span className="sr-only"> (opens the token on the explorer in a new tab)</span>
            </a>
            <button
              type="button"
              onClick={copy}
              className="min-h-10 shrink-0 rounded-full bg-ink px-4 text-[13px] font-medium text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.97]"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </>
        ) : (
          <span className="min-w-0 flex-1 font-mono text-[13px] text-ink/65">Announced at launch</span>
        )}
      </div>
      <p className="mt-2 text-[13px] text-ink/65" aria-live="polite">
        {live ? 'This is the only Reinkeep token. Any other address using our name is not ours.' : 'Only trust the address posted here and on X @reinkeepgate.'}
      </p>
    </div>
  )
}
