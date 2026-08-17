import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { BottomToastProvider } from '@/components/ui/bottom-toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SitePasscodeGate } from '@/components/SitePasscodeGate'
import { apiUrl, hasExternalApiBase } from '@/lib/apiBase'
import './index.css'
import App from './App.tsx'
import TickerDashboard from '@/pages/TickerDashboard.tsx'
import YahooTickerDashboard from '@/pages/YahooTickerDashboard.tsx'
import ManagerPortfolioPage from '@/pages/ManagerPortfolioPage.tsx'
import PoliticianPortfolioPage from '@/pages/PoliticianPortfolioPage.tsx'
import TickerDatabasePage from '@/pages/TickerDatabasePage.tsx'
import PrivacyPage from '@/pages/PrivacyPage.tsx'
import TermsPage from '@/pages/TermsPage.tsx'
import SupportPage from '@/pages/SupportPage.tsx'
import NotificationsPage from '@/pages/NotificationsPage.tsx'
import MomentumStudioPage from '@/pages/MomentumStudioPage.tsx'

/**
 * When VITE_API_BASE_URL is set (Cloudflare Pages → remote Node API), rewrite
 * same-origin `/api/...` fetches so Momentum / Yahoo / notifications hit the
 * real Express host instead of static Pages (which returns 405 on POST).
 */
if (hasExternalApiBase() && typeof window !== 'undefined') {
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return nativeFetch(apiUrl(input), init)
    }
    if (input instanceof Request && input.url) {
      try {
        const u = new URL(input.url, window.location.origin)
        if (
          u.origin === window.location.origin &&
          u.pathname.startsWith('/api/')
        ) {
          return nativeFetch(
            new Request(apiUrl(u.pathname + u.search), input),
            init,
          )
        }
      } catch {
        /* fall through */
      }
    }
    return nativeFetch(input, init)
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <BottomToastProvider>
        <BrowserRouter>
          <SitePasscodeGate>
            <Routes>
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/support" element={<SupportPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/momentum-studio" element={<MomentumStudioPage />} />
              <Route path="/dashboard/database" element={<TickerDatabasePage />} />
              <Route path="/dashboard/yahoo/:symbol" element={<YahooTickerDashboard />} />
              <Route path="/dashboard/ticker/manager/:cik" element={<ManagerPortfolioPage />} />
              <Route path="/dashboard/ticker/politician/:filerId" element={<PoliticianPortfolioPage />} />
              <Route path="/dashboard/ticker/:symbol" element={<TickerDashboard />} />
              <Route path="*" element={<App />} />
            </Routes>
          </SitePasscodeGate>
        </BrowserRouter>
      </BottomToastProvider>
    </TooltipProvider>
  </StrictMode>,
)
