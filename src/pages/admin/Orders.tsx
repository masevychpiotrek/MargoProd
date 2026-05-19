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
  creator?: { full_name: string }
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  active:    { label: '● AKTYWNE',     cls: 'status-ok' },
  paused:    { label: '⏸ ZAPAUZOWANE', cls: 'status-warn' },
  completed: { label: '✓ ZAKOŃCZONE',  cls: 'status-info' },
  cancelled: { label: '✕ ANULOWANE',   cls: 'status-alarm' }
}

export default function AdminOrders() {
  const [orders,  setOrders]  = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState<'all'|'active'|'paused'|'completed'>('all')
  const [search,  setSearch]  = useState('')
  const [msg,     setMsg]     = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('production_orders')
      .select('*, machine:machines(name), assortment:assortments(name), creator:profiles!created_by(full_name)')
      .order('created_at', { ascending: false })
    if (data) setOrders(data as Order[])
    setLoading(false)
  }

  const handleStatusChange = async (id: string, status: string) => {
    const update: Record<string, unknown> = { status }
    if (status === 'completed') update.completed_at = new Date().toISOString()
    await supabase.from('production_orders').update(update).eq('id', id)
    setMsg('Zaktualizowano status')
    setTimeout(() => setMsg(''), 3000)
    load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Usunąć zlecenie? Wszystkie powiązane raporty stracą przypisanie do zlecenia.')) return
    await supabase.from('hourly_reports').update({ order_id: null, order_qty: 0 }).eq('order_id', id)
    await supabase.from('production_orders').delete().eq('id', id)
    setMsg('Zlecenie usunięte')
    setTimeout(() => setMsg(''), 3000)
    load()
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
    total:     orders.reduce((s, o) => s + o.produced_qty, 0)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Zlecenia produkcyjne</h1>
          <p className="text-navy-400 mt-1">Zarządzanie wszystkimi zleceniami</p>
        </div>
        <button onClick={load} className="btn-secondary text-xs py-1.5 px-3">↻ Odśwież</button>
      </div>

      {msg && <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm">{msg}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: 'Aktywne',     v: stats.active,    c: 'text-green-400' },
          { l: 'Zapauzowane', v: stats.paused,     c: 'text-amber-400' },
          { l: 'Zakończone',  v: stats.completed,  c: 'text-brand' },
          { l: 'Łączna produkcja', v: stats.total.toLocaleString('pl-PL') + ' szt', c: 'text-white' },
        ].map(k => (
          <div key={k.l} className="kpi-card">
            <div className="kpi-label">{k.l}</div>
            <div className={cn('kpi-value', k.c)}>{k.v}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 flex-wrap">
        {(['all','active','paused','completed'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn('btn text-xs py-1.5 px-3', filter === f ? 'btn-primary' : 'btn-secondary')}>
            {f === 'all' ? 'Wszystkie' : f === 'active' ? 'Aktywne' : f === 'paused' ? 'Zapauzowane' : 'Zakończone'}
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Szukaj numeru..." className="input text-sm py-1.5 w-48" />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700">
                {['Numer','Maszyna','Asortyment','Status','Produkcja','Realizacja','Rozpoczęto','Zakończono','Akcje'].map(h => (
                  <th key={h} className="text-left py-2.5 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? <tr><td colSpan={9} className="text-center py-8 text-navy-500">Ładowanie...</td></tr>
                : filtered.length === 0
                  ? <tr><td colSpan={9} className="text-center py-8 text-navy-500">Brak zleceń</td></tr>
                  : filtered.map(o => {
                    const pct = o.target_qty > 0 ? Math.round(o.produced_qty / o.target_qty * 100) : null
                    const s = STATUS_LABELS[o.status]
                    return (
                      <tr key={o.id} className="border-b border-navy-800 hover:bg-navy-800/40">
                        <td className="py-2.5 px-3 font-bold font-mono text-white">{o.order_number}</td>
                        <td className="py-2.5 px-3"><span className="status-info text-xs">{o.machine?.name ?? '—'}</span></td>
                        <td className="py-2.5 px-3 text-xs text-navy-300 max-w-[160px] truncate">{o.assortment?.name ?? '—'}</td>
                        <td className="py-2.5 px-3">
                          <select value={o.status}
                            onChange={e => handleStatusChange(o.id, e.target.value)}
                            className={cn('text-xs font-bold px-2 py-1 rounded-lg border cursor-pointer outline-none bg-transparent', s.cls)}>
                            <option value="active">● Aktywne</option>
                            <option value="paused">⏸ Zapauzowane</option>
                            <option value="completed">✓ Zakończone</option>
                            <option value="cancelled">✕ Anulowane</option>
                          </select>
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-white">
                          {o.produced_qty.toLocaleString('pl-PL')}
                          {o.target_qty > 0 && <span className="text-navy-400 font-normal text-xs"> / {o.target_qty.toLocaleString('pl-PL')}</span>}
                        </td>
                        <td className="py-2.5 px-3 min-w-[100px]">
                          {pct !== null ? (
                            <div>
                              <div className={cn('text-xs font-bold', pct >= 100 ? 'text-green-400' : pct >= 75 ? 'text-amber-400' : 'text-navy-400')}>{pct}%</div>
                              <div className="h-1 bg-navy-700 rounded overflow-hidden mt-0.5">
                                <div className={cn('h-full rounded', pct >= 100 ? 'bg-green-500' : 'bg-brand')} style={{ width: `${Math.min(pct,100)}%` }} />
                              </div>
                            </div>
                          ) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-navy-400 whitespace-nowrap">{new Date(o.started_at).toLocaleDateString('pl-PL')}</td>
                        <td className="py-2.5 px-3 text-xs text-navy-400 whitespace-nowrap">{o.completed_at ? new Date(o.completed_at).toLocaleDateString('pl-PL') : '—'}</td>
                        <td className="py-2.5 px-3">
                          <button onClick={() => handleDelete(o.id)} className="btn-danger text-xs py-1 px-2">🗑</button>
                        </td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
