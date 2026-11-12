import { ScrollReveal } from '@/components/scroll-reveal'
import roadmap from '@data/roadmap.json'

// In place of Family's blog cards: what is live, being built, and next. Same data as the old site.
const STATE = {
  live: { label: 'Live', cls: 'bg-allow/12 text-allow' },
  building: { label: 'Building', cls: 'bg-review/12 text-review' },
  next: { label: 'Next', cls: 'bg-ink/8 text-ink/60' },
} as const

export function RoadmapSection() {
  return (
    <section className="mx-auto max-w-[1040px] border-t border-hair px-5 py-20">
      <ScrollReveal>
        <h2 className="text-[34px] font-semibold leading-tight sm:text-[44px]">What runs today, and what is next.</h2>
      </ScrollReveal>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {roadmap.map((item, i) => {
          const s = STATE[item.state as keyof typeof STATE]
          return (
            <ScrollReveal key={item.title} delay={(i % 2) * 0.06}>
              <article className="h-full rounded-2xl bg-panel p-6">
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${s.cls}`}>{s.label}</span>
                <h3 className="mt-3 text-[18px] font-semibold tracking-tight">{item.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink/60">{item.text}</p>
              </article>
            </ScrollReveal>
          )
        })}
      </div>
    </section>
  )
}
