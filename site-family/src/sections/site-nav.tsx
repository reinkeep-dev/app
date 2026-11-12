import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router'
import { cn } from '@/lib/utils'

const PAGES = [
  ['Gate', '/gate'],
  ['Check', '/check'],
  ['Board', '/board'],
  ['Odds', '/odds'],
  ['Radar', '/radar'],
  ['Autopsy', '/autopsy'],
  ['Pre-mortem', '/premortem'],
  ['Docs', '/docs'],
] as const
const X_URL = 'https://x.com/reinkeepgate'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn('rounded-md outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-4', isActive ? 'text-ink underline decoration-2 underline-offset-[10px]' : 'text-ink/70')

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  // Escape closes it and hands focus back to the button
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header className={cn('sticky top-0 z-50 bg-white/95 backdrop-blur transition-[border-color] duration-200', scrolled || open ? 'border-b border-hair' : 'border-b border-transparent')}>
      <a href="#main" className="sr-only rounded-full bg-ink px-4 py-2 text-sm text-white focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-10">
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-[1040px] items-center justify-between gap-2 px-4 sm:px-5">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2 whitespace-nowrap rounded-md text-[16px] font-semibold tracking-tight sm:text-[17px] outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-4">
            <img src="/logo.webp" alt="" width={26} height={26} className="rounded-full" />
            Reinkeep AI
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-6 text-[15px] font-medium lg:flex">
            {PAGES.map(([label, to]) => (
              <NavLink key={to} to={to} className={linkClass}>
                {label}
              </NavLink>
            ))}
            <a href={X_URL} target="_blank" rel="noopener" className="rounded-md text-ink/70 outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-4">
              X<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Link to="/gate" className="inline-flex min-h-10 items-center whitespace-nowrap rounded-full bg-ink px-3 text-[13px] font-medium sm:px-4 sm:text-sm text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.97]">
            Try the gate
          </Link>
          <button
            ref={button}
            type="button"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex size-10 items-center justify-center rounded-full bg-panel outline-none transition-colors hover:bg-hair focus-visible:ring-2 focus-visible:ring-ink lg:hidden"
          >
            <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {open ? <path d="M4 4l10 10M14 4L4 14" /> : <path d="M3 5h12M3 9h12M3 13h12" />}
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-menu" aria-label="Main" className="border-t border-hair bg-white lg:hidden">
          <ul className="mx-auto max-w-[1040px] px-5 py-2">
            {PAGES.map(([label, to]) => (
              <li key={to}>
                <NavLink to={to} onClick={() => setOpen(false)} className={({ isActive }) => cn('flex min-h-12 items-center rounded-md text-[18px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ink', isActive ? 'text-ink' : 'text-ink/70')}>
                  {label}
                </NavLink>
              </li>
            ))}
            <li>
              <a href={X_URL} target="_blank" rel="noopener" className="flex min-h-12 items-center rounded-md text-[18px] font-medium text-ink/70 outline-none focus-visible:ring-2 focus-visible:ring-ink">
                X<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          </ul>
        </nav>
      )}
    </header>
  )
}
