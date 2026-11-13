import { Link } from 'react-router'
import { ScrollReveal } from '@/components/scroll-reveal'
import { SiteSticker } from '@/components/site-sticker'

import { GATE } from '@/features/gate-tool/gate-api'

type Item = { label: string; to?: string; href?: string }
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Product',
    items: [
      { label: 'Gate', to: '/gate' },
      { label: 'Check', to: '/check' },
      { label: 'Board', to: '/board' },
      { label: 'Odds', to: '/odds' },
      { label: 'Radar', to: '/radar' },
      { label: 'Autopsy', to: '/autopsy' },
      { label: 'Pre-mortem', to: '/premortem' },
      { label: 'Docs', to: '/docs' },
      { label: 'Status', to: '/status' },
    ],
  },
  {
    title: 'For agents',
    items: [
      { label: 'llms.txt', href: `${GATE}/llms.txt` },
      { label: 'agent.json', href: `${GATE}/.well-known/agent.json` },
      { label: 'OpenAPI', href: `${GATE}/api/v1/openapi.json` },
      { label: 'MCP', to: '/docs#mcp' },
    ],
  },
  {
    title: 'Project',
    items: [
      { label: 'Open data on GitHub', href: 'https://github.com/reinkeep-dev/data' },
      { label: 'MCP server on GitHub', href: 'https://github.com/reinkeep-dev/mcp' },
      { label: 'X @reinkeepgate', href: 'https://x.com/reinkeepgate' },
    ],
  },
]

const linkClass = 'inline-flex min-h-10 items-center rounded-md text-[15px] text-ink/70 outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-ink'

export function SiteFooter() {
  return (
    <footer className="border-t border-hair">
      <ScrollReveal className="mx-auto flex max-w-[1040px] flex-col items-center px-5 py-20 text-center">
        <SiteSticker name="keep-hello" size={150} />
        <h2 className="mt-4 text-[34px] font-semibold leading-tight sm:text-[44px]">Give your agent rules, not your card.</h2>
        <p className="mt-3 max-w-[440px] text-[17px] text-ink/65">Reinkeep AI is a pre-trade gate for AI agents on Robinhood Chain. Early access. Reviewed by our team, no outside audit yet.</p>
        <Link to="/gate" className="mt-8 inline-flex min-h-12 items-center rounded-full bg-ink px-6 text-[15px] font-medium text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.97]">
          Try the gate
        </Link>
      </ScrollReveal>
      <div className="mx-auto grid max-w-[1040px] gap-8 border-t border-hair px-5 py-10 sm:grid-cols-3">
        {GROUPS.map((g) => (
          <nav key={g.title} aria-label={g.title}>
            <h2 className="text-[14px] font-semibold">{g.title}</h2>
            <ul className="mt-2">
              {g.items.map((it) => (
                <li key={it.label}>
                  {it.to ? (
                    <Link to={it.to} className={linkClass}>
                      {it.label}
                    </Link>
                  ) : (
                    <a href={it.href} target="_blank" rel="noopener" className={linkClass}>
                      {it.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto flex max-w-[1040px] flex-wrap items-center gap-4 border-t border-hair px-5 py-8 text-[14px] text-ink/65">
        <p className="flex items-start gap-2">
          <img src="/logo.webp" alt="" width={20} height={20} className="mt-0.5 rounded-full" />
          <span>Reinkeep AI · early access, team-reviewed, no outside audit yet · independent project, not affiliated with Robinhood · not financial advice</span>
        </p>
      </div>
    </footer>
  )
}
