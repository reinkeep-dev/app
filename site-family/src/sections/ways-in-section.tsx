import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useReducedMotion } from 'motion/react'
import { ScrollReveal } from '@/components/scroll-reveal'
import { cn } from '@/lib/utils'

// Family's "Send, receive, swap" row, with three silent loop clips instead of phones: the three real ways to
// use Reinkeep today. Clips are made with motionmaxxing in ../clips-film (NOTE.md there); their on-screen
// output is the real guard CLI / MCP output for the requests shown.
const WAYS = [
  { key: 'signer', label: 'Signer', color: 'text-grass', dot: 'bg-grass', alt: 'A 0.90 USDG payment to 0x…dEaD is held by the Reinkeep AI ring: BLOCK, over_payment_cap, signed: false.' },
  { key: 'mcp', label: 'MCP', color: 'text-sky', dot: 'bg-sky', alt: 'An agent calls guard_check before paying a new payee; the answer is approve (needs a human) for new_recipient, and the agent waits.' },
  { key: 'cli', label: 'CLI', color: 'text-tangerine', dot: 'bg-tangerine', alt: 'A terminal runs node src/cli.ts check; the output is verdict deny, over_payment_cap, and echo $? prints exit code 3.' },
] as const

// The hosted gate: real addresses an agent or a developer can use today (api/README.md, api/src/discovery.ts).
const GATE = 'https://reinkeep-gate.reinkeep.workers.dev'
const ENDPOINTS = [
  { label: 'REST API', url: `${GATE}/api/v1/gate`, note: 'POST a payment request, get ALLOW, REVIEW or BLOCK and a signed receipt.' },
  { label: 'MCP server', url: `${GATE}/mcp`, note: 'Add it as a remote MCP server in Claude, Cursor or any MCP client.' },
  { label: 'For agents', url: `${GATE}/llms.txt`, note: 'Everything an agent needs in one text file. Also agent.json and openapi.json.' },
  { label: 'Price', url: `${GATE}/api/v1/gate/pricing`, note: '25 free checks a day per caller, then $0.01 in USDG over x402.' },
] as const

// posters are cut at this time in ../clips-film (ffmpeg -ss 2.6), so a paused card and its poster match
const HERO_FRAME_S = 2.6

function Clip({ name, alt, playing }: { name: string; alt: string; playing: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (playing) {
      v.currentTime = 0
      v.play().catch(() => {}) // autoplay can be refused; the poster stays, which is fine
    } else {
      // rest on the hero frame (same moment as the poster), not wherever the loop happened to be:
      // the last frames of a loop are mid-exit and read as an empty card
      v.pause()
      v.currentTime = HERO_FRAME_S
    }
  }, [playing])
  return (
    <video
      ref={ref}
      src={`/clips/${name}.mp4`}
      poster={`/clips/${name}.webp`}
      muted
      loop
      playsInline
      preload="metadata"
      aria-label={alt}
      className="aspect-[4/3] w-full rounded-xl bg-white object-cover"
    />
  )
}

export function WaysInSection() {
  const reduce = useReducedMotion()
  const [active, setActive] = useState(0)
  useEffect(() => {
    if (reduce) return
    const t = setInterval(() => setActive((a) => (a + 1) % WAYS.length), 6000)
    return () => clearInterval(t)
  }, [reduce])
  return (
    <section className="mx-auto max-w-[1040px] border-t border-hair px-5 py-20">
      <ScrollReveal>
        <h2 className="text-[34px] font-semibold leading-tight sm:text-[44px]">
          Signer, MCP, CLI.
          <br />
          Pick how it plugs in.
        </h2>
      </ScrollReveal>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {WAYS.map((w, i) => (
          <ScrollReveal key={w.key} delay={i * 0.08}>
            <button type="button" onClick={() => setActive(i)} className="group block w-full text-left" aria-pressed={active === i}>
              <div className={cn('rounded-2xl bg-panel p-3 transition-transform duration-300', active === i && 'md:-translate-y-1')}>
                <Clip name={w.key} alt={w.alt} playing={!reduce && active === i} />
              </div>
              <span className={cn('mt-3 flex items-center justify-center gap-2 text-[15px] font-medium transition-colors', active === i ? w.color : 'text-ink/40')}>
                <span className={cn('size-2 rounded-full', active === i ? w.dot : 'bg-ink/20')} />
                {w.label}
              </span>
            </button>
          </ScrollReveal>
        ))}
      </div>
      <p className="mt-6 text-center text-[14px] text-ink/65">Only the signer enforces. The MCP tools advise, and an agent that skips them is not stopped.</p>
      <ScrollReveal>
        <dl className="mt-14 divide-y divide-hair border-y border-hair">
          {ENDPOINTS.map((e) => (
            <div key={e.label} className="grid gap-1 py-4 sm:grid-cols-[140px_1fr] sm:gap-6">
              <dt className="text-[15px] font-medium">{e.label}</dt>
              <dd className="min-w-0">
                <a href={e.url} rel="noopener" className="block break-all font-mono text-[14px] text-ink underline decoration-hair underline-offset-4 hover:decoration-ink">
                  {e.url}
                </a>
                <p className="mt-1 text-[15px] text-ink/65">{e.note}</p>
              </dd>
            </div>
          ))}
        </dl>
      </ScrollReveal>
      <p className="mt-8">
        <Link to="/docs" className="inline-flex min-h-12 items-center rounded-full bg-ink px-6 text-[15px] font-medium text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.97]">
          Read the docs
        </Link>
      </p>
    </section>
  )
}
