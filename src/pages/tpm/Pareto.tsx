import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { exportCsv, exportXlsx } from '@/lib/tpmExport'
import { ISSUE_CATEGORY_LABELS, PRIORITY_LABELS, ISSUE_STATUS_LABELS } from '@/types/tpm'
import type { TpmIssue, TpmMachine, IssueStatus } from '@/types/tpm'

type Dim = 'station' | 'category' | 'priority' | 'status' | 'machine' | 'shift' | 'reporter' | 'confirmed_cause'
type Metric = 'count' | 'downtime' | 'nok'

const DIMS: { value: Dim; label: string }[] = [
  { value: 'station', label: 'Stacja' }, { value: 'category', label: 'Kategoria' },
  { value: 'priority', label: 'Priorytet' }, { value: 'status', label: 'Status' },
  { value: 'machine', label: 'Automat' }, { value: 'shift', label: 'Zmiana' },
  { value: 'reporter', label: 'Zgłaszający' }, { value: 'confirmed_cause', label: 'Potwierdzona przyczyna' }
]
const METRICS: { value: Metric; label: string }[] = [
  { value: 'count', label: 'Liczba awarii' }, { value: 'downtime', label: 'Czas postoju (min)' }, { value: 'nok', label: 'Sztuki NOK' }
]

async function fetchIssues(from: string, to: string) {
  const { data } = await supabase
    .from('tpm_issues')
    .select('*, machine:tpm_machines(*), station:tpm_stations(*), reporter:profiles!tpm_issues_reporter_id_fkey(id, full_name)')
    .gte('report_time', from)
    .lte('report_time', to + 'T23:59:59')
    .order('report_time', { ascending: false })
    .limit(2000)
  return data as TpmIssue[] ?? []
}
async function fetchMachines() {
  const { data } = await supabase.from('tpm_machines').select('*').order('sort_order')
  return data as TpmMachine[] ?? []
}

function dimValue(i: TpmIssue, dim: Dim): string {
  switch (dim) {
    case 'station': return (i.station as { station_number?: string })?.station_number ?? '—'
    case 'category': return ISSUE_CATEGORY_LABELS[i.category] ?? i.category
    case 'priority': return PRIORITY_LABELS[i.priority]
    case 'status': return ISSUE_STATUS_LABELS[i.status as IssueStatus]
    case 'machine': return (i.machine as { code?: string })?.code ?? '—'
    case 'shift': return i.shift_type ?? '—'
    case 'reporter': return (i.reporter as { full_name?: string })?.full_name ?? '—'
    case 'confirmed_cause': return i.confirmed_cause?.trim() || 'Nieustalona'
  }
}
function metricValue(i: TpmIssue, metric: Metric): number {
  if (metric === 'downtime') return i.downtime_min ?? 0
  if (metric === 'nok') return i.nok_count ?? 0
  return 1
}

