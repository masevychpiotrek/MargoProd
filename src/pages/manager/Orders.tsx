import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface Order {
  id: string
  order_number: string
  machine_id: string
  target_qty: number
  produced_qty: number
  status: 'active' | 'paused' | 'completed' | 'cancelled'
  started_at: string
  completed_at: string | null
  notes: string | null
  assortment_id: string | null
  machine?: { name: string }
  assortment?: { name: string }
}

interface OrderReport {
  good_count: number
  reject_count: number
  runtime_min: number
  alarm_min: number
  downtime_min: number
  failure_min: number
  hour_block: string
  report_date: string
  operator?: { full_name: string }
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  active:    { label: '● Aktywne',     cls: 'status-ok' },
  paused:    { label: '⏸ Zapauzowane', cls: 'status-warn' },
  completed: { label: '✓ Zakończone',  cls: 'status-info' },
  cancelled: { label: '✕ Anulowane',   cls: 'status-alarm' }
}

function minsToHHMM(m: number) {
  if (!m) return '—'
  return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
}

function duration(start: string, end: string | null) {
  const from = new Date(start)
  const to   = end ? new Date(end) : new Date()
  const mins = Math.round((to.getTime() - from.getTime()) / 60000)
  const h    = Math.floor(mins / 60)
  const m    = mins % 60
  return h > 0 ? `${h}h ${m}min` : `${m}min`
}

