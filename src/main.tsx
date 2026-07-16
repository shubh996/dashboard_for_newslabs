import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import './index.css'
import App from './App.tsx'
import TickerDashboard from './pages/TickerDashboard.tsx'
import YahooTickerDashboard from './pages/YahooTickerDashboard.tsx'
import ManagerPortfolioPage from './pages/ManagerPortfolioPage.tsx'
import PoliticianPortfolioPage from './pages/PoliticianPortfolioPage.tsx'
import TickerDatabasePage from './pages/TickerDatabasePage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/dashboard/database" element={<TickerDatabasePage />} />
          <Route path="/dashboard/yahoo/:symbol" element={<YahooTickerDashboard />} />
          <Route path="/dashboard/ticker/manager/:cik" element={<ManagerPortfolioPage />} />
          <Route path="/dashboard/ticker/politician/:filerId" element={<PoliticianPortfolioPage />} />
          <Route path="/dashboard/ticker/:symbol" element={<TickerDashboard />} />
          <Route path="*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </StrictMode>,
)
