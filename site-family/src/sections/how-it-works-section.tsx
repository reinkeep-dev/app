import { ScrollReveal } from '@/components/scroll-reveal'
import { SiteSticker } from '@/components/site-sticker'

// Four parts, one answer. Each card is something the live gate does today (api/README.md, llms.txt).
const STEPS = [
  { n: '01', tag: 'policy', title: 'Rules', sticker: 'sticker-lock', text: 'A built-in preset or your own: caps per payment and per day, known payees, a liquidity floor for the token.' },
  { n: '02', tag: 'POST /gate', title: 'Gate', sticker: 'sticker-bolt', text: 'Before the agent signs, it sends the payment and the token it is buying. Both are checked in one call.' },
  { n: '03', tag: 'decision', title: 'Answer', sticker: 'sticker-check', text: 'ALLOW, REVIEW or BLOCK, with every rule that decided it and two plain sentences on why.' },
  { n: '04', tag: 'EIP-712', title: 'Receipt', sticker: 'sticker-receipt', text: 'Signed and stored. Anyone can check who signed it, with our verify endpoint or their own code.' },
] as const

export function HowItWorksSection() {
  return (
    <section id="how" aria-labelledby="how-title" className="bg-panel">
      <div className="mx-auto max-w-[1040px] px-5 py-20">
        <ScrollReveal>
          <p className="text-[14px] font-semibold text-grass">How it works</p>
          <h2 id="how-title" className="mt-3 text-[34px] font-semibold leading-tight sm:text-[44px]">Four parts. One answer you can check.</h2>
        </ScrollReveal>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <ScrollReveal key={s.n} delay={i * 0.08} className="h-full">
              <li className="flex h-full flex-col rounded-2xl bg-white p-6">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-mono text-[12px] text-ink/45">
                    {s.n} / 04 · {s.tag}
                  </p>
                  <span aria-hidden="true" className="-mr-1 -mt-1 shrink-0">
                    <SiteSticker name={s.sticker} size={44} delay={i * 0.4} />
                  </span>
                </div>
                <h3 className="mt-6 text-[20px] font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink/60">{s.text}</p>
              </li>
            </ScrollReveal>
          ))}
        </ol>
      </div>
    </section>
  )
}
