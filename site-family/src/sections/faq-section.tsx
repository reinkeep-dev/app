import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import limits from '@data/limits.json'

// Answers are the project's own limits (../site/data/limits.json) in question form. Nothing beyond them.
const FAQ = [
  { q: 'Is Reinkeep AI audited?', a: limits[0] },
  { q: 'Does the agent have to ask the gate?', a: limits[1] },
  { q: 'Can a clever agent walk around it?', a: limits[2] },
  { q: 'Does it check the token I am buying?', a: limits[3] },
  { q: 'Which tokens can it pay in?', a: limits[4] },
  { q: 'What does a receipt prove today?', a: limits[5] },
]

export function FaqSection() {
  return (
    <section className="mx-auto grid max-w-[1040px] gap-10 border-t border-hair px-5 py-20 md:grid-cols-2 md:gap-16">
      <h2 className="text-[34px] font-semibold leading-tight sm:text-[44px]">
        Frequently asked
        <br />
        questions
      </h2>
      <Accordion type="single" collapsible className="w-full">
        {FAQ.map((f) => (
          <AccordionItem key={f.q} value={f.q} className="border-hair">
            <AccordionTrigger className="py-5 text-[17px] font-medium hover:no-underline">{f.q}</AccordionTrigger>
            <AccordionContent className="pb-5 text-[16px] leading-relaxed text-ink/60">{f.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
