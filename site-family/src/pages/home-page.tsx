import { Link } from 'react-router'
import { HeroSection } from '@/sections/hero-section'
import { AgentsSection } from '@/sections/agents-section'
import { HowItWorksSection } from '@/sections/how-it-works-section'
import { PolicyReceiptSection } from '@/sections/policy-receipt-section'
import { ToolsSection } from '@/sections/tools-section'
import { FeatureBand } from '@/sections/feature-band'
import { RoadmapSection } from '@/sections/roadmap-section'
import { FaqSection } from '@/sections/faq-section'
import { GateDemo } from '@/features/gate/gate-demo'
import { ScrollReveal } from '@/components/scroll-reveal'
import { useDocumentTitle } from '@/lib/use-document-title'

// Section order follows a feature tour (agents, how it works, rules and receipts, every tool, roadmap), in the
// Family-style look. Every claim is something the live gate does; what is not built sits under "Not yet".
export default function HomePage() {
  useDocumentTitle('Reinkeep AI: the pre-trade gate for AI agents')
  return (
    <>
      <HeroSection />
      <AgentsSection />
      <HowItWorksSection />
      <PolicyReceiptSection />
      <section id="decides" aria-labelledby="decides-title" className="bg-panel">
        <div className="mx-auto max-w-[1040px] px-5 py-20">
          <ScrollReveal>
            <p className="text-[14px] font-semibold text-grass">Try it here</p>
            <h2 id="decides-title" className="mt-3 text-[34px] font-semibold leading-tight sm:text-[44px]">Go on, try to sneak a payment past Keep.</h2>
            <p className="mt-3 max-w-[520px] text-[17px] text-ink/65">This toy runs the real rules engine in your browser. Nothing is sent anywhere, so it never touches the live gate.</p>
          </ScrollReveal>
          <ScrollReveal delay={0.1} className="mt-10">
            <GateDemo />
          </ScrollReveal>
          <ScrollReveal className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-[16px]">
            <Link to="/gate" className="inline-flex min-h-12 items-center rounded-full bg-ink px-6 text-[15px] font-medium text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.97]">
              Run it on the live gate
            </Link>
            <Link to="/check" className="inline-flex min-h-12 items-center font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ink">
              Check a token instead
            </Link>
          </ScrollReveal>
        </div>
      </section>
      <ToolsSection />
      <FeatureBand />
      <RoadmapSection />
      <FaqSection />
    </>
  )
}
