import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useRef, type PointerEvent } from 'react'
import { Link } from 'react-router'
import { SiteSticker } from '@/components/site-sticker'

// Family-style hero: one headline, one line, two pills, and a crowd of stickers you can play with.
// Positions are % of the hero box so the clusters scale with the window. The stickers drift, each at its own depth so
// it feels layered: with the mouse on a computer; on a phone they lean toward a finger on the hero and follow the
// phone's tilt (iPhone asks once, on the first touch). Everywhere they squash on hover and bounce on a tap.
// Reduced motion: no drift, no wave, no bounce (MotionConfig reducedMotion="user" + the check below).
type Placed = { name: string; size: number; left: string; top: string; delay: number; rotate?: number; depth: number }

const DESKTOP: Placed[] = [
  { name: 'keep-hello', size: 230, left: '9%', top: '22%', delay: 0, depth: 10 },
  { name: 'sticker-coin', size: 74, left: '2%', top: '16%', delay: 0.6, rotate: -10, depth: 26 },
  { name: 'sticker-receipt', size: 96, left: '1%', top: '52%', delay: 1.2, rotate: -8, depth: 18 },
  { name: 'sticker-heart', size: 58, left: '27%', top: '40%', delay: 0.3, rotate: 8, depth: 30 },
  { name: 'sticker-star', size: 46, left: '25%', top: '14%', delay: 1.6, rotate: 12, depth: 34 },
  { name: 'sticker-cloud', size: 92, left: '4%', top: '74%', delay: 2.1, depth: 14 },
  { name: 'sticker-sparkle', size: 40, left: '21%', top: '72%', delay: 0.9, depth: 36 },
  { name: 'sticker-horseshoe', size: 64, left: '16%', top: '6%', delay: 2.4, rotate: -6, depth: 22 },
  { name: 'keep-allow', size: 170, left: '73%', top: '36%', delay: 0.4, depth: 12 },
  { name: 'sticker-check', size: 70, left: '70%', top: '14%', delay: 1.1, rotate: -6, depth: 28 },
  { name: 'sticker-question', size: 64, left: '88%', top: '20%', delay: 0.2, rotate: 8, depth: 24 },
  { name: 'sticker-cross', size: 56, left: '92%', top: '50%', delay: 1.8, depth: 32 },
  { name: 'sticker-lock', size: 82, left: '84%', top: '68%', delay: 0.7, rotate: 6, depth: 18 },
  { name: 'sticker-dots', size: 84, left: '79%', top: '6%', delay: 2.2, depth: 20 },
  { name: 'sticker-bolt', size: 50, left: '70%', top: '74%', delay: 1.4, rotate: -12, depth: 34 },
  { name: 'sticker-shield', size: 60, left: '94%', top: '82%', delay: 2.6, depth: 26 },
  { name: 'sticker-ring', size: 70, left: '92%', top: '4%', delay: 0.5, depth: 16 },
]

// Phones: a ring of small stickers around the headline and buttons, kept to the edges so no text is covered.
const PHONE: Placed[] = [
  { name: 'sticker-coin', size: 50, left: '3%', top: '5%', delay: 0.6, rotate: -10, depth: 22 },
  { name: 'sticker-star', size: 34, left: '30%', top: '3%', delay: 1.6, rotate: 12, depth: 30 },
  { name: 'sticker-dots', size: 54, left: '78%', top: '4%', delay: 2.2, depth: 18 },
  { name: 'sticker-heart', size: 40, left: '6%', top: '25%', delay: 0.3, rotate: 8, depth: 26 },
  { name: 'sticker-check', size: 50, left: '82%', top: '22%', delay: 1.1, rotate: -6, depth: 20 },
  { name: 'sticker-receipt', size: 54, left: '1%', top: '86%', delay: 1.2, rotate: -8, depth: 24 },
  { name: 'sticker-sparkle', size: 30, left: '30%', top: '92%', delay: 0.9, depth: 32 },
  { name: 'sticker-lock', size: 50, left: '82%', top: '86%', delay: 0.7, rotate: 6, depth: 18 },
  { name: 'sticker-bolt', size: 34, left: '64%', top: '93%', delay: 1.4, rotate: -12, depth: 28 },
]

