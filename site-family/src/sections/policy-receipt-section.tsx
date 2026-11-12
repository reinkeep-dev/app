import { Link } from 'react-router'
import { CodeBlock } from '@/components/code-block'
import { ScrollReveal } from '@/components/scroll-reveal'
import { ReceiptSlip } from '@/features/gate/receipt-slip'

// The built-in preset exactly as GET /api/v1/gate/presets returned it on 2026-11-12 (formatted, nothing changed).
const PRESET = `{
  "reinkeep-default-v1": {
    "networks": ["eip155:4663"],
    "assets": ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"],
    "perPaymentUsd": 0.1,
    "dailyUsd": 1,
    "approveAboveUsd": 0.05,
    "maxValiditySec": 120,
    "duplicateWindowSec": 30,
    "maxPerMinute": 10,
    "token": { "reviewBelowLiquidityUsd": 1000 }
  }
}`

export function PolicyReceiptSection() {
  return (
    <section aria-labelledby="proof-title" className="mx-auto max-w-[1040px] border-t border-hair px-5 py-20">
      <ScrollReveal>
        <p className="text-[14px] font-semibold text-tangerine">Rules and receipts</p>
        <h2 id="proof-title" className="mt-3 text-[34px] font-semibold leading-tight sm:text-[44px]">
          Rules you can read.
          <br />
          Receipts you can check.
        </h2>
      </ScrollReveal>
      <div className="mt-10 grid items-start gap-10 md:grid-cols-2 md:gap-12">
        <ScrollReveal className="min-w-0">
          <p className="text-[17px] leading-relaxed text-ink/65">
            No score to trust. A policy is a short piece of JSON, and every answer names the rule that fired. A token the gate knows nothing about is never let through: unknown means REVIEW.
          </p>
          <div className="mt-6">
            <CodeBlock code={PRESET} label="The built-in preset, live" />
          </div>
          <Link to="/gate" className="mt-6 inline-flex min-h-12 items-center font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ink">
            Change it and run it on the gate
          </Link>
        </ScrollReveal>
        <ScrollReveal delay={0.1} className="flex flex-col items-center">
          <ReceiptSlip />
          <p className="mt-6 max-w-[360px] text-center text-[15px] leading-relaxed text-ink/65">
            The answer is half of it. The receipt names the payment, the rules and the decision, and carries a signature your own code can verify, or send to <span className="font-mono text-[14px]">/api/v1/receipts/verify</span>.
          </p>
        </ScrollReveal>
      </div>
    </section>
  )
}
