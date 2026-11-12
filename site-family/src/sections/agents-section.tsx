import { Link } from 'react-router'
import { CodeBlock } from '@/components/code-block'
import { ScrollReveal } from '@/components/scroll-reveal'
import { GATE } from '@/features/gate-tool/gate-api'
import { MCP_CLAUDE } from '@/features/docs/docs-snippets'

// "Built for agents": the three ways an agent plugs in today, then four facts. Every number below was read from the
// gate code on 2026-11-12 (api/src/mcp.ts = 16 tools, /api/v1/gate/pricing = 25 free, $0.01 USDG). The 16 are live only
// once the API with mandates, pre-mortem and launch data is deployed; deploy the API together with this page.
const WAYS = [
  { n: '01', label: 'MCP', note: 'One line in Claude Code. Any MCP client works with the same URL.', code: MCP_CLAUDE },
  // Paths only: the full host does not fit a third of the row and three cut-off URLs look identical. Host is shown once above.
  { n: '02', label: 'REST', note: 'POST the payment before it is signed. JSON in, decision and signed receipt out.', code: 'POST /api/v1/gate' },
  { n: '03', label: 'Discover', note: 'Files an agent can read on its own to find the gate and learn how to call it.', code: '/llms.txt\n/.well-known/agent.json\n/api/v1/openapi.json' },
] as const

const FACTS = [
  { big: '16', small: 'MCP tools' },
  { big: '25', small: 'free checks a day' },
  { big: '$0.01', small: 'per call after that, USDG over x402' },
  { big: 'EIP-712', small: 'signed receipts' },
] as const

export function AgentsSection() {
  return (
    <section id="agents" aria-labelledby="agents-title" className="mx-auto max-w-[1040px] border-t border-hair px-5 py-20">
      <ScrollReveal>
        <p className="text-[14px] font-semibold text-sky">Built for agents</p>
        <h2 id="agents-title" className="mt-3 text-[34px] font-semibold leading-tight sm:text-[44px]">
          Your agent asks.
          <br />
          Reinkeep answers first.
        </h2>
        <p className="mt-3 max-w-[560px] text-[17px] text-ink/65">
          It is a tool your agent calls, not a dashboard someone has to watch. No account and no API key: the first 25 checks each day are free, then the agent pays per call.
        </p>
        <p className="mt-4 text-[15px] text-ink/65">
          Base URL{' '}
          <a href={GATE} target="_blank" rel="noopener" className="break-all font-mono text-[14px] text-ink underline decoration-hair underline-offset-4 hover:decoration-ink">
            {GATE}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      </ScrollReveal>
      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {WAYS.map((w, i) => (
          <ScrollReveal key={w.label} delay={i * 0.08} className="flex min-w-0 flex-col">
            <p className="flex items-baseline gap-3">
              <span className="font-mono text-[13px] text-ink/40">{w.n}</span>
              <span className="text-[18px] font-semibold">{w.label}</span>
            </p>
            <p className="mt-1.5 text-[15px] leading-snug text-ink/65">{w.note}</p>
            <div className="mt-4">
              <CodeBlock code={w.code} label={w.label} />
            </div>
          </ScrollReveal>
        ))}
      </div>
      <ScrollReveal>
        <dl className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-hair pt-10 md:grid-cols-4">
          {FACTS.map((f) => (
            <div key={f.small}>
              <dt className="sr-only">{f.small}</dt>
              <dd>
                <span className="block text-[32px] font-semibold leading-none tracking-tight">{f.big}</span>
                <span className="mt-2 block text-[15px] text-ink/65">{f.small}</span>
              </dd>
            </div>
          ))}
        </dl>
      </ScrollReveal>
      <p className="mt-10">
        <Link to="/docs" className="inline-flex min-h-12 items-center rounded-full bg-ink px-6 text-[15px] font-medium text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.97]">
          Read the docs
        </Link>
      </p>
    </section>
  )
}
