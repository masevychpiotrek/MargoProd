import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface Assortment { id: string; name: string; code: string }
interface MonthlyPlan { id?: string; assortment_id: string; planned_qty: number; notes: string | null }
interface OrderStat {
  assortment_id: string
  assortment_name: string
  total_produced: number
  total_runtime_min: number
  total_downtime_min: number
  total_alarm_min: number
  orders_count: number
  first_started: string | null
  last_completed: string | null
}

const MONTHS = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień']
const REAL_TARGET = 2500 // szt/h — target do liczenia czasu zaplanowanego

function minsToHHMM(m: number) {
  if (!m) return '00:00'
  return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
}

export default function ManagerAssortments() {
  const [assortments, setAssortments] = useState<Assortment[]>([])
  const [plans,       setPlans]       = useState<MonthlyPlan[]>([])
  const [stats,       setStats]       = useState<OrderStat[]>([])
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [msg,         setMsg]         = useState('')
  const [editPlans,   setEditPlans]   = useState<Record<string, { qty: number; notes: string }>>({})

  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  useEffect(() => { loadAll() }, [year, month])

  const loadAll = async () => {
    setLoading(true)
    const [aRes, pRes] = await Promise.all([
      supabase.from('assortments').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('monthly_plans').select('*').eq('year', year).eq('month', month)
    ])
    if (aRes.data) setAssortments(aRes.data as Assortment[])
    if (pRes.data) setPlans(pRes.data as MonthlyPlan[])

    // Load order stats for this month
    const monthStart = `${year}-${String(month).padStart(2,'0')}-01`
    const monthEnd   = new Date(year, month, 0).toISOString().split('T')[0]

    const { data: orders } = await supabase
      .from('production_orders')
      .select('id, assortment_id, produced_qty, started_at, completed_at, assortment:assortments(name)')
      .gte('started_at', monthStart)
      .lte('started_at', monthEnd + 'T23:59:59')
      .not('assortment_id', 'is', null)

    if (orders && orders.length > 0) {
      const orderIds = orders.map((o: { id: string }) => o.id)
      const { data: reports } = await supabase
        .from('hourly_reports')
        .select('order_id, runtime_min, ready_min, alarm_min, downtime_min, failure_min')
        .in('order_id', orderIds)
        .is('deleted_at', null)

      const statsMap: Record<string, OrderStat> = {}
      orders.forEach((o: { id: string; assortment_id: string; produced_qty: number; started_at: string; completed_at: string | null; assortment?: { name: string } }) => {
        const key = o.assortment_id
        if (!statsMap[key]) statsMap[key] = {
          assortment_id: o.assortment_id,
          assortment_name: o.assortment?.name ?? '—',
          total_produced: 0, total_runtime_min: 0,
          total_downtime_min: 0, total_alarm_min: 0,
          orders_count: 0, first_started: null, last_completed: null
        }
        statsMap[key].total_produced  += o.produced_qty
        statsMap[key].orders_count++
        if (!statsMap[key].first_started || o.started_at < statsMap[key].first_started!) statsMap[key].first_started = o.started_at
        if (o.completed_at && (!statsMap[key].last_completed || o.completed_at > statsMap[key].last_completed!)) statsMap[key].last_completed = o.completed_at
      });

      (reports ?? []).forEach((r: { order_id: string; runtime_min: number; ready_min: number; alarm_min: number; downtime_min: number; failure_min: number }) => {
        const order = orders.find((o: { id: string }) => o.id === r.order_id) as { assortment_id: string } | undefined
        if (!order) return
        const key = order.assortment_id
        if (statsMap[key]) {
          statsMap[key].total_runtime_min  += r.runtime_min  ?? 0
          statsMap[key].total_downtime_min += (r.downtime_min ?? 0) + (r.failure_min ?? 0)
          statsMap[key].total_alarm_min    += r.alarm_min    ?? 0
        }
      })
      setStats(Object.values(statsMap))
    } else {
      setStats([])
    }
    setLoading(false)
  }

  const getPlanQty = (assortmentId: string) => {
    if (editPlans[assortmentId] !== undefined) return editPlans[assortmentId].qty
    return plans.find(p => p.assortment_id === assortmentId)?.planned_qty ?? 0
  }

  const savePlans = async () => {
    setSaving(true)
    const upserts = Object.entries(editPlans).map(([assortmentId, val]) => ({
      year, month, assortment_id: assortmentId,
      planned_qty: val.qty, notes: val.notes || null
    }))
    if (upserts.length > 0) {
      const { error } = await supabase.from('monthly_plans')
        .upsert(upserts, { onConflict: 'year,month,assortment_id' })
      if (error) { setMsg('Błąd: ' + error.message); setSaving(false); return }
    }
    setEditPlans({})
    setMsg('Plan zapisany ✓')
    setTimeout(() => setMsg(''), 3000)
    loadAll()
    setSaving(false)
  }

  // Sumy
  const totalPlanned  = assortments.reduce((s, a) => s + getPlanQty(a.id), 0)
  const totalProduced = stats.reduce((s, st) => s + st.total_produced, 0)
  const totalRuntime  = stats.reduce((s, st) => s + st.total_runtime_min, 0)
  const totalDowntime = stats.reduce((s, st) => s + st.total_downtime_min, 0)
  const totalAlarm    = stats.reduce((s, st) => s + st.total_alarm_min, 0)
  const totalFaktyczny = totalRuntime + totalDowntime + totalAlarm
  const totalZaplanowany = totalPlanned > 0 ? Math.round(totalPlanned / REAL_TARGET * 60) : 0
  const efficiencyTime = totalFaktyczny > 0 && totalZaplanowany > 0
    ? Math.round(totalZaplanowany / totalFaktyczny * 100) : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Asortyment — Plan i realizacja</h1>
          <p className="text-navy-400 mt-1">Plan miesięczny łączny + efektywność czasowa zleceń</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={month} onChange={e => setMonth(parseInt(e.target.value))} className="input text-sm py-1.5">
            {MONTHS.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(parseInt(e.target.value))} className="input text-sm py-1.5">
            {[2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {msg && <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm font-bold">{msg}</div>}

      {/* KPI miesięczne */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="kpi-card">
          <div className="kpi-label">Plan łączny</div>
          <div className="kpi-value text-brand">{totalPlanned.toLocaleString('pl-PL')}</div>
          <div className="kpi-sub">szt. zaplanowane</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Realizacja</div>
          <div className={cn('kpi-value', totalPlanned > 0
            ? totalProduced >= totalPlanned ? 'text-green-400' : totalProduced >= totalPlanned * 0.75 ? 'text-amber-400' : 'text-red-400'
            : 'text-white')}>
            {totalProduced.toLocaleString('pl-PL')}
          </div>
          <div className="kpi-sub">
            {totalPlanned > 0 ? `${Math.round(totalProduced/totalPlanned*100)}% planu` : 'szt. wyprodukowane'}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Czas faktyczny</div>
          <div className="kpi-value text-white">{minsToHHMM(totalFaktyczny)}</div>
          <div className="kpi-sub">praca + postoje + alarmy</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Efektywność czasowa</div>
          <div className={cn('kpi-value', efficiencyTime === null ? 'text-navy-400'
            : efficiencyTime >= 90 ? 'text-green-400' : efficiencyTime >= 75 ? 'text-amber-400' : 'text-red-400')}>
            {efficiencyTime !== null ? efficiencyTime + '%' : '—'}
          </div>
          <div className="kpi-sub">plan {minsToHHMM(totalZaplanowany)} vs fakt {minsToHHMM(totalFaktyczny)}</div>
        </div>
      </div>

      {/* Plan miesięczny */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Plan miesięczny — {MONTHS[month-1]} {year}</div>
            <div className="card-sub">Łączny plan na obie maszyny · target kalkulacyjny: {REAL_TARGET.toLocaleString('pl-PL')} szt/h</div>
          </div>
          {Object.keys(editPlans).length > 0 && (
            <button onClick={savePlans} disabled={saving} className="btn-primary px-5 py-2">
              {saving ? 'Zapisywanie...' : '💾 Zapisz plan'}
            </button>
          )}
        </div>

        <div className="space-y-2">
          {assortments.map(a => {
            const qty = getPlanQty(a.id)
            const stat = stats.find(s => s.assortment_id === a.id)
            const produced = stat?.total_produced ?? 0
            const pct = qty > 0 ? Math.round(produced / qty * 100) : null
            // Efektywność czasowa dla tego asortymentu
            const planMins = qty > 0 ? Math.round(qty / REAL_TARGET * 60) : 0
            const faktMins = stat ? stat.total_runtime_min + stat.total_downtime_min + stat.total_alarm_min : 0
            const etPct = planMins > 0 && faktMins > 0 ? Math.round(planMins / faktMins * 100) : null

            return (
              <div key={a.id} className="bg-navy-900 rounded-xl p-4">
                <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
                  <div className="font-semibold text-white">{a.name}</div>
                  <div className="flex items-center gap-3">
                    {etPct !== null && (
                      <div className={cn('text-xs font-bold px-2 py-1 rounded-lg',
                        etPct >= 90 ? 'bg-green-500/15 text-green-400' : etPct >= 75 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400')}>
                        ⏱ {etPct}% ef. czasu
                      </div>
                    )}
                    <input
                      type="number"
                      value={qty || ''}
                      onChange={e => setEditPlans(prev => ({
                        ...prev,
                        [a.id]: { qty: parseInt(e.target.value) || 0, notes: prev[a.id]?.notes ?? '' }
                      }))}
                      placeholder="Plan (szt)"
                      className="input text-right text-sm font-bold font-mono w-32 py-1.5"
                    />
                  </div>
                </div>

                {qty > 0 && (
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-navy-400">
                        Wyprodukowano: <span className="text-white font-mono font-bold">{produced.toLocaleString('pl-PL')}</span> szt
                      </span>
                      <span className={cn('font-bold', pct === null ? 'text-navy-400'
                        : pct >= 100 ? 'text-green-400' : pct >= 75 ? 'text-amber-400' : 'text-red-400')}>
                        {pct !== null ? pct + '%' : '—'}
                      </span>
                    </div>
                    <div className="h-2 bg-navy-700 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full transition-all',
                        pct === null ? 'bg-navy-600' : pct >= 100 ? 'bg-green-500' : pct >= 75 ? 'bg-amber-500' : 'bg-brand')}
                        style={{ width: `${Math.min(pct ?? 0, 100)}%` }} />
                    </div>
                    {qty > 0 && (
                      <div className="text-xs text-navy-500 mt-1">
                        Czas zaplanowany: <span className="font-mono">{minsToHHMM(planMins)}</span>
                        {faktMins > 0 && <> · Faktyczny: <span className="font-mono">{minsToHHMM(faktMins)}</span></>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Suma */}
        {totalPlanned > 0 && (
          <div className="mt-4 bg-brand/10 border border-brand/20 rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-sm font-bold text-white">Łącznie</div>
              <div className="text-xs text-navy-400">wszystkie asortymentu</div>
            </div>
            <div className="flex gap-6 text-right">
              <div>
                <div className="text-xs text-navy-400">Plan</div>
                <div className="font-bold font-mono text-brand">{totalPlanned.toLocaleString('pl-PL')} szt</div>
              </div>
              <div>
                <div className="text-xs text-navy-400">Realizacja</div>
                <div className={cn('font-bold font-mono', totalProduced >= totalPlanned ? 'text-green-400' : 'text-white')}>
                  {totalProduced.toLocaleString('pl-PL')} szt
                </div>
              </div>
              <div>
                <div className="text-xs text-navy-400">% planu</div>
                <div className={cn('font-bold font-mono', totalProduced >= totalPlanned ? 'text-green-400' : totalProduced >= totalPlanned * 0.75 ? 'text-amber-400' : 'text-red-400')}>
                  {Math.round(totalProduced / totalPlanned * 100)}%
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tabela realizacji */}
      {stats.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Realizacja zleceń — {MONTHS[month-1]} {year}</div>
              <div className="card-sub">Czas i efektywność per asortyment</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700">
                  {['Asortyment','Produkcja','Czas pracy','Przestoje','Alarm','Czas faktyczny','Czas planowy','Ef. czasu','Zleceń','Start','Koniec'].map(h => (
                    <th key={h} className="text-left py-2.5 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.map((s, i) => {
                  const planMins  = getPlanQty(s.assortment_id) > 0 ? Math.round(getPlanQty(s.assortment_id) / REAL_TARGET * 60) : 0
                  const faktMins  = s.total_runtime_min + s.total_downtime_min + s.total_alarm_min
                  const etPct     = planMins > 0 && faktMins > 0 ? Math.round(planMins / faktMins * 100) : null
                  return (
                    <tr key={i} className="border-b border-navy-800 hover:bg-navy-800/40">
                      <td className="py-2.5 px-3 font-medium text-white max-w-[200px]">{s.assortment_name}</td>
                      <td className="py-2.5 px-3 font-bold font-mono text-brand">{s.total_produced.toLocaleString('pl-PL')} szt</td>
                      <td className="py-2.5 px-3 font-mono text-green-400">{minsToHHMM(s.total_runtime_min)}</td>
                      <td className="py-2.5 px-3 font-mono text-amber-400">{minsToHHMM(s.total_downtime_min)}</td>
                      <td className="py-2.5 px-3 font-mono text-red-400">{minsToHHMM(s.total_alarm_min)}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-white">{minsToHHMM(faktMins)}</td>
                      <td className="py-2.5 px-3 font-mono text-navy-400">{planMins > 0 ? minsToHHMM(planMins) : '—'}</td>
                      <td className="py-2.5 px-3">
                        {etPct !== null ? (
                          <span className={cn('font-bold text-sm', etPct >= 90 ? 'text-green-400' : etPct >= 75 ? 'text-amber-400' : 'text-red-400')}>
                            {etPct}%
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-center text-navy-300">{s.orders_count}</td>
                      <td className="py-2.5 px-3 text-xs text-navy-400 whitespace-nowrap">{s.first_started ? new Date(s.first_started).toLocaleDateString('pl-PL') : '—'}</td>
                      <td className="py-2.5 px-3 text-xs text-navy-400 whitespace-nowrap">{s.last_completed ? new Date(s.last_completed).toLocaleDateString('pl-PL') : 'w toku'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
