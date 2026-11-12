import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { ScrollReveal } from '@/components/scroll-reveal'

// Family's "Details that matter": sticky headline on the left, a column of small animated cards scrolling past.
function Detail({ label, tone, text, children }: { label: string; tone: string; text: string; children: ReactNode }) {
  return (
    <ScrollReveal>
      <div className="flex h-[200px] items-center justify-center overflow-hidden rounded-2xl bg-panel">{children}</div>
      <p className={`mt-5 text-[14px] font-semibold ${tone}`}>{label}</p>
      <p className="mt-2 text-[17px] leading-relaxed text-ink/60">{text}</p>
    </ScrollReveal>
  )
}

const pulse = { animate: { scale: [1, 1.04, 1] }, transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' as const } }

export function DetailsSection() {
  return (
    <section className="mx-auto grid max-w-[1040px] gap-12 border-t border-hair px-5 py-20 md:grid-cols-2 md:gap-16">
      <div className="md:sticky md:top-28 md:self-start">
        <h2 className="text-[34px] font-semibold leading-tight sm:text-[44px]">Details that matter.</h2>
        <p className="mt-3 text-[17px] text-ink/60">The small cases are where agents lose money.</p>
      </div>
      <div className="grid gap-16">
        <Detail label="Fails closed" tone="text-sky" text="When a fact is missing, the answer is REVIEW, never ALLOW. Unknown is not the same as safe.">
          <motion.div {...pulse} className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 shadow-sm">
            <span className="font-mono text-[14px] text-ink/40">token facts: missing</span>
            <span className="rounded-full bg-review px-3 py-1 text-[13px] font-semibold text-white">REVIEW</span>
          </motion.div>
        </Detail>
        <Detail label="Asks once" tone="text-tangerine" text="A first-time payee or a payment over $0.05 waits for a human. Approve it once and it is known from then on.">
          <div className="flex items-center gap-3">
            <img src="/assets/keep-review.webp" alt="" width={110} height={110} />
            <motion.span {...pulse} className="rounded-full bg-ink px-4 py-2 text-[14px] font-medium text-white">Approve this payee?</motion.span>
          </div>
        </Detail>
        <Detail label="Catches replays" tone="text-grass" text="The same payment twice inside 30 seconds is refused, so a looping agent cannot pay a vendor ten times.">
          <div className="space-y-2">
            {['0.03 USDG · ALLOW', '0.03 USDG · BLOCK duplicate_payment'].map((t, i) => (
              <motion.p
                key={t}
                className={`rounded-xl bg-white px-4 py-2.5 font-mono text-[13px] shadow-sm ${i ? 'text-block' : 'text-allow'}`}
                initial={{ opacity: 0, x: -16 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 + i * 0.6 }}
              >
                {t}
              </motion.p>
            ))}
          </div>
        </Detail>
        <Detail label="Same question, same answer" tone="text-tomato" text="No model, no mood, no score. The rules are code, so the same request always gets the same answer and the same receipt.">
          {/* the receipt the demo below gives for its default request; same hashing, so it must match */}
          <div className="space-y-2 text-center font-mono text-[14px]">
            {[0, 1].map((i) => (
              <p key={i} className="rounded-xl bg-white px-4 py-2.5 shadow-sm">
                default request → <motion.span animate={{ opacity: [0.45, 1, 0.45] }} transition={{ duration: 2, repeat: Infinity, delay: i * 0.3 }}>rk_7110090a</motion.span>
              </p>
            ))}
          </div>
        </Detail>
      </div>
    </section>
  )
}
