import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { formatJobCopyText } from '@/lib/productionJobs'
import type { ProductionJob, ProductionJobComponent, ProductionJobComponentHistory } from '@/types/database'

type JobRow = ProductionJob & {
  machine?: { name: string } | { name: string }[] | null
  operator?: { full_name: string } | { full_name: string }[] | null
}

type HistoryRow = ProductionJobComponentHistory & {
  changed_by_profile?: { full_name: string } | { full_name: string }[] | null
}

function one<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined
}

async function fetchJobs() {
  const { data } = await supabase
    .from('production_jobs')
    .select('*, machine:machines(name), operator:profiles!operator_id(full_name)')
    .order('started_at', { ascending: false })
    .limit(200)
  return (data ?? []) as JobRow[]
}

async function fetchComponents(jobId: string) {
  const { data } = await supabase
    .from('production_job_components')
    .select('*')
    .eq('job_id', jobId)
    .order('sort_order')
  return (data ?? []) as ProductionJobComponent[]
}

async function fetchHistory(jobId: string) {
  const { data } = await supabase
    .from('production_job_component_history')
    .select('*, changed_by_profile:profiles!changed_by(full_name)')
    .eq('job_id', jobId)
    .order('changed_at', { ascending: false })
  return (data ?? []) as HistoryRow[]
}