export default function TpmPareto() {
  const navigate = useNavigate()
  const today = new Date().toISOString().split('T')[0]
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().split('T')[0]

  const [from, setFrom] = useState(monthAgo)
  const [to, setTo] = useState(today)
  const [dim, setDim] = useState<Dim>('station')
  const [metric, setMetric] = useState<Metric>('count')
  const [machineId, setMachineId] = useState('')

  const { data: issues = [], isLoading } = useQuery({ queryKey: ['tpm_pareto', from, to], queryFn: () => fetchIssues(from, to) })
  const { data: machines = [] } = useQuery({ queryKey: ['tpm_machines'], queryFn: fetchMachines })

  const rows = useMemo(() => {
    const filtered = machineId ? issues.filter(i => i.machine_id === machineId) : issues
    const map = new Map<string, number>()
    for (const i of filtered) {
      const k = dimValue(i, dim)
      map.set(k, (map.get(k) ?? 0) + metricValue(i, metric))
    }
    const total = [...map.values()].reduce((a, b) => a + b, 0)
    let cum = 0
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => {
        cum += value
        return { label, value, pct: total > 0 ? value / total * 100 : 0, cumPct: total > 0 ? cum / total * 100 : 0 }
      })
  }, [issues, machineId, dim, metric])

  const max = Math.max(1, ...rows.map(r => r.value))
  const metricLabel = METRICS.find(m => m.value === metric)!.label
  const dimLabel = DIMS.find(d => d.value === dim)!.label

  const doExport = (kind: 'csv' | 'xlsx') => {
    const header = [dimLabel, metricLabel, 'Udział %', 'Skumulowany %']
    const data = rows.map(r => [r.label, r.value, r.pct.toFixed(1), r.cumPct.toFixed(1)])
    const fname = `Pareto_${dim}_${metric}_${from}_${to}`
    if (kind === 'csv') exportCsv(fname, header, data)
    else exportXlsx(fname, [{ name: 'Pareto', header, rows: data }])
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Analiza Pareto</h1>
          <p className="text-navy-400 text-sm">Dane rzeczywiste z rejestru zgłoszeń TPM</p>
        </div>
        <button onClick={() => navigate('/tpm/manager')} className="btn-secondary px-4 py-2">← Nadzór</button>
      </div>

      {/* Filtry */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div><label className="label">Od</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input" /></div>
        <div><label className="label">Do</label><input type="date" value={to} onChange={e => setTo(e.target.value)} className="input" /></div>
        <div>
          <label className="label">Wymiar</label>
          <select value={dim} onChange={e => setDim(e.target.value as Dim)} className="input">
            {DIMS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Miara</label>
          <select value={metric} onChange={e => setMetric(e.target.value as Metric)} className="input">
            {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Automat</label>
          <select value={machineId} onChange={e => setMachineId(e.target.value)} className="input">
            <option value="">Wszystkie</option>
            {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button onClick={() => doExport('csv')} className="btn-secondary px-3 py-2 text-sm flex-1">CSV</button>
          <button onClick={() => doExport('xlsx')} className="btn-secondary px-3 py-2 text-sm flex-1">XLSX</button>
        </div>
      </div>

      {/* Wykres Pareto */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-4">{dimLabel} wg „{metricLabel}"</div>
        {isLoading ? <div className="text-navy-400">Ładowanie...</div> : rows.length === 0 ? (
          <p className="text-navy-500 text-sm">Brak danych w wybranym zakresie.</p>
        ) : (
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.label} className="flex items-center gap-3">
                <span className="w-28 sm:w-40 text-sm text-white truncate shrink-0" title={r.label}>{r.label}</span>
                <div className="flex-1 h-7 bg-navy-900 rounded overflow-hidden relative">
                  <div className="h-full bg-brand/60 rounded flex items-center justify-end px-2" style={{ width: `${r.value / max * 100}%` }}>
                    <span className="text-xs text-white font-bold">{r.value}</span>
                  </div>
                </div>
                <span className="w-14 text-right text-xs text-navy-400 shrink-0">{r.pct.toFixed(0)}%</span>
                <span className="w-16 text-right text-xs text-amber-400 shrink-0">Σ{r.cumPct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tabela */}
      {rows.length > 0 && (
        <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-navy-400 border-b border-navy-700">
                <th className="text-left py-2 px-2">{dimLabel}</th>
                <th className="text-right py-2 px-2">{metricLabel}</th>
                <th className="text-right py-2 px-2">Udział</th>
                <th className="text-right py-2 px-2">Skumulowany</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label} className="border-b border-navy-700/50">
                  <td className="py-2 px-2 text-white">{r.label}</td>
                  <td className="py-2 px-2 text-right text-white font-medium">{r.value}</td>
                  <td className="py-2 px-2 text-right text-navy-400">{r.pct.toFixed(1)}%</td>
                  <td className="py-2 px-2 text-right text-amber-400">{r.cumPct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
