import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, logAudit } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Machine } from '@/types/database'

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
  id: string
  good_count: number
  reject_count: number
  runtime_min: number
  ready_min?: number
  alarm_min: number
  downtime_min: number
  failure_min: number
  order_qty?: number
  hour_block: string
  report_date: string
  notes?: string | null
  downtime_reason?: string | null
  operator?: { full_name: string }
}

interface RawOrderReport extends Omit<OrderReport, 'operator'> {
  operator?: { full_name: string } | { full_name: string }[] | null
}

type OrderEdit = {
  order_number: string
  machine_id: string
  target_qty: string
  produced_qty: string
  status: Order['status']
  started_at: string
  completed_at: string
  notes: string
}

type ReportEdit = {
  good_count: string
  reject_count: string
  order_qty: string
  runtime_min: string
  ready_min: string
  alarm_min: string
  downtime_min: string
  failure_min: string
  downtime_reason: string
  notes: string
}

const STATUS_LABELS: Record<Order['status'], { label: string; cls: string }> = {
  active: { label: 'Aktywne', cls: 'status-ok' },
  paused: { label: 'Zapauzowane', cls: 'status-warn' },
  completed: { label: 'Zakonczone', cls: 'status-info' },
  cancelled: { label: 'Anulowane', cls: 'status-alarm' }
}

