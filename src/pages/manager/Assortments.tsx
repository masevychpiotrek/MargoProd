import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface Assortment { id: string; name: string; code: string }
interface Machine { id: string; name: string; code: string }
interface MonthlyPlan {
  id: string; assortment_id: string; machine_id: string
  planned_qty: number; notes: string | null
}
interface OrderStat {
  assortment_id: string
  assortment_name: string
  machine_id: string
  total_produced: number
  total_runtime_min: number
  total_downtime_min: number
  total_alarm_min: number
  orders_count: number
  first_started: string | null
  last_completed: string | null
}

const MONTHS = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień']

export default function ManagerAssortments() {
  const [assortments, setAssortments] = useState<Assortment[]>([])
  const [machines,    setMachines]    = useState<Machine[]>([])
  const [plans,       setPlans]       = useState<MonthlyPlan[]>([])
  const [stats,       setStats]       = useState<OrderStat[]>([])
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [msg,         setMsg]         = useState('')

  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [editPlans, setEditPlans] = useState<Record<string, number>>({})

  useEffect(() => { loadAll() }, [year, month])

  const loadAll = async () => {
    setLoading(true)
    const [aRes, mRes, pRes] = await Promise.all([
      supabase.from('assortments').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('machines').select('*').eq('is_active', true).order('code'),
      supabase.from('monthly_plans').select('*').eq('year', year).eq('month', month)
    ])
    if (aRes.data) setAssortments(aRes.data as Assortment[])
    if (mRes.data) setMachines(mRes.data as Machine[])
    if (pRes.data) setPlans(pRes.data as MonthlyPlan[])

    // Load order stats for this month
    const monthStart = `${year}-${String(month).padStart(2,'0')}-01`
    const monthEnd = new Date(year, month, 0).toISOString().split('T')[0]

    const { data: orders } = await supabase
      .from('production_orders')
      .select(`
        id, assortment_id, machine_id, produced_qty, started_at, completed_at,
        assortment:assortments(name)
      `)
      .gte('started_at', monthStart)
      .lte('started_at', monthEnd + 'T23:59:59')
      .not('assortment_id', 'is', null)

    if (orders) {
      // Get reports for these orders
      const orderIds = orders.map((o: { id: string }) => o.id)
      const { data: reports } = orderIds.length > 0
        ? await supabase.from('hourly_reports').select('order_id, runtime_min, ready_min, alarm_min, downtime_min, failure_min').in('order_id', orderIds).is('deleted_at', null)
        : { data: [] }

      // Aggregate
      const statsMap: Record<string, OrderStat> = {}
      orders.forEach((o: { id: string; assortment_id: string; machine_id: string; produced_qty: number; started_at: string; completed_at: string | null; assortment?: { name: string } }) => {
        const key = `${o.assortment_id}_${o.machine_id}`
        if (!statsMap[key]) statsMap[key] = {
          assortment_id: o.assortment_id,
          assortment_name: o.assortment?.name ?? '—',
          machine_id: o.machine_id,
          total_produced: 0, total_runtime_min: 0,
          total_downtime_min: 0, total_alarm_min: 0,
          orders_count: 0, first_started: null, last_completed: null
        }
        statsMap[key].total_produced += o.produced_qty
        statsMap[key].orders_count++
        if (!statsMap[key].first_started || o.started_at < statsMap[key].first_started!) statsMap[key].first_started = o.started_at
        if (o.completed_at && (!statsMap[key].last_completed || o.completed_at > statsMap[key].last_completed!)) statsMap[key].last_completed = o.completed_at
      });
      (reports ?? []).forEach((r: { order_id: string; runtime_min: number; ready_min: number; alarm_min: number; downtime_min: number; failure_min: number }) => {
        const order = orders.find((o: { id: string }) => o.id === r.order_id)
        if (!order) return
        const key = `${order.assortment_id}_${order.machine_id}`
        if (statsMap[key]) {
          statsMap[key].total_runtime_min  += r.runtime_min ?? 0
          statsMap[key].total_downtime_min += (r.downtime_min ?? 0) + (r.failure_min ?? 0)
          statsMap[key].total_alarm_min    += r.alarm_min ?? 0
        }
      })
      setStats(Object.values(statsMap))
    }
    setLoading(false)
  }

  const getPlan = (assortmentId: string, machineId: string) => {
    const key = `${assortmentId}_${machineId}`
    if (editPlans[key] !== undefined) return editPlans[key]
    return plans.find(p => p.assortment_id === assortmentId && p.machine_id === machineId)?.planned_qty ?? 0
  }

  const setSinglePlan = (assortmentId: string, machineId: string, val: number) => {
    setEditPlans(prev => ({ ...prev, [`${assortmentId}_${machineId}`]: val }))
  }

  const savePlans = async () => {
    setSaving(true)
    const upserts = Object.entries(editPlans).map(([key, qty]) => {
      const [assortmentId, machineId] = key.split('_')
      return { year, month, assortment_id: assortmentId, machine_id: machineId, planned_qty: qty }
    })
    if (upserts.length > 0) {
      await supabase.from('monthly_plans').upsert(upserts, { onConflict: 'year,month,machine_id,assortment_id' })
    }
    setEditPlans({})
    setMsg('Plan zapisany')
    setTimeout(() => setMsg(''), 3000)
    loadAll()
    setSaving(false)
  }

  const minsToHHMM = (m: number) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Asortyment — Plan i realizacja</h1>
          <p className="text-navy-400 mt-1">Plan miesięczny i czas poświęcony na każdy asortyment</p>
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

      {msg && <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm">{msg}</div>}

      {/* Plan miesięczny */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Plan miesięczny — {MONTHS[month-1]} {year}</div>
            <div className="card-sub">Wpisz planowaną liczbę sztuk dla każdego asortymentu</div>
          </div>
          {Object.keys(editPlans).length > 0 && (
            <button onClick={savePlans} disabled={saving} className="btn-primary px-5 py-2">
              {saving ? 'Zapisywanie...' : '💾 Zapisz plan'}
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700">
                <th className="text-left py-2.5 px-4 text-xs font-bold text-navy-400 uppercase tracking-wider">Asortyment</th>
                {machines.map(m => (
                  <th key={m.id} className="text-center py-2.5 px-4 text-xs font-bold text-navy-400 uppercase tracking-wider">{m.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assortments.map(a => (
                <tr key={a.id} className="border-b border-navy-800 hover:bg-navy-800/30">
                  <td className="py-3 px-4 font-medium text-white">{a.name}</td>
                  {machines.map(m => {
                    const val = getPlan(a.id, m.id)
                    const stat = stats.find(s => s.assortment_id === a.id && s.machine_id === m.id)
                    const pct = val > 0 && stat ? Math.round(stat.total_produced / val * 100) : null
                    return (
                      <td key={m.id} className="py-2 px-4 text-center">
                        <input
                          type="number" value={val || ''}
                          onChange={e => setSinglePlan(a.id, m.id, parseInt(e.target.value) || 0)}
                          placeholder="0"
                          className="input text-center text-sm font-bold font-mono w-28 py-1.5"
                        />
                        {stat && stat.total_produced > 0 && (
                          <div className="mt-1">
                            <div className="text-xs font-mono text-brand">{stat.total_produced.toLocaleString('pl-PL')} szt</div>
                            {pct !== null && (
                              <div className={cn('text-xs font-bold', pct >= 100 ? 'text-green-400' : pct >= 75 ? 'text-amber-400' : 'text-red-400')}>
                                {pct}%
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Realizacja — czas i produkcja */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Realizacja zleceń — {MONTHS[month-1]} {year}</div>
            <div className="card-sub">Czas pracy i produkcja wg asortymentu</div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-navy-500">Ładowanie...</div>
        ) : stats.length === 0 ? (
          <div className="text-center py-8 text-navy-500">Brak zleceń z asortymentem w tym miesiącu</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700">
                  {['Asortyment','Maszyna','Produkcja','Czas pracy','Przestoje','Alarm','Łącznie','Zleceń','Pierwsze zlecenie','Ostatnie zakończenie'].map(h => (
                    <th key={h} className="text-left py-2.5 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.map((s, i) => {
                  const machine = machines.find(m => m.id === s.machine_id)
                  const totalTime = s.total_runtime_min + s.total_downtime_min + s.total_alarm_min
                  return (
                    <tr key={i} className="border-b border-navy-800 hover:bg-navy-800/40">
                      <td className="py-2.5 px-3 font-medium text-white max-w-[200px]">{s.assortment_name}</td>
                      <td className="py-2.5 px-3"><span className="status-info text-xs">{machine?.name ?? '—'}</span></td>
                      <td className="py-2.5 px-3 font-bold font-mono text-brand">{s.total_produced.toLocaleString('pl-PL')} szt</td>
                      <td className="py-2.5 px-3 font-mono text-green-400">{minsToHHMM(s.total_runtime_min)}</td>
                      <td className="py-2.5 px-3 font-mono text-amber-400">{minsToHHMM(s.total_downtime_min)}</td>
                      <td className="py-2.5 px-3 font-mono text-red-400">{minsToHHMM(s.total_alarm_min)}</td>
                      <td className="py-2.5 px-3 font-mono text-white font-bold">{minsToHHMM(totalTime)}</td>
                      <td className="py-2.5 px-3 text-center text-navy-300">{s.orders_count}</td>
                      <td className="py-2.5 px-3 text-xs text-navy-400 whitespace-nowrap">
                        {s.first_started ? new Date(s.first_started).toLocaleDateString('pl-PL') : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-navy-400 whitespace-nowrap">
                        {s.last_completed ? new Date(s.last_completed).toLocaleDateString('pl-PL') : 'w toku'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
