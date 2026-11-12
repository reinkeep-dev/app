import { ScrollReveal } from '@/components/scroll-reveal'

// Family's grey band of six feature paragraphs. Every claim here is something the code does today.
const FEATURES = [
  { label: 'Spend caps', color: 'text-sky', text: 'A cap per payment, per website and per day. The defaults are $0.10, a host cap you choose, and $1 a day.' },
  { label: 'New recipients', color: 'text-tangerine', text: 'The first payment to an address you have never paid waits for a human. You decide once, then it is known.' },
  { label: 'Quote changes', color: 'text-tomato', text: 'If the amount at signing is not the amount that was quoted, the gate refuses it. No silent price bumps.' },
  { label: 'Replays and bursts', color: 'text-grass', text: 'The same payment twice within 30 seconds, or more than 10 in a minute, never reaches the signer.' },
  { label: 'Right chain, right token', color: 'text-sky', text: 'Only the chains and tokens you allow. Out of the box that is USDG on Robinhood Chain.' },
  { label: 'Audit log', color: 'text-tangerine', text: 'Every decision is written to a hash-chained log. Editing an old line breaks the chain and is caught.' },
]

export function FeatureBand() {
  return (
    <section className="bg-panel">
      <div className="mx-auto grid max-w-[1040px] gap-x-16 gap-y-12 px-5 py-20 md:grid-cols-2">
        {FEATURES.map((f, i) => (
          <ScrollReveal key={f.label} delay={(i % 2) * 0.08}>
            <h3 className={`text-[14px] font-semibold ${f.color}`}>{f.label}</h3>
            <p className="mt-2 text-[17px] leading-relaxed text-ink/70">{f.text}</p>
          </ScrollReveal>
        ))}
      </div>
    </section>
  )
}
