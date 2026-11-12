import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'

// Top of every tool page: kicker, headline, one line of text and a decorative render on the right.
// The render sits in a fixed 4:3 box, so the layout is the same whether the file has loaded, failed, or not been made yet.
export function PageHero({ kicker, tone, title, text, image, children }: { kicker: string; tone: string; title: ReactNode; text: string; image: string; children?: ReactNode }) {
  const [failed, setFailed] = useState(false)
  return (
    <section className="mx-auto grid max-w-[1040px] items-center gap-8 px-5 pb-6 pt-10 sm:grid-cols-[1fr_300px] sm:pt-14 md:grid-cols-[1fr_380px]">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.2, 0.7, 0.1, 1] }}>
        <p className={`text-[14px] font-semibold ${tone}`}>{kicker}</p>
        <h1 className="mt-3 text-[40px] font-semibold leading-[1.05] sm:text-[52px]">{title}</h1>
        <p className="mt-4 max-w-[520px] text-[17px] leading-relaxed text-ink/65">{text}</p>
        {children}
      </motion.div>
      <div aria-hidden="true" className="hidden aspect-[4/3] w-full items-center justify-center rounded-2xl bg-panel sm:flex">
        <img
          src={image}
          alt=""
          width={1200}
          height={900}
          draggable={false}
          onError={() => setFailed(true)}
          className={failed ? 'invisible size-full object-contain' : 'size-full select-none object-contain'}
        />
      </div>
    </section>
  )
}