export default function ManagerProductionJobs() {
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [selectedJob, setSelectedJob] = useState<JobRow | null>(null)
  const [components, setComponents] = useState<ProductionJobComponent[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [fallbackText, setFallbackText] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    setJobs(await fetchJobs())
    setLoading(false)
  }

  const openDetail = async (job: JobRow) => {
    setSelectedJob(job)
    setDetailLoading(true)
    setCopyStatus('idle')
    setFallbackText(null)
    const [comps, hist] = await Promise.all([fetchComponents(job.id), fetchHistory(job.id)])
    setComponents(comps)
    setHistory(hist)
    setDetailLoading(false)
  }

  const filtered = jobs.filter(j => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return j.order_number.toLowerCase().includes(q) ||
      (j.series_number ?? '').toLowerCase().includes(q) ||
      j.assortment_name.toLowerCase().includes(q) ||
      (one(j.machine)?.name ?? '').toLowerCase().includes(q)
  })

  const handleCopy = async () => {
    if (!selectedJob) return
    const text = formatJobCopyText({
      job: selectedJob,
      machineName: one(selectedJob.machine)?.name ?? '—',
      operatorName: one(selectedJob.operator)?.full_name ?? '—',
      components,
      history: history.map(h => ({
        ...h,
        component_label: components.find(c => c.id === h.component_id)?.component_label,
        changed_by_name: one(h.changed_by_profile)?.full_name ?? '—'
      }))
    })
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus('ok')
      setFallbackText(null)
    } catch {
      setCopyStatus('fail')
      setFallbackText(text)
    }
    setTimeout(() => setCopyStatus('idle'), 2500)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Zlecenia produkcyjne</h1>
          <p className="text-navy-400 mt-1">{jobs.length} zleceń</p>
        </div>
      </div>

      <input
        value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Szukaj po numerze zlecenia, serii, asortymencie, automacie..."
        className="input w-full max-w-md"
      />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700">
                {['Numer zlecenia', 'Seria', 'Automat', 'Zmiana', 'Operator', 'Asortyment', 'Ilość szt.', 'Start', 'Status'].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-8 text-navy-500">Ładowanie...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-navy-500">Brak zleceń</td></tr>
              ) : filtered.map(job => (
                <tr key={job.id} onClick={() => openDetail(job)}
                  className="border-b border-navy-800 hover:bg-navy-800/50 cursor-pointer">
                  <td className="py-2.5 px-4 font-mono text-white">{job.order_number}</td>
                  <td className="py-2.5 px-4 font-mono text-navy-300">{job.series_number ?? '—'}</td>
                  <td className="py-2.5 px-4"><span className="status-info text-xs">{one(job.machine)?.name ?? '—'}</span></td>
                  <td className="py-2.5 px-4 font-bold text-white">{job.shift_type}</td>
                  <td className="py-2.5 px-4 text-navy-200">{one(job.operator)?.full_name ?? '—'}</td>
                  <td className="py-2.5 px-4 text-navy-200">{job.assortment_name}</td>
                  <td className="py-2.5 px-4 font-mono font-bold text-white">{job.calculated_qty.toLocaleString('pl-PL')}</td>
                  <td className="py-2.5 px-4 font-mono text-xs text-navy-400">{new Date(job.started_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="py-2.5 px-4">
                    <span className={cn(
                      'text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border',
                      job.status === 'confirmed' ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    )}>
                      {job.status === 'confirmed' ? 'Zatwierdzone' : 'W trakcie'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.85)', backdropFilter: 'blur(8px)' }}>
          <div className="bg-navy-800 border border-navy-600 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">{selectedJob.order_number}</h2>
                <p className="text-navy-400 text-sm">{selectedJob.series_number}</p>
              </div>
              <button onClick={() => setSelectedJob(null)} className="text-navy-400 hover:text-white text-xl leading-none">✕</button>
            </div>

            {detailLoading ? (
              <div className="text-center py-8 text-navy-500">Ładowanie...</div>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <div><div className="text-navy-500 text-xs">Automat</div><div className="text-white">{one(selectedJob.machine)?.name ?? '—'}</div></div>
                  <div><div className="text-navy-500 text-xs">Zmiana</div><div className="text-white">{selectedJob.shift_type}</div></div>
                  <div><div className="text-navy-500 text-xs">Operator</div><div className="text-white">{one(selectedJob.operator)?.full_name ?? '—'}</div></div>
                  <div><div className="text-navy-500 text-xs">Asortyment</div><div className="text-white">{selectedJob.assortment_name}</div></div>
                  <div><div className="text-navy-500 text-xs">Liczba etykiet</div><div className="font-mono text-white">{selectedJob.label_count}</div></div>
                  <div><div className="text-navy-500 text-xs">Przelicznik</div><div className="font-mono text-white">{selectedJob.multiplier}</div></div>
                  <div><div className="text-navy-500 text-xs">Ilość sztuk</div><div className="font-mono text-brand font-bold">{selectedJob.calculated_qty.toLocaleString('pl-PL')}</div></div>
                  <div className="col-span-2"><div className="text-navy-500 text-xs">Start</div><div className="text-white">{new Date(selectedJob.started_at).toLocaleString('pl-PL')}</div></div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-2">Półfabrykaty</div>
                  <div className="space-y-1">
                    {components.filter(c => !c.is_dren).map(c => (
                      <div key={c.id} className="flex justify-between text-sm border-b border-navy-800 py-1.5">
                        <span className="text-navy-300">{c.component_label}</span>
                        <span className="font-mono text-white">{c.batch_number ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-2">Dren</div>
                  <div className="space-y-1">
                    {components.filter(c => c.is_dren).map(c => (
                      <div key={c.id} className="flex justify-between text-sm border-b border-navy-800 py-1.5">
                        <span className="text-navy-300">{c.component_label}</span>
                        <span className="font-mono text-white">{c.batch_number ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {history.length > 0 && (
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-2">Historia wymian</div>
                    <div className="space-y-1.5">
                      {history.map(h => (
                        <div key={h.id} className="text-xs text-navy-300">
                          {new Date(h.changed_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{' '}
                          <span className="text-white font-semibold">{components.find(c => c.id === h.component_id)?.component_label ?? '—'}</span>
                          {' '}z <span className="font-mono">{h.previous_batch_number ?? '—'}</span> na <span className="font-mono text-white">{h.new_batch_number}</span>
                          {' '}· {one(h.changed_by_profile)?.full_name ?? '—'}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button onClick={handleCopy} className="btn-primary w-full py-3">
                  {copyStatus === 'ok' ? 'Skopiowano ✓' : copyStatus === 'fail' ? 'Nie udało się skopiować — zaznacz poniżej' : 'Kopiuj dane zlecenia'}
                </button>

                {fallbackText && (
                  <textarea readOnly value={fallbackText} onClick={e => (e.target as HTMLTextAreaElement).select()}
                    className="input font-mono text-xs min-h-[160px]" />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
