import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '../src/stores/authStore'
import SessionStart from '../src/pages/syringe/SessionStart'
import Dashboard from '../src/pages/syringe/Dashboard'
import ProductionEntry from '../src/pages/syringe/ProductionEntry'
import Downtime from '../src/pages/syringe/DowntimeEntry'
import Handover from '../src/pages/syringe/ShiftHandover'
import Changeover from '../src/pages/syringe/Changeover'
import Components from '../src/pages/syringe/Components'
import Reports from '../src/pages/syringe/Reports'
import Failure from '../src/pages/syringe/FailureReport'
import Quality from '../src/pages/syringe/QualityIssue'
import History from '../src/pages/syringe/History'
import '../src/index.css'

// Only this test entry point injects a profile. The production router is unchanged.
useAuthStore.setState({ profile: (window as any).__syringeProfile, isInitialized: true, isLoading: false })
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <HashRouter><main className="p-4"><Routes>
      <Route path="/syringe" element={<Dashboard />} />
      <Route path="/syringe/start" element={<SessionStart />} />
      <Route path="/syringe/entry" element={<ProductionEntry />} />
      <Route path="/syringe/downtime" element={<Downtime />} />
      <Route path="/syringe/handover" element={<Handover />} />
      <Route path="/syringe/changeover" element={<Changeover />} />
      <Route path="/syringe/components" element={<Components />} />
      <Route path="/syringe/reports" element={<Reports />} />
      <Route path="/syringe/failure" element={<Failure />} />
      <Route path="/syringe/quality" element={<Quality />} />
      <Route path="/syringe/history" element={<History />} />
    </Routes></main></HashRouter>
  </QueryClientProvider>
)