function Sticker({ p, i, px, py, still }: { p: Placed; i: number; px: MotionValue<number>; py: MotionValue<number>; still: boolean }) {
  const x = useTransform(px, (v) => v * p.depth)
  const y = useTransform(py, (v) => v * p.depth)
  const keep = p.name.startsWith('keep-')
  return (
    <motion.div className="absolute" style={{ left: p.left, top: p.top, x: still ? 0 : x, y: still ? 0 : y }}>
      <motion.div
        className="cursor-grab"
        initial={{ opacity: 0, scale: 0.6, y: 20 }}
        animate={keep && !still ? { opacity: 1, scale: 1, y: 0, rotate: [0, -4, 3, -4, 0] } : { opacity: 1, scale: 1, y: 0 }}
        transition={
          keep && !still
            ? { opacity: { delay: 0.15 + i * 0.05 }, scale: { type: 'spring', stiffness: 260, damping: 18, delay: 0.15 + i * 0.05 }, y: { type: 'spring', stiffness: 260, damping: 18, delay: 0.15 + i * 0.05 }, rotate: { duration: 2.4, repeat: Infinity, repeatDelay: 2.5, ease: 'easeInOut' } }
            : { type: 'spring', stiffness: 260, damping: 18, delay: 0.15 + i * 0.05 }
        }
        whileHover={{ scale: 1.12, rotate: (p.rotate ?? 0) > 0 ? -8 : 8 }}
        whileTap={{ scale: 0.82 }}
        style={{ transformOrigin: keep ? '50% 90%' : '50% 50%' }}
      >
        <SiteSticker name={p.name} size={p.size} delay={p.delay} rotate={p.rotate} />
      </motion.div>
    </motion.div>
  )
}

export function HeroSection() {
  const still = useReducedMotion() ?? false
  // Pointer position across the hero, -0.5..0.5, eased so the drift lags a little behind the hand.
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const px = useSpring(mx, { stiffness: 50, damping: 18 })
  const py = useSpring(my, { stiffness: 50, damping: 18 })
  const aim = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    mx.set((e.clientX - r.left) / r.width - 0.5)
    my.set((e.clientY - r.top) / r.height - 0.5)
  }
  const reset = () => {
    mx.set(0)
    my.set(0)
  }
  const move = (e: PointerEvent<HTMLElement>) => {
    if (!still && (e.pointerType === 'mouse' || e.buttons)) aim(e)
  }

  // Phone tilt: left/right (gamma) and forward/back (beta, around a 45° hand-held angle) move the stickers.
  // We always listen; a phone that wants permission first (iPhone, newer Chrome) sends nothing until the first touch
  // on the hero asks for it. `tilting` turns true only once a real reading arrives.
  const tilting = useRef(false)
  const asked = useRef(false)
  useEffect(() => {
    if (still || !window.matchMedia('(pointer: coarse)').matches) return
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma === null || e.beta === null) return
      tilting.current = true
      const clamp = (v: number) => Math.max(-0.5, Math.min(0.5, v))
      mx.set(clamp(e.gamma / 40))
      my.set(clamp((e.beta - 45) / 40))
    }
    window.addEventListener('deviceorientation', onTilt)
    return () => window.removeEventListener('deviceorientation', onTilt)
  }, [still, mx, my])
  const down = (e: PointerEvent<HTMLElement>) => {
    if (still || e.pointerType === 'mouse') return
    aim(e)
    const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent
    if (!asked.current && typeof D?.requestPermission === 'function') {
      asked.current = true
      D.requestPermission().catch(() => {})
    }
  }
  const up = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse' && !tilting.current) reset()
  }

  return (
    <section id="top" className="relative overflow-hidden" onPointerMove={move} onPointerLeave={reset} onPointerDown={down} onPointerUp={up} onPointerCancel={up}>
      <div aria-hidden="true" className="absolute inset-0 hidden lg:block">
        {DESKTOP.map((p, i) => (
          <Sticker key={p.name} p={p} i={i} px={px} py={py} still={still} />
        ))}
      </div>
      <div aria-hidden="true" className="absolute inset-0 lg:hidden">
        {PHONE.map((p, i) => (
          <Sticker key={p.name} p={p} i={i} px={px} py={py} still={still} />
        ))}
      </div>
      <div className="pointer-events-none relative mx-auto flex min-h-[620px] max-w-[1040px] flex-col items-center justify-center px-5 pb-24 pt-8 text-center lg:min-h-[680px] lg:pt-0">
        <div aria-hidden="true" className="pointer-events-auto relative mb-4 size-[168px] lg:hidden">
          <Sticker p={{ name: 'keep-hello', size: 168, left: '0', top: '0', delay: 0, depth: 10 }} i={0} px={px} py={py} still={still} />
        </div>
        <motion.h1
          className="max-w-[560px] text-[clamp(32px,10.2vw,44px)] font-semibold leading-[1.04] sm:text-[64px]"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.2, 0.7, 0.1, 1] }}
        >
          Your agent pays.
          <br />
          You hold the reins.
        </motion.h1>
        <motion.p
          className="mt-4 max-w-[360px] text-[17px] leading-relaxed text-ink/60"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1, ease: [0.2, 0.7, 0.1, 1] }}
        >
          Keep checks every payment your agent makes on Robinhood Chain.
        </motion.p>
        <motion.div
          className="pointer-events-auto mt-8 flex flex-wrap justify-center gap-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <Link to="/gate" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-ink px-6 text-[15px] font-medium text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.97]">
            Try the gate
          </Link>
          <Link to="/check" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-panel px-6 text-[15px] font-medium outline-none transition-colors hover:bg-hair focus-visible:ring-2 focus-visible:ring-ink">
            Check a token
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
