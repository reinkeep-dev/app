import type { ReactNode } from 'react'
import { ScrollReveal } from '@/components/scroll-reveal'
import { cn } from '@/lib/utils'

// Family's alternating "picture | words" block: coloured label, two-line headline, paragraph, ticked list.
export function SplitSection({
  label,
  tone,
  title,
  text,
  ticks,
  visual,
  flip = false,
  id,
}: {
  label: string
  tone: string
  title: ReactNode
  text: string
  ticks: string[]
  visual: ReactNode
  flip?: boolean
  id?: string
}) {
  return (
    <section id={id} className="mx-auto max-w-[1040px] border-t border-hair px-5 py-20">
      <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
        <ScrollReveal className={cn('flex min-h-[380px] items-center justify-center overflow-hidden rounded-2xl bg-panel p-6', flip && 'md:order-2')}>{visual}</ScrollReveal>
        <ScrollReveal delay={0.08}>
          <p className={cn('text-[14px] font-semibold', tone)}>{label}</p>
          <h2 className="mt-3 text-[34px] font-semibold leading-[1.08] sm:text-[42px]">{title}</h2>
          <p className="mt-4 max-w-[420px] text-[17px] leading-relaxed text-ink/65">{text}</p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {ticks.map((t) => (
              <li key={t} className={cn('flex items-center gap-2.5 text-[15px] font-medium', tone)}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                {t}
              </li>
            ))}
          </ul>
        </ScrollReveal>
      </div>
    </section>
  )
}
