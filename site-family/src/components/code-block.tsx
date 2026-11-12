import { useState } from 'react'

// A code sample with a copy button. The button label changes to "Copied" and is announced politely.
export function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = code
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl bg-ink text-white">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-1.5">
        <span className="truncate text-[13px] text-white/60">{label}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="min-h-10 shrink-0 rounded-full px-3 text-[13px] font-medium text-white outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white"
        >
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
          <span className="sr-only"> {label}</span>
        </button>
      </div>
      <pre tabIndex={0} className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white">
        <code>{code}</code>
      </pre>
    </div>
  )
}
