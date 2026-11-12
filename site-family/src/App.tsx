import { lazy, Suspense } from 'react'
import { MotionConfig } from 'motion/react'
import { Navigate, Route, Routes } from 'react-router'
import { SiteNav } from '@/sections/site-nav'
import { SiteFooter } from '@/sections/site-footer'
import { RouteEffects } from '@/components/route-effects'
import HomePage from '@/pages/home-page'

// Home ships in the first file; every other page loads when it is opened, so a visitor downloads only what they see.
const GatePage = lazy(() => import('@/pages/gate-page'))
const CheckPage = lazy(() => import('@/pages/check-page'))
const DocsPage = lazy(() => import('@/pages/docs-page'))
const StatusPage = lazy(() => import('@/pages/status-page'))
const PremortemPage = lazy(() => import('@/pages/premortem-page'))
const OddsPage = lazy(() => import('@/pages/odds-page'))
const BoardPage = lazy(() => import('@/pages/board-page'))
const RadarPage = lazy(() => import('@/pages/radar-page'))
const AutopsyPage = lazy(() => import('@/pages/autopsy-page'))
const NotFoundPage = lazy(() => import('@/pages/not-found-page'))

// One shell (nav, footer), one page per route. Home keeps the family.co-style landing sections; the tools live on their own pages.
export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <RouteEffects />
      <SiteNav />
      <main id="main" tabIndex={-1} className="outline-none">
        <Suspense fallback={<div className="min-h-[70vh]" />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/gate" element={<GatePage />} />
          <Route path="/check" element={<CheckPage />} />
          <Route path="/board" element={<BoardPage />} />
          <Route path="/odds" element={<OddsPage />} />
          <Route path="/radar" element={<RadarPage />} />
          <Route path="/autopsy" element={<AutopsyPage />} />
          <Route path="/launches" element={<Navigate to="/board" replace />} />
          <Route path="/premortem" element={<PremortemPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
      </main>
      <SiteFooter />
    </MotionConfig>
  )
}