function minsToHHMM(m: number) {
  if (!m) return '-'
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function duration(start: string, end: string | null) {
  const from = new Date(start)
  const to = end ? new Date(end) : new Date()
  const mins = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}min` : `${m}min`
}

function toLocalInput(value: string | null) {
  if (!value) return ''
  const d = new Date(value)
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null
}

function toInt(value: string) {
  const parsed = Number.parseInt(value || '0', 10)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

export default function ManagerOrders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [machines, setMachines] = useState<Machine[]>([])
  const [selected, setSelected] = useState<Order | null>(null)
  const [reports, setReports] = useState<OrderReport[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingRep, setLoadingRep] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'completed' | 'cancelled'>('all')
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [orderEdit, setOrderEdit] = useState<OrderEdit | null>(null)
  const [editingReport, setEditingReport] = useState<OrderReport | null>(null)
  const [reportEdit, setReportEdit] = useState<ReportEdit | null>(null)
  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    load()
    channel.current?.unsubscribe()
    channel.current = supabase.channel('manager-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_reports' }, () => {
        if (selected) loadReports(selected.id)
        load()
      })
      .subscribe()
    return () => { channel.current?.unsubscribe() }
  }, [selected?.id])

  useEffect(() => {
    if (selected) loadReports(selected.id)
  }, [selected?.id])

  const load = async () => {
    setLoading(true)
    const [ordersRes, machinesRes] = await Promise.all([
      supabase
        .from('production_orders')
        .select('*, machine:machines(name), assortment:assortments(name)')
        .order('started_at', { ascending: false }),
      supabase.from('machines').select('*').eq('is_active', true).order('code')
    ])

    const orderList = (ordersRes.data ?? []) as Order[]
    setOrders(orderList)
    setMachines((machinesRes.data ?? []) as Machine[])
    setSelected(current => current ? orderList.find(order => order.id === current.id) ?? current : current)
    setLoading(false)
  }

  const loadReports = async (orderId: string) => {
    setLoadingRep(true)
    const { data } = await supabase
      .from('hourly_reports')
      .select('id, good_count, reject_count, order_qty, runtime_min, ready_min, alarm_min, downtime_min, failure_min, hour_block, report_date, notes, downtime_reason, operator:profiles!operator_id(full_name)')
      .eq('order_id', orderId)
      .is('deleted_at', null)
      .order('report_date')
      .order('hour_start')
    setReports(((data ?? []) as RawOrderReport[]).map(r => ({
      ...r,
      operator: Array.isArray(r.operator) ? r.operator[0] : r.operator ?? undefined
    })))
    setLoadingRep(false)
  }

  const filtered = orders.filter(o => {
    if (filter !== 'all' && o.status !== filter) return false
    if (search && !o.order_number.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const stats = {
    active: orders.filter(o => o.status === 'active').length,
    paused: orders.filter(o => o.status === 'paused').length,
    completed: orders.filter(o => o.status === 'completed').length,
    cancelled: orders.filter(o => o.status === 'cancelled').length
  }

  const reportTotals = useMemo(() => ({
    runtime: reports.reduce((s, r) => s + r.runtime_min, 0),
    alarm: reports.reduce((s, r) => s + (r.alarm_min ?? 0), 0),
    downtime: reports.reduce((s, r) => s + r.downtime_min + r.failure_min, 0),
    reject: reports.reduce((s, r) => s + r.reject_count, 0),
    good: reports.reduce((s, r) => s + r.good_count, 0)
  }), [reports])

  const operators = [...new Set(reports.map(r => r.operator?.full_name).filter(Boolean))]
  const hasProblems = reports.some(r => r.alarm_min > 15 || (r.downtime_min + r.failure_min) > 10)

  const showMessage = (value: string) => {
    setMsg(value)
    setTimeout(() => setMsg(''), 3500)
  }

  const openOrderEdit = (order: Order) => {
    setEditingOrder(order)
    setError('')
    setOrderEdit({
      order_number: order.order_number,
      machine_id: order.machine_id,
      target_qty: String(order.target_qty ?? 0),
      produced_qty: String(order.produced_qty ?? 0),
      status: order.status,
      started_at: toLocalInput(order.started_at),
      completed_at: toLocalInput(order.completed_at),
      notes: order.notes ?? ''
    })
  }

  const saveOrder = async () => {
    if (!editingOrder || !orderEdit) return
    setSaving(true)
    setError('')

    const payload = {
      order_number: orderEdit.order_number.trim(),
      machine_id: orderEdit.machine_id,
      target_qty: toInt(orderEdit.target_qty),
      produced_qty: toInt(orderEdit.produced_qty),
      status: orderEdit.status,
      started_at: fromLocalInput(orderEdit.started_at) ?? editingOrder.started_at,
      completed_at: orderEdit.status === 'completed'
        ? fromLocalInput(orderEdit.completed_at) ?? new Date().toISOString()
        : orderEdit.status === 'active' || orderEdit.status === 'paused'
          ? null
          : fromLocalInput(orderEdit.completed_at),
      notes: orderEdit.notes.trim() || null
    }

    const { error: err } = await supabase.from('production_orders').update(payload).eq('id', editingOrder.id)
    if (err) {
      setError(`Nie zapisano zlecenia: ${err.message}`)
    } else {
      await logAudit('manager_order_update', 'production_orders', editingOrder.id, {
        order_number: editingOrder.order_number,
        machine_id: editingOrder.machine_id,
        target_qty: editingOrder.target_qty,
        produced_qty: editingOrder.produced_qty,
        status: editingOrder.status,
        started_at: editingOrder.started_at,
        completed_at: editingOrder.completed_at,
        notes: editingOrder.notes
      }, payload)
      setEditingOrder(null)
      setOrderEdit(null)
      showMessage('Zlecenie zapisane')
      await load()
    }
    setSaving(false)
  }

  const openReportEdit = (report: OrderReport) => {
    setEditingReport(report)
    setError('')
    setReportEdit({
      good_count: String(report.good_count ?? 0),
      reject_count: String(report.reject_count ?? 0),
      order_qty: String(report.order_qty ?? report.good_count ?? 0),
      runtime_min: String(report.runtime_min ?? 0),
      ready_min: String(report.ready_min ?? 0),
      alarm_min: String(report.alarm_min ?? 0),
      downtime_min: String(report.downtime_min ?? 0),
      failure_min: String(report.failure_min ?? 0),
      downtime_reason: report.downtime_reason ?? '',
      notes: report.notes ?? ''
    })
  }

  const saveReport = async () => {
    if (!editingReport || !reportEdit) return
    setSaving(true)
    setError('')

    const payload = {
      good_count: toInt(reportEdit.good_count),
      reject_count: toInt(reportEdit.reject_count),
      order_qty: toInt(reportEdit.order_qty),
      runtime_min: toInt(reportEdit.runtime_min),
      ready_min: toInt(reportEdit.ready_min),
      alarm_min: toInt(reportEdit.alarm_min),
      downtime_min: toInt(reportEdit.downtime_min),
      failure_min: toInt(reportEdit.failure_min),
      downtime_reason: reportEdit.downtime_reason.trim() || null,
      notes: reportEdit.notes.trim() || null
    }

    const { error: err } = await supabase.from('hourly_reports').update(payload).eq('id', editingReport.id)
    if (err) {
      setError(`Nie zapisano wpisu: ${err.message}`)
    } else {
      await logAudit('manager_order_report_update', 'hourly_reports', editingReport.id, {
        good_count: editingReport.good_count,
        reject_count: editingReport.reject_count,
        order_qty: editingReport.order_qty,
        runtime_min: editingReport.runtime_min,
        ready_min: editingReport.ready_min,
        alarm_min: editingReport.alarm_min,
        downtime_min: editingReport.downtime_min,
        failure_min: editingReport.failure_min,
        downtime_reason: editingReport.downtime_reason,
        notes: editingReport.notes
      }, payload)
      setEditingReport(null)
      setReportEdit(null)
      showMessage('Wpis godzinowy zapisany')
      if (selected) await loadReports(selected.id)
      await load()
    }
    setSaving(false)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Zlecenia produkcyjne</h1>
          <p className="text-navy-400 mt-1">Podglad, korekta i sterowanie zleceniami</p>
        </div>
        <button onClick={load} className="btn-secondary text-xs py-1.5 px-3">Odswiez</button>
      </div>

      {msg && <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm font-bold">{msg}</div>}
      {error && !editingOrder && !editingReport && <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-300 text-sm">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: 'Aktywne', v: stats.active, c: 'text-green-400' },
          { l: 'Zapauzowane', v: stats.paused, c: 'text-amber-400' },
          { l: 'Zakonczone', v: stats.completed, c: 'text-brand' },
          { l: 'Anulowane', v: stats.cancelled, c: 'text-red-400' }
        ].map(k => (
          <div key={k.l} className="kpi-card">
            <div className="kpi-label">{k.l}</div>
            <div className={cn('kpi-value', k.c)}>{k.v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[0.95fr_1.05fr] gap-4">
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {(['all', 'active', 'paused', 'completed', 'cancelled'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn('btn text-xs py-1.5 px-3', filter === f ? 'btn-primary' : 'btn-secondary')}>
                {f === 'all' ? 'Wszystkie' : STATUS_LABELS[f].label}
              </button>
            ))}
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Szukaj..." className="input text-sm py-1.5 w-36" />
          </div>

          <div className="space-y-2">
            {loading
              ? <div className="text-navy-500 text-sm">Ladowanie...</div>
              : filtered.length === 0
                ? <div className="text-navy-500 text-sm">Brak zlecen</div>
                : filtered.map(o => {
                  const pct = o.target_qty > 0 ? Math.round(o.produced_qty / o.target_qty * 100) : null
                  const s = STATUS_LABELS[o.status]
                  const isSelected = selected?.id === o.id
                  return (
                    <div key={o.id} className={cn('p-4 rounded-xl border-2 transition-all',
                      isSelected ? 'border-brand bg-brand/10' : 'border-navy-700 bg-navy-800 hover:border-navy-500'
                    )}>
                      <button onClick={() => setSelected(o)} className="w-full text-left">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-bold font-mono text-white">{o.order_number}</div>
                          <span className={cn('text-xs', s.cls)}>{s.label}</span>
                        </div>
                        {o.assortment && <div className="text-xs text-brand mb-1">{o.assortment.name}</div>}
                        <div className="flex items-center justify-between text-xs text-navy-400 mb-2">
                          <span>{o.machine?.name ?? '-'}</span>
                          <span>{new Date(o.started_at).toLocaleDateString('pl-PL')}</span>
                        </div>
                        {pct !== null && (
                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-navy-500">{o.produced_qty.toLocaleString('pl-PL')} / {o.target_qty.toLocaleString('pl-PL')} szt</span>
                              <span className={cn('font-bold', pct >= 100 ? 'text-green-400' : pct >= 75 ? 'text-amber-400' : 'text-navy-400')}>{pct}%</span>
                            </div>
                            <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
                              <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-green-500' : 'bg-brand')} style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                          </div>
                        )}
                      </button>
                      <div className="flex gap-2 mt-3">
                        <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => openOrderEdit(o)}>Edytuj</button>
                        <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => setSelected(o)}>Raporty</button>
                      </div>
                    </div>
                  )
                })}
          </div>
        </div>

        <div>
          {!selected ? (
            <div className="card text-center py-12">
              <div className="text-white font-bold mb-1">Wybierz zlecenie</div>
              <p className="text-navy-400 text-sm">Kliknij zlecenie z listy, zeby zobaczyc szczegoly i wpisy</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="card">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="text-xl font-bold font-mono text-white">{selected.order_number}</div>
                    {selected.assortment && <div className="text-sm text-brand">{selected.assortment.name}</div>}
                  </div>
                  <button className="btn-primary text-xs py-1.5 px-3" onClick={() => openOrderEdit(selected)}>Edytuj zlecenie</button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <InfoBox label="Status" value={STATUS_LABELS[selected.status].label} />
                  <InfoBox label="Maszyna" value={selected.machine?.name ?? '-'} />
                  <InfoBox label="Czas trwania" value={duration(selected.started_at, selected.completed_at)} />
                  <InfoBox label="Produkcja" value={`${selected.produced_qty.toLocaleString('pl-PL')} / ${selected.target_qty.toLocaleString('pl-PL')} szt`} />
                </div>

                {operators.length > 0 && (
                  <div className="mt-3 bg-navy-900 rounded-xl p-3">
                    <div className="text-xs text-navy-500 mb-1">Operatorzy</div>
                    <div className="text-sm font-semibold text-white">{operators.join(', ')}</div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Kpi label="Z raportow" value={reportTotals.good.toLocaleString('pl-PL')} sub="szt dobrych" color="text-brand" />
                <Kpi label="Odrzut" value={reportTotals.reject.toLocaleString('pl-PL')} sub="szt lacznie" color={reportTotals.reject ? 'text-red-400' : 'text-green-400'} />
                <Kpi label="Czas pracy" value={minsToHHMM(reportTotals.runtime)} sub="aktywna praca" color="text-green-400" />
                <Kpi label="Alarmy + postoje" value={minsToHHMM(reportTotals.alarm + reportTotals.downtime)} sub={hasProblems ? 'wymaga sprawdzenia' : 'bez problemow'} color={(reportTotals.alarm + reportTotals.downtime) > 60 ? 'text-red-400' : 'text-amber-400'} />
              </div>

              <div className="card">
                <div className="card-header">
                  <div>
                    <div className="card-title">Wpisy godzinowe zlecenia</div>
                    <div className="card-sub">{reports.length} wpisow · mozna korygowac z poziomu kierownika</div>
                  </div>
                </div>
                {loadingRep ? (
                  <div className="text-center py-6 text-navy-500 text-sm">Ladowanie...</div>
                ) : reports.length === 0 ? (
                  <div className="text-center py-6 text-navy-500 text-sm">Brak raportow</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-navy-700">
                          {['Data', 'Godzina', 'Operator', 'Dobre', 'Na zlec.', 'Odrzut', 'Praca', 'Alarm', 'Akcja'].map(h => (
                            <th key={h} className="text-left py-2 px-2 font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {reports.map(r => {
                          const hasIssue = r.alarm_min > 15 || (r.downtime_min + r.failure_min) > 10
                          return (
                            <tr key={r.id} className={cn('border-b border-navy-800', hasIssue ? 'bg-red-500/5' : 'hover:bg-navy-800/40')}>
                              <td className="py-2 px-2 text-navy-400">{new Date(r.report_date).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })}</td>
                              <td className="py-2 px-2 font-mono text-white">{r.hour_block}</td>
                              <td className="py-2 px-2 text-navy-300 max-w-[90px] truncate">{r.operator?.full_name ?? '-'}</td>
                              <td className="py-2 px-2 font-bold font-mono text-white">{r.good_count.toLocaleString('pl-PL')}</td>
                              <td className="py-2 px-2 font-bold font-mono text-brand">{(r.order_qty ?? 0).toLocaleString('pl-PL')}</td>
                              <td className="py-2 px-2 font-mono text-red-400">{r.reject_count || '-'}</td>
                              <td className="py-2 px-2 font-mono text-green-400">{minsToHHMM(r.runtime_min)}</td>
                              <td className="py-2 px-2 font-mono text-red-400">{r.alarm_min > 0 ? minsToHHMM(r.alarm_min) : '-'}</td>
                              <td className="py-2 px-2"><button className="btn-secondary text-xs py-1 px-2" onClick={() => openReportEdit(r)}>Edytuj</button></td>
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

      {editingOrder && orderEdit && (
        <Modal title="Edytuj zlecenie" subtitle={editingOrder.order_number} onClose={() => { setEditingOrder(null); setError('') }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Numer zlecenia"><input className="input mt-1" value={orderEdit.order_number} onChange={e => setOrderEdit({ ...orderEdit, order_number: e.target.value })} /></Field>
            <Field label="Maszyna">
              <select className="input mt-1" value={orderEdit.machine_id} onChange={e => setOrderEdit({ ...orderEdit, machine_id: e.target.value })}>
                {machines.map(machine => <option key={machine.id} value={machine.id}>{machine.name}</option>)}
              </select>
            </Field>
            <Field label="Plan sztuk"><input className="input mt-1" type="number" min="0" value={orderEdit.target_qty} onChange={e => setOrderEdit({ ...orderEdit, target_qty: e.target.value })} /></Field>
            <Field label="Wyprodukowano"><input className="input mt-1" type="number" min="0" value={orderEdit.produced_qty} onChange={e => setOrderEdit({ ...orderEdit, produced_qty: e.target.value })} /></Field>
            <Field label="Status">
              <select className="input mt-1" value={orderEdit.status} onChange={e => setOrderEdit({ ...orderEdit, status: e.target.value as Order['status'] })}>
                <option value="active">Aktywne</option>
                <option value="paused">Zapauzowane</option>
                <option value="completed">Zakonczone</option>
                <option value="cancelled">Anulowane</option>
              </select>
            </Field>
            <Field label="Start"><input className="input mt-1" type="datetime-local" value={orderEdit.started_at} onChange={e => setOrderEdit({ ...orderEdit, started_at: e.target.value })} /></Field>
            <Field label="Koniec"><input className="input mt-1" type="datetime-local" value={orderEdit.completed_at} onChange={e => setOrderEdit({ ...orderEdit, completed_at: e.target.value })} /></Field>
          </div>
          <Field label="Notatka"><textarea className="input mt-1 min-h-[90px]" value={orderEdit.notes} onChange={e => setOrderEdit({ ...orderEdit, notes: e.target.value })} /></Field>
          {error && <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
          <div className="flex justify-end gap-2 mt-5">
            <button className="btn-secondary" disabled={saving} onClick={() => { setEditingOrder(null); setError('') }}>Anuluj</button>
            <button className="btn-primary" disabled={saving} onClick={saveOrder}>{saving ? 'Zapisywanie...' : 'Zapisz zlecenie'}</button>
          </div>
        </Modal>
      )}

      {editingReport && reportEdit && (
        <Modal title="Edytuj wpis godzinowy" subtitle={`${editingReport.report_date} · ${editingReport.hour_block}`} onClose={() => { setEditingReport(null); setError('') }}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['good_count', 'Sztuki dobre'],
              ['order_qty', 'Sztuki na zlecenie'],
              ['reject_count', 'Odrzut'],
              ['runtime_min', 'Praca min'],
              ['ready_min', 'Gotowosc min'],
              ['alarm_min', 'Alarm min'],
              ['downtime_min', 'Postoj min'],
              ['failure_min', 'Awaria min']
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <input className="input mt-1" type="number" min="0" value={reportEdit[key as keyof ReportEdit]} onChange={e => setReportEdit({ ...reportEdit, [key]: e.target.value })} />
              </Field>
            ))}
          </div>
          <Field label="Powod postoju"><input className="input mt-1" value={reportEdit.downtime_reason} onChange={e => setReportEdit({ ...reportEdit, downtime_reason: e.target.value })} /></Field>
          <Field label="Notatka"><textarea className="input mt-1 min-h-[90px]" value={reportEdit.notes} onChange={e => setReportEdit({ ...reportEdit, notes: e.target.value })} /></Field>
          {error && <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
          <div className="flex justify-end gap-2 mt-5">
            <button className="btn-secondary" disabled={saving} onClick={() => { setEditingReport(null); setError('') }}>Anuluj</button>
            <button className="btn-primary" disabled={saving} onClick={saveReport}>{saving ? 'Zapisywanie...' : 'Zapisz wpis'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-navy-900 rounded-xl p-3">
      <div className="text-xs text-navy-500 mb-1">{label}</div>
      <div className="font-bold text-white">{value}</div>
    </div>
  )
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={cn('kpi-value text-xl', color)}>{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mt-3">
      <span className="text-xs text-navy-400 font-bold uppercase tracking-wider">{label}</span>
      {children}
    </label>
  )
}

function Modal({ title, subtitle, children, onClose }: { title: string; subtitle: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="card w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="card-header">
          <div>
            <div className="card-title">{title}</div>
            <div className="card-sub">{subtitle}</div>
          </div>
          <button className="btn-secondary text-xs py-1.5 px-3" onClick={onClose}>Zamknij</button>
        </div>
        {children}
      </div>
    </div>
  )
}
