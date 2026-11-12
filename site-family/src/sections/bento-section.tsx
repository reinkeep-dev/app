import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { NumberTicker } from '@/components/ui/number-ticker'
import { ScrollReveal } from '@/components/scroll-reveal'
import { cn } from '@/lib/utils'
import assets from '@/generated/asset-manifest.json'
import rules from '@data/rules.json'

// Family's "Explore Ethereum" bento: one tall dark card plus four small cards, each with a tiny loop.
function useTick(count: number, ms: number) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % count), ms)
    return () => clearInterval(t)
  }, [count, ms])
  return i
}

function Card({ title, text, children, className }: { title: string; text: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col overflow-hidden rounded-2xl bg-panel', className)}>
      <div className="relative flex min-h-[180px] flex-1 items-center justify-center overflow-hidden p-5">{children}</div>
      <div className="px-5 pb-5">
        <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
        <p className="mt-1 text-[14px] leading-snug text-ink/65">{text}</p>
      </div>
    </div>
  )
}

const STEPS = [
  { icon: '↗', color: 'bg-sky', title: 'Ask', text: 'The agent sends the payment it wants to make.' },
  { icon: '✓', color: 'bg-grass', title: 'Check', text: 'How it pays and what it buys, checked together.' },
  { icon: '!', color: 'bg-tangerine', title: 'Answer', text: 'ALLOW, REVIEW or BLOCK, with the reason.' },
  { icon: '≡', color: 'bg-ink ring-1 ring-white/30', title: 'Receipt', text: 'A hash of the request and the answer.' },
]

function StepsCard() {
  const on = useTick(STEPS.length, 1800)
  return (
    <div className="w-full max-w-[300px] rounded-2xl bg-ink p-2 text-white shadow-xl">
      {STEPS.map((s, i) => (
        <div key={s.title} className="relative flex gap-3 rounded-xl p-3">
          {on === i && <motion.span layoutId="step-hi" className="absolute inset-0 rounded-xl bg-white/12" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
          <span className={cn('relative grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold', s.color)}>{s.icon}</span>
          <span className="relative">
            <span className="block text-[15px] font-semibold">{s.title}</span>
            <span className="block text-[13px] leading-snug text-white/60">{s.text}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

const ANSWERS = [
  { word: 'ALLOW', bg: 'bg-allow', ring: 'ring-allow/20' },
  { word: 'REVIEW', bg: 'bg-review', ring: 'ring-review/20' },
  { word: 'BLOCK', bg: 'bg-block', ring: 'ring-block/20' },
]

function AnswerPill() {
  const a = ANSWERS[useTick(ANSWERS.length, 1600)]
  return (
    <div className={cn('rounded-full p-2 ring-8 transition-shadow duration-500', a.ring)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={a.word}
          className={cn('inline-flex rounded-full px-6 py-3 text-[20px] font-semibold text-white', a.bg)}
          initial={{ y: 16, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -16, opacity: 0, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
        >
          {a.word}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}

const TRAIL = ['Request received', 'Rules checked', 'BLOCK · over_payment_cap']

function TrailCard() {
  const n = useTick(TRAIL.length + 1, 1100)
  return (
    <ol className="w-full max-w-[260px] rounded-xl bg-white p-4 text-[14px] shadow-sm">
      {TRAIL.map((t, i) => (
        <li key={t} className="flex items-center gap-3 py-1.5">
          <span className={cn('size-3.5 shrink-0 rounded-full border-2 transition-colors duration-300', i < n ? 'border-sky bg-sky' : 'border-hair')} />
          <span className={cn('transition-colors duration-300', i < n ? (i === TRAIL.length - 1 ? 'font-medium text-block' : 'text-sky') : 'text-ink/30')}>{t}</span>
        </li>
      ))}
    </ol>
  )
}

// All poses stay mounted and only slide (x, scale, opacity), so nothing is re-created or re-decoded on each step:
// the old version keyed three <img>s by pose, so every tick mounted a fresh image that popped in at its natural size.
// Slots: 0 = centre, +-1 = sides, +-2 = parked just outside the frame at opacity 0 (the wrap jump happens there).
const MOOD_SIZE = 92
const MOOD_SIDE_SCALE = 64 / 92
const MOOD_STEP = 86

function MoodCarousel() {
  const moods = assets.poses
  const i = useTick(moods.length, 1500)
  const n = moods.length
  return (
    <div className="relative h-[92px] w-[236px] overflow-hidden" aria-hidden="true">
      {moods.map((name, k) => {
        let d = (((k - i) % n) + n) % n
        if (d > n / 2) d -= n
        const visible = Math.abs(d) <= 1
        return (
          <motion.img
            key={name}
            src={`/assets/${name}.webp`}
            alt=""
            width={MOOD_SIZE}
            height={MOOD_SIZE}
            decoding="async"
            className="absolute left-1/2 top-0 -ml-[46px] size-[92px] rounded-full bg-white"
            initial={false}
            animate={{ x: Math.max(-2, Math.min(2, d)) * MOOD_STEP, scale: d === 0 ? 1 : MOOD_SIDE_SCALE, opacity: d === 0 ? 1 : visible ? 0.6 : 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        )
      })}
    </div>
  )
}

export function BentoSection() {
  return (
    <section id="how" className="mx-auto max-w-[1040px] px-5 py-20">
      <ScrollReveal>
        <h2 className="text-center text-[34px] font-semibold leading-tight sm:text-[44px]">Let your agent spend, calmly.</h2>
      </ScrollReveal>
      <ScrollReveal delay={0.1} className="mt-12 grid gap-4 md:grid-cols-3 md:grid-rows-2">
        <Card title="Simple" text="Four steps before any payment is signed." className="md:row-span-2">
          <StepsCard />
        </Card>
        <Card title="One answer" text="Never a score, never a maybe.">
          <AnswerPill />
        </Card>
        <Card title="Explained" text="Every answer names the rule that decided it.">
          <TrailCard />
        </Card>
        <Card title="Strict" text="Caps, recipients and replays, plus mint, blacklist and copycat tokens.">
          <p className="text-[56px] font-semibold leading-none tracking-tight">
            <NumberTicker value={rules.length} className="tracking-tight" />
            <span className="ml-2 text-[18px] font-medium text-ink/65">rules</span>
          </p>
        </Card>
        <Card title="Friendly" text="Keep, the gatekeeper, takes the worry out of it.">
          <MoodCarousel />
        </Card>
      </ScrollReveal>
    </section>
  )
}
