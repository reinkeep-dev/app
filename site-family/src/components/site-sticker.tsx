import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

// One rendered sticker or mascot pose from public/assets (made in ../studio with Remotion).
// `bob` floats it with the CSS `animate-bob` keyframes; `delay` staggers neighbours.
export function SiteSticker({
  name,
  size,
  className,
  bob = true,
  delay = 0,
  rotate = 0,
}: {
  name: string
  size: number
  className?: string
  bob?: boolean
  delay?: number
  rotate?: number
}) {
  const style = { width: size, height: size, animationDelay: `${delay}s`, '--r': `${rotate}deg`, rotate: bob ? undefined : `${rotate}deg` } as CSSProperties
  return (
    <img
      src={`/assets/${name}.webp`}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      className={cn('pointer-events-none select-none', bob && 'animate-bob', className)}
      style={style}
    />
  )
}