export default function ManagerOrders() {
  const [orders,      setOrders]      = useState<Order[]>([])
  const [selected,    setSelected]    = useState<Order | null>(null)
  const [reports,     setReports]     = useState<OrderReport[]>([])
  const [loading,     setLoading]     = useState(true)
  const [loadingRep,  setLoadingRep]  = useState(false)
  const [filter,      setFilter]      = useState<'all'|'active'|'paused'|'completed'>('all')
  const [search,      setSearch]      = useState('')

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (selected) loadReports(selected.id)
  }, [selected])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('production_orders')
      .select('*, machine:machines(name), assortment:assortments(name)')
      .order('started_at', { ascending: false })
    if (data) setOrders(data as Order[])
    setLoading(false)
  }

  const loadReports = async (orderId: string) => {
    setLoadingRep(true)
    const { data } = await supabase
      .from('hourly_reports')
      .select('good_count, reject_count, runtime_min, alarm_min, downtime_min, failure_min, hour_block, report_date, operator:profiles!operator_id(full_name)')
      .eq('order_id', orderId)
      .is('deleted_at', null)
      .order('report_date')
      .order('hour_start')
    if (data) setReports(data as OrderReport[])
    setLoadingRep(false)
  }

  const filtered = orders.filter(o => {
    if (filter !== 'all' && o.status !== filter) return false
    if (search && !o.order_number.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const stats = {
    active:    orders.filter(o => o.status === 'active').length,
    paused:    orders.filter(o => o.status === 'paused').length,
    completed: orders.filter(o => o.status === 'completed').length,
  }

  // Szczegóły wybranego zlecenia
  const totalRuntime  = reports.reduce((s,r) => s + r.runtime_min, 0)
  const totalAlarm    = reports.reduce((s,r) => s + (r.alarm_min ?? 0), 0)
  const totalDowntime = reports.reduce((s,r) => s + r.downtime_min + r.failure_min, 0)
  const totalReject   = reports.reduce((s,r) => s + r.reject_count, 0)
  const operators     = [...new Set(reports.map(r => r.operator?.full_name).filter(Boolean))]
  const hasProblems   = reports.some(r => r.alarm_min > 15 || (r.downtime_min + r.failure_min) > 10)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Zlecenia produkcyjne</h1>
          <p className="text-navy-400 mt-1">Historia i szczegóły zleceń</p>
        </div>
        <button onClick={load} className="btn-secondary text-xs py-1.5 px-3">↻ Odśwież</button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { l: 'Aktywne',     v: stats.active,    c: 'text-green-400' },
          { l: 'Zapauzowane', v: stats.paused,     c: 'text-amber-400' },
          { l: 'Zakończone',  v: stats.completed,  c: 'text-brand' },
        ].map(k => (
          <div key={k.l} className="kpi-card">
            <div className="kpi-label">{k.l}</div>
            <div className={cn('kpi-value', k.c)}>{k.v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lista zleceń */}
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {(['all','active','paused','completed'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn('btn text-xs py-1.5 px-3', filter === f ? 'btn-primary' : 'btn-secondary')}>
                {f === 'all' ? 'Wszystkie' : f === 'active' ? 'Aktywne' : f === 'paused' ? 'Zapauzowane' : 'Zakończone'}
              </button>
            ))}
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Szukaj..." className="input text-sm py-1.5 w-32" />
          </div>

          <div className="space-y-2">
            {loading
              ? <div className="text-navy-500 text-sm">Ładowanie...</div>
              : filtered.length === 0
                ? <div className="text-navy-500 text-sm">Brak zleceń</div>
                : filtered.map(o => {
                  const pct = o.target_qty > 0 ? Math.round(o.produced_qty / o.target_qty * 100) : null
                  const s   = STATUS_LABELS[o.status]
                  const isSelected = selected?.id === o.id
                  return (
                    <button key={o.id} onClick={() => setSelected(o)}
                      className={cn('w-full text-left p-4 rounded-xl border-2 transition-all',
                        isSelected ? 'border-brand bg-brand/10' : 'border-navy-700 bg-navy-800 hover:border-navy-500'
                      )}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-bold font-mono text-white">{o.order_number}</div>
                        <span className={cn('text-xs', s.cls)}>{s.label}</span>
                      </div>
                      {o.assortment && <div className="text-xs text-brand mb-1">{o.assortment.name}</div>}
                      <div className="flex items-center justify-between text-xs text-navy-400 mb-2">
                        <span>{o.machine?.name ?? '—'}</span>
                        <span>{new Date(o.started_at).toLocaleDateString('pl-PL')}</span>
                      </div>
                      {pct !== null && (
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-navy-500">{o.produced_qty.toLocaleString('pl-PL')} / {o.target_qty.toLocaleString('pl-PL')} szt</span>
                            <span className={cn('font-bold', pct >= 100 ? 'text-green-400' : pct >= 75 ? 'text-amber-400' : 'text-navy-400')}>{pct}%</span>
                          </div>
                          <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-green-500' : 'bg-brand')}
                              style={{ width: `${Math.min(pct,100)}%` }} />
                          </div>
                        </div>
                      )}
                    </button>
                  )
                })
            }
          </div>
        </div>

        {/* Szczegóły zlecenia */}
        <div>
          {!selected ? (
            <div className="card text-center py-12">
              <div className="text-3xl mb-3">📋</div>
              <div className="text-white font-bold mb-1">Wybierz zlecenie</div>
              <p className="text-navy-400 text-sm">Kliknij zlecenie z listy aby zobaczyć szczegóły</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Nagłówek */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-xl font-bold font-mono text-white">{selected.order_number}</div>
                    {selected.assortment && <div className="text-sm text-brand">{selected.assortment.name}</div>}
                  </div>
                  <span className={cn('text-sm', STATUS_LABELS[selected.status].cls)}>
                    {STATUS_LABELS[selected.status].label}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-navy-900 rounded-xl p-3">
                    <div className="text-xs text-navy-500 mb-1">Maszyna</div>
                    <div className="font-bold text-white">{selected.machine?.name ?? '—'}</div>
                  </div>
                  <div className="bg-navy-900 rounded-xl p-3">
                    <div className="text-xs text-navy-500 mb-1">Czas trwania</div>
                    <div className="font-bold text-white">{duration(selected.started_at, selected.completed_at)}</div>
                  </div>
                  <div className="bg-navy-900 rounded-xl p-3">
                    <div className="text-xs text-navy-500 mb-1">Rozpoczęto</div>
                    <div className="font-bold text-white font-mono text-xs">
                      {new Date(selected.started_at).toLocaleDateString('pl-PL')}<br/>
                      {new Date(selected.started_at).toLocaleTimeString('pl-PL', {hour:'2-digit',minute:'2-digit'})}
                    </div>
                  </div>
                  <div className="bg-navy-900 rounded-xl p-3">
                    <div className="text-xs text-navy-500 mb-1">Zakończono</div>
                    <div className="font-bold text-white font-mono text-xs">
                      {selected.completed_at
                        ? <>{new Date(selected.completed_at).toLocaleDateString('pl-PL')}<br/>{new Date(selected.completed_at).toLocaleTimeString('pl-PL', {hour:'2-digit',minute:'2-digit'})}</>
                        : '— w toku'}
                    </div>
                  </div>
                </div>

                {/* Operatorzy */}
                {operators.length > 0 && (
                  <div className="mt-3 bg-navy-900 rounded-xl p-3">
                    <div className="text-xs text-navy-500 mb-1">Operatorzy</div>
                    <div className="text-sm font-semibold text-white">{operators.join(', ')}</div>
                  </div>
                )}
              </div>

              {/* KPI zlecenia */}
              {reports.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="kpi-card">
                    <div className="kpi-label">Wyprodukowano</div>
                    <div className="kpi-value text-brand">{selected.produced_qty.toLocaleString('pl-PL')}</div>
                    <div className="kpi-sub">z {selected.target_qty.toLocaleString('pl-PL')} szt</div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Odrzut</div>
                    <div className={cn('kpi-value', totalReject > 0 ? 'text-red-400' : 'text-green-400')}>{totalReject.toLocaleString('pl-PL')}</div>
                    <div className="kpi-sub">szt łącznie</div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Czas pracy</div>
                    <div className="kpi-value text-green-400">{minsToHHMM(totalRuntime)}</div>
                    <div className="kpi-sub">aktywna praca</div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Alarmy + przestoje</div>
                    <div className={cn('kpi-value', (totalAlarm + totalDowntime) > 60 ? 'text-red-400' : 'text-amber-400')}>
                      {minsToHHMM(totalAlarm + totalDowntime)}
                    </div>
                    <div className="kpi-sub">{hasProblems ? '⚠ były komplikacje' : 'bez problemów'}</div>
                  </div>
                </div>
              )}

              {/* Raporty godzinowe */}
              <div className="card">
                <div className="card-header">
                  <div>
                    <div className="card-title">Raporty godzinowe</div>
                    <div className="card-sub">{reports.length} wpisów</div>
                  </div>
                </div>
                {loadingRep ? (
                  <div className="text-center py-6 text-navy-500 text-sm">Ładowanie...</div>
                ) : reports.length === 0 ? (
                  <div className="text-center py-6 text-navy-500 text-sm">Brak raportów</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-navy-700">
                          {['Data','Godzina','Operator','Dobre','Odrzut','Praca','Alarm'].map(h => (
                            <th key={h} className="text-left py-2 px-2 font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {reports.map((r, i) => {
                          const hasIssue = r.alarm_min > 15 || (r.downtime_min + r.failure_min) > 10
                          return (
                            <tr key={i} className={cn('border-b border-navy-800', hasIssue ? 'bg-red-500/5' : 'hover:bg-navy-800/40')}>
                              <td className="py-2 px-2 text-navy-400">{new Date(r.report_date).toLocaleDateString('pl-PL', {day:'2-digit',month:'2-digit'})}</td>
                              <td className="py-2 px-2 font-mono text-white">{r.hour_block}</td>
                              <td className="py-2 px-2 text-navy-300 max-w-[80px] truncate">{r.operator?.full_name?.split(' ')[0] ?? '—'}</td>
                              <td className="py-2 px-2 font-bold font-mono text-white">{r.good_count.toLocaleString('pl-PL')}</td>
                              <td className="py-2 px-2 font-mono text-red-400">{r.reject_count || '—'}</td>
                              <td className="py-2 px-2 font-mono text-green-400">{minsToHHMM(r.runtime_min)}</td>
                              <td className="py-2 px-2 font-mono text-red-400">{r.alarm_min > 0 ? minsToHHMM(r.alarm_min) : '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
