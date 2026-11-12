import { motion } from 'motion/react'

// A paper receipt that "prints" (slides out of a slot) when it scrolls into view.
// Values are the BLOCK case from the demo: 0.90 USDG to 0x…dEaD, over the $0.10 cap.
const ROWS = [
  ['Amount', '0.90 USDG'],
  ['Pay to', '0x…dEaD'],
  ['Chain', 'Robinhood Chain'],
  ['Rule', 'over_payment_cap'],
]

export function ReceiptSlip() {
  return (
    <div className="relative w-full max-w-[300px]">
      <div className="relative z-10 h-4 rounded-full bg-ink" />
      <div className="-mt-2 overflow-hidden px-3">
        <motion.div
          className="bg-white px-5 pb-8 pt-6 shadow-sm [clip-path:polygon(0_0,100%_0,100%_calc(100%-10px),95%_100%,90%_calc(100%-10px),85%_100%,80%_calc(100%-10px),75%_100%,70%_calc(100%-10px),65%_100%,60%_calc(100%-10px),55%_100%,50%_calc(100%-10px),45%_100%,40%_calc(100%-10px),35%_100%,30%_calc(100%-10px),25%_100%,20%_calc(100%-10px),15%_100%,10%_calc(100%-10px),5%_100%,0_calc(100%-10px))]"
          initial={{ y: '-100%' }}
          whileInView={{ y: 0 }}
          viewport={{ once: true, margin: '-20%' }}
          transition={{ duration: 1.4, ease: [0.3, 0.8, 0.2, 1] }}
        >
          <p className="text-center text-[13px] font-semibold tracking-wide">REINKEEP RECEIPT</p>
          <p className="mt-1 text-center font-mono text-[11px] text-ink/45">sample</p>
          <dl className="mt-5 space-y-2 border-y border-dashed border-ink/20 py-4 font-mono text-[12.5px]">
            {ROWS.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-ink/50">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-center text-[34px] font-semibold tracking-tight text-block">BLOCK</p>
          <p className="mt-2 text-center font-mono text-[12px] text-ink/50">signed · EIP-712 · chain 4663</p>
        </motion.div>
      </div>
    </div>
  )
}
