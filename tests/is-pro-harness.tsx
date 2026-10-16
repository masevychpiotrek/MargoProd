import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import IsProProduction from '../src/components/operator/IsProProduction'
import { supabase } from '../src/lib/supabase'
import type { HourlyReport, Shift } from '../src/types/database'
import '../src/index.css'

const shift = { id: 's1', machine_id: 'm1', shift_type: 'I', shift_date: '2026-10-16', started_at: '2026-10-16T04:00:00Z', ended_at: null } as Shift
function App() {
  const [reports, setReports] = useState<HourlyReport[]>([])
  useEffect(() => {
    const load = () => { void supabase.from('hourly_reports').select('*').then(({ data }) => setReports(data ?? [])) }
    load(); window.addEventListener('is-pro-updated', load)
    return () => window.removeEventListener('is-pro-updated', load)
  }, [])
  return <main className="p-4 max-w-2xl mx-auto"><IsProProduction shift={shift} reports={reports} /></main>
}
createRoot(document.getElementById('root')!).render(<App />)
