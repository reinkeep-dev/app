import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'

// 100 tokens that launched. The green ones are still trading a day later. Dots light up left to right when scrolled into view.
export function OddsDots({ share }: { share: number | null }) {
  const reduce = useReducedMotion()
  const lit = share === null ? 0 : Math.round(share)
  return (
    <div aria-hidden className="grid max-w-[440px] grid-cols-[repeat(25,minmax(0,1fr))] gap-[3px] sm:gap-1">
      {Array.from({ length: 100 }, (_, i) => (
        <motion.span
          key={i}
          className={cn('aspect-square rounded-full', i < lit ? 'bg-allow' : 'bg-ink/12')}
          initial={reduce ? false : { scale: 0.3, opacity: 0.4 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true, margin: '0px 0px -10% 0px' }}
          transition={{ delay: reduce ? 0 : i * 0.008, type: 'spring', stiffness: 400, damping: 20 }}
        />
      ))}
    </div>
  )
}
