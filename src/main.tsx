import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { BottomToastProvider } from '@/components/ui/bottom-toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SitePasscodeGate } from '@/components/SitePasscodeGate'
import { ServiceErrorGate } from '@/components/ServiceErrorGate'
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
 * same-origin `/api/...` fetches / EventSource so Momentum / Yahoo / notifications
 * hit the real Express host instead of static Pages (405 on POST, HTML on SSE).
 */
if (hasExternalApiBase() && typeof window !== 'undefined') {
  const rewriteApiPath = (pathWithSearch: string) => apiUrl(pathWithSearch)

  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return nativeFetch(rewriteApiPath(input), init)
    }
    if (input instanceof Request && input.url) {
      try {
        const u = new URL(input.url, window.location.origin)
        if (
          u.origin === window.location.origin &&
          u.pathname.startsWith('/api/')
        ) {
          return nativeFetch(
            new Request(rewriteApiPath(u.pathname + u.search), input),
            init,
          )
        }
      } catch {
        /* fall through */
      }
    }
    return nativeFetch(input, init)
  }

  // EventSource is separate from fetch — Yahoo live module stream needs this.
  const NativeEventSource = window.EventSource
  window.EventSource = class extends NativeEventSource {
    constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      let resolved: string | URL = url
      if (typeof url === 'string' && url.startsWith('/api/')) {
        resolved = rewriteApiPath(url)
      } else {
        try {
          const u =
            typeof url === 'string' ? new URL(url, window.location.origin) : url
          if (
            u.origin === window.location.origin &&
            u.pathname.startsWith('/api/')
          ) {
            resolved = rewriteApiPath(u.pathname + u.search)
          }
        } catch {
          /* keep original */
        }
      }
      super(resolved, eventSourceInitDict)
    }
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <BottomToastProvider>
        <BrowserRouter>
          <SitePasscodeGate>
            <ServiceErrorGate>
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
            </ServiceErrorGate>
          </SitePasscodeGate>
        </BrowserRouter>
      </BottomToastProvider>
    </TooltipProvider>
  </StrictMode>,
)
