import type { ReactNode } from 'react'
import { motion } from 'motion/react'

// Fade and rise once when the block scrolls into view (Family's section entrance).
// MotionConfig reducedMotion="user" in App turns the movement off for people who ask for less motion.
export function ScrollReveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.6, ease: [0.2, 0.7, 0.1, 1], delay }}
    >
      {children}
    </motion.div>
  )
}
