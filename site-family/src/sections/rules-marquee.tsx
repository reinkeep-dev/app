import { Marquee } from '@/components/ui/marquee'
import rules from '@data/rules.json'

// Where Family shows tweets, Reinkeep shows its rules: one row for how the agent pays, one for what it buys,
// moving in opposite directions. (No testimonials yet, and none are invented.) Counts come from rules.json.
type Rule = (typeof rules)[number]

function RuleCard({ r }: { r: Rule }) {
  const deny = r.kind === 'deny'
  return (
    <figure className="w-[300px] rounded-2xl border border-hair bg-white p-5">
      <figcaption className="flex items-center justify-between gap-3">
        <code className="truncate font-mono text-[13px] font-medium">{r.code}</code>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold text-white ${deny ? 'bg-block' : 'bg-review'}`}>{deny ? 'BLOCK' : 'REVIEW'}</span>
      </figcaption>
      <p className="mt-3 text-[15px] leading-snug text-ink/65">{r.plain}</p>
    </figure>
  )
}

export function RulesMarquee() {
  const pays = rules.filter((r) => r.side === 'pays')
  const buys = rules.filter((r) => r.side === 'buys')
  return (
    <section id="rules" className="border-t border-hair py-20">
      <div className="mx-auto max-w-[1040px] px-5">
        <h2 className="text-[34px] font-semibold leading-tight sm:text-[44px]">{rules.length} reasons to stop and ask.</h2>
        <p className="mt-3 text-[17px] text-ink/65">
          {pays.length} on how it pays, {buys.length} on what it buys. Every rule in plain words. Hover to pause.
        </p>
      </div>
      <div className="relative mt-10">
        <Marquee pauseOnHover className="[--duration:60s]">
          {pays.map((r) => <RuleCard key={r.code} r={r} />)}
        </Marquee>
        <Marquee reverse pauseOnHover className="[--duration:50s]">
          {buys.map((r) => <RuleCard key={r.code} r={r} />)}
        </Marquee>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-white" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-white" />
      </div>
    </section>
  )
}
