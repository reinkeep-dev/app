import { MotionConfig } from 'motion/react'
import { Navigate, Route, Routes } from 'react-router'
import { SiteNav } from '@/sections/site-nav'
import { SiteFooter } from '@/sections/site-footer'
import { RouteEffects } from '@/components/route-effects'
import HomePage from '@/pages/home-page'
import GatePage from '@/pages/gate-page'
import CheckPage from '@/pages/check-page'
import DocsPage from '@/pages/docs-page'
import StatusPage from '@/pages/status-page'
import PremortemPage from '@/pages/premortem-page'
import OddsPage from '@/pages/odds-page'
import BoardPage from '@/pages/board-page'
import RadarPage from '@/pages/radar-page'
import AutopsyPage from '@/pages/autopsy-page'
import NotFoundPage from '@/pages/not-found-page'

// One shell (nav, footer), one page per route. Home keeps the family.co-style landing sections; the tools live on their own pages.
export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <RouteEffects />
      <SiteNav />
      <main id="main" tabIndex={-1} className="outline-none">
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
      </main>
      <SiteFooter />
    </MotionConfig>
  )
}
