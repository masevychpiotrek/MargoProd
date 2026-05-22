import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────
interface ProductionPlan {
  id: string; year: number; month: number; name: string
  status: 'draft' | 'active' | 'closed'; notes: string | null
  created_at: string
}
interface PlanItem {
  id: string; plan_id: string
  assortment_id: string | null; product_name: string
  product_number: string | null; sku: string | null; customer: string | null
  planned_qty: number; deadline: string | null
  machine_ids: string[] | null; priority: number
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled'
  notes: string | null
  // joined
  assortment?: { name: string }
  produced_qty?: number
}
interface Machine { id: string; name: string; code: string }
interface Assortment { id: string; name: string }

const MONTHS = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień']
const PRIORITY_LABELS = ['', 'Wysoki', 'Średni', 'Niski']
const PRIORITY_COLORS = ['', 'text-red-400', 'text-amber-400', 'text-green-400']
const STATUS_PLAN: Record<string, { label: string; cls: string }> = {
  draft:       { label: 'Szkic',        cls: 'status-info' },
  active:      { label: '● Aktywny',    cls: 'status-ok' },
  closed:      { label: '✓ Zamknięty',  cls: 'status-alarm' }
}
const STATUS_ITEM: Record<string, { label: string; cls: string }> = {
  planned:     { label: 'Planowane',    cls: 'status-info' },
  in_progress: { label: '▶ W realizacji', cls: 'status-ok' },
  completed:   { label: '✓ Zakończone', cls: 'status-info' },
  cancelled:   { label: '✕ Anulowane',  cls: 'status-alarm' }
}

// ── Empty item form ───────────────────────────────────────────────────────
const emptyItem = (): Partial<PlanItem> => ({
  product_name: '', product_number: '', sku: '', customer: '',
  planned_qty: 0, deadline: '', priority: 2, status: 'planned',
  assortment_id: null, machine_ids: [], notes: ''
})

export default function ProductionPlan() {
  const [plans,       setPlans]       = useState<ProductionPlan[]>([])
  const [activePlan,  setActivePlan]  = useState<ProductionPlan | null>(null)
  const [items,       setItems]       = useState<PlanItem[]>([])
  const [machines,    setMachines]    = useState<Machine[]>([])
  const [assortments, setAssortments] = useState<Assortment[]>([])
  const [loading,     setLoading]     = useState(true)
  const [msg,         setMsg]         = useState('')

  // Filtry
  const [filterStatus,   setFilterStatus]   = useState('')
  const [filterCustomer, setFilterCustomer] = useState('')
  const [filterPriority, setFilterPriority] = useState('')

  // Modals
  const [showNewPlan,  setShowNewPlan]  = useState(false)
  const [showNewItem,  setShowNewItem]  = useState(false)
  const [editItem,     setEditItem]     = useState<PlanItem | null>(null)
  const [saving,       setSaving]       = useState(false)

  // Nowy plan form
  const [newPlanYear,  setNewPlanYear]  = useState(new Date().getFullYear())
  const [newPlanMonth, setNewPlanMonth] = useState(new Date().getMonth() + 1)
  const [newPlanNotes, setNewPlanNotes] = useState('')

  // Nowa pozycja form
  const [itemForm, setItemForm] = useState<Partial<PlanItem>>(emptyItem())

  useEffect(() => {
    loadMeta()
  }, [])

  useEffect(() => {
    if (activePlan) loadItems(activePlan.id)
  }, [activePlan])

  const loadMeta = async () => {
    setLoading(true)
    const [plRes, mRes, aRes] = await Promise.all([
      supabase.from('production_plans').select('*').order('year', { ascending: false }).order('month', { ascending: false }),
      supabase.from('machines').select('*').eq('is_active', true).order('code'),
      supabase.from('assortments').select('*').eq('is_active', true).order('sort_order')
    ])
    if (plRes.data) {
      setPlans(plRes.data as ProductionPlan[])
      // Auto-select active plan
      const active = (plRes.data as ProductionPlan[]).find(p => p.status === 'active')
      if (active) setActivePlan(active)
      else if (plRes.data.length > 0) setActivePlan(plRes.data[0] as ProductionPlan)
    }
    if (mRes.data) setMachines(mRes.data as Machine[])
    if (aRes.data) setAssortments(aRes.data as Assortment[])
    setLoading(false)
  }

  const loadItems = async (planId: string) => {
    // Load items with produced quantities from orders
    const { data } = await supabase
      .from('plan_items')
      .select('*, assortment:assortments(name)')
      .eq('plan_id', planId)
      .order('priority').order('created_at')
    if (!data) return

    // Get produced quantities from orders
    const { data: orders } = await supabase
      .from('production_orders')
      .select('plan_item_id, produced_qty')
      .eq('plan_id', planId)
      .not('plan_item_id', 'is', null)

    const producedMap: Record<string, number> = {}
    ;(orders ?? []).forEach((o: { plan_item_id: string; produced_qty: number }) => {
      producedMap[o.plan_item_id] = (producedMap[o.plan_item_id] ?? 0) + o.produced_qty
    })

    setItems((data as PlanItem[]).map(item => ({
      ...item,
      produced_qty: producedMap[item.id] ?? 0
    })))
  }

  const handleCreatePlan = async () => {
    setSaving(true)
    const name = `Plan ${MONTHS[newPlanMonth - 1]} ${newPlanYear}`
    const { data, error } = await supabase.from('production_plans').insert({
      year: newPlanYear, month: newPlanMonth, name, notes: newPlanNotes || null, status: 'draft'
    }).select().single()
    if (error) { setMsg('Błąd: ' + error.message); setSaving(false); return }
    setMsg(`Plan "${name}" utworzony`)
    setShowNewPlan(false); setNewPlanNotes('')
    await loadMeta()
    setActivePlan(data as ProductionPlan)
    setSaving(false)
    setTimeout(() => setMsg(''), 3000)
  }

  const handlePlanStatus = async (plan: ProductionPlan, status: string) => {
    // Tylko jeden plan może być aktywny
    if (status === 'active') {
      await supabase.from('production_plans').update({ status: 'draft' }).eq('status', 'active')
    }
    await supabase.from('production_plans').update({ status }).eq('id', plan.id)
    setMsg(`Status planu zmieniony`)
    loadMeta()
    setTimeout(() => setMsg(''), 3000)
  }

  const handleSaveItem = async () => {
    if (!activePlan || !itemForm.product_name) return
    setSaving(true)
    const payload = {
      plan_id:        activePlan.id,
      assortment_id:  itemForm.assortment_id || null,
      product_name:   itemForm.product_name,
      product_number: itemForm.product_number || null,
      sku:            itemForm.sku || null,
      customer:       itemForm.customer || null,
      planned_qty:    itemForm.planned_qty ?? 0,
      deadline:       itemForm.deadline || null,
      machine_ids:    itemForm.machine_ids ?? [],
      priority:       itemForm.priority ?? 2,
      status:         itemForm.status ?? 'planned',
      notes:          itemForm.notes || null
    }
    if (editItem) {
      await supabase.from('plan_items').update(payload).eq('id', editItem.id)
      setMsg('Pozycja zaktualizowana')
    } else {
      await supabase.from('plan_items').insert(payload)
      setMsg('Pozycja dodana do planu')
    }
    setShowNewItem(false); setEditItem(null); setItemForm(emptyItem())
    loadItems(activePlan.id)
    setSaving(false)
    setTimeout(() => setMsg(''), 3000)
  }

  const handleDeleteItem = async (id: string) => {
    if (!confirm('Usunąć pozycję z planu?')) return
    await supabase.from('plan_items').delete().eq('id', id)
    if (activePlan) loadItems(activePlan.id)
  }

  const handleMachineToggle = (machineId: string) => {
    const current = itemForm.machine_ids ?? []
    const next = current.includes(machineId)
      ? current.filter(id => id !== machineId)
      : [...current, machineId]
    setItemForm(f => ({ ...f, machine_ids: next }))
  }

  // Filtered items
  const filteredItems = items.filter(item => {
    if (filterStatus && item.status !== filterStatus) return false
    if (filterCustomer && !item.customer?.toLowerCase().includes(filterCustomer.toLowerCase())) return false
    if (filterPriority && item.priority !== parseInt(filterPriority)) return false
    return true
  })

  // Plan stats
  const totalPlanned  = items.reduce((s, i) => s + i.planned_qty, 0)
  const totalProduced = items.reduce((s, i) => s + (i.produced_qty ?? 0), 0)
  const planPct       = totalPlanned > 0 ? Math.round(totalProduced / totalPlanned * 100) : 0
  const customers     = [...new Set(items.map(i => i.customer).filter(Boolean))]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Plan Produkcyjny</h1>
          <p className="text-navy-400 mt-1">Centralny moduł systemu — bez planu brak produkcji</p>
        </div>
        <button onClick={() => setShowNewPlan(true)} className="btn-primary px-5 py-2.5">
          + Nowy plan miesięczny
        </button>
      </div>

      {msg && <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm font-bold">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Lista planów — lewa kolumna */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-navy-400 uppercase tracking-wider px-1 mb-3">Plany miesięczne</div>
          {loading
            ? <div className="text-navy-500 text-sm px-1">Ładowanie...</div>
            : plans.length === 0
              ? <div className="text-navy-500 text-sm px-1">Brak planów — utwórz pierwszy</div>
              : plans.map(p => {
                const s = STATUS_PLAN[p.status]
                return (
                  <button key={p.id} onClick={() => setActivePlan(p)}
                    className={cn('w-full text-left p-3 rounded-xl border-2 transition-all',
                      activePlan?.id === p.id ? 'border-brand bg-brand/10' : 'border-navy-700 bg-navy-800 hover:border-navy-500'
                    )}>
                    <div className="font-bold text-white text-sm">{p.name}</div>
                    <div className="mt-1"><span className={cn('text-xs', s.cls)}>{s.label}</span></div>
                  </button>
                )
              })
          }
        </div>

        {/* Szczegóły aktywnego planu — prawa część */}
        <div className="lg:col-span-3 space-y-4">
          {!activePlan ? (
            <div className="card text-center py-12">
              <div className="text-4xl mb-4">📋</div>
              <div className="text-xl font-bold text-white mb-2">Wybierz lub utwórz plan</div>
              <p className="text-navy-400 text-sm">Wybierz plan z listy po lewej lub utwórz nowy plan miesięczny</p>
            </div>
          ) : (
            <>
              {/* Plan header */}
              <div className="card">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-white">{activePlan.name}</h2>
                    <div className="flex items-center gap-3 mt-1">
                      <span className={cn('text-sm', STATUS_PLAN[activePlan.status].cls)}>
                        {STATUS_PLAN[activePlan.status].label}
                      </span>
                      {activePlan.notes && <span className="text-xs text-navy-400">{activePlan.notes}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {activePlan.status === 'draft' && (
                      <button onClick={() => handlePlanStatus(activePlan, 'active')}
                        className="btn-primary text-xs py-1.5 px-3">● Aktywuj plan</button>
                    )}
                    {activePlan.status === 'active' && (
                      <button onClick={() => handlePlanStatus(activePlan, 'closed')}
                        className="btn-secondary text-xs py-1.5 px-3">✓ Zamknij plan</button>
                    )}
                    {activePlan.status !== 'closed' && (
                      <button onClick={() => { setItemForm(emptyItem()); setEditItem(null); setShowNewItem(true) }}
                        className="btn-primary text-xs py-1.5 px-3">+ Dodaj produkt</button>
                    )}
                  </div>
                </div>

                {/* Plan KPI */}
                {items.length > 0 && (
                  <div className="grid grid-cols-4 gap-3 mt-4">
                    {[
                      { l: 'Pozycji w planie', v: items.length, c: 'text-white' },
                      { l: 'Plan łącznie', v: totalPlanned.toLocaleString('pl-PL') + ' szt', c: 'text-brand' },
                      { l: 'Wyprodukowano', v: totalProduced.toLocaleString('pl-PL') + ' szt', c: totalProduced >= totalPlanned ? 'text-green-400' : 'text-white' },
                      { l: 'Realizacja', v: planPct + '%', c: planPct >= 100 ? 'text-green-400' : planPct >= 75 ? 'text-amber-400' : 'text-red-400' },
                    ].map(k => (
                      <div key={k.l} className="bg-navy-900 rounded-xl p-3 text-center">
                        <div className="text-xs text-navy-500 mb-1">{k.l}</div>
                        <div className={cn('font-bold font-mono', k.c)}>{k.v}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Filtry */}
              {items.length > 0 && (
                <div className="flex gap-3 flex-wrap">
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input text-sm py-1.5 w-auto">
                    <option value="">Wszystkie statusy</option>
                    {Object.entries(STATUS_ITEM).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="input text-sm py-1.5 w-auto">
                    <option value="">Wszystkie priorytety</option>
                    <option value="1">Wysoki</option>
                    <option value="2">Średni</option>
                    <option value="3">Niski</option>
                  </select>
                  {customers.length > 0 && (
                    <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)} className="input text-sm py-1.5 w-auto">
                      <option value="">Wszyscy klienci</option>
                      {customers.map(c => <option key={c!} value={c!}>{c}</option>)}
                    </select>
                  )}
                  {(filterStatus || filterCustomer || filterPriority) && (
                    <button onClick={() => { setFilterStatus(''); setFilterCustomer(''); setFilterPriority('') }}
                      className="btn-secondary text-xs py-1.5 px-3">✕ Wyczyść</button>
                  )}
                </div>
              )}

              {/* Lista pozycji */}
              <div className="card overflow-hidden">
                {filteredItems.length === 0 ? (
                  <div className="text-center py-10">
                    <div className="text-3xl mb-3">📦</div>
                    <div className="text-white font-bold mb-1">Brak pozycji w planie</div>
                    <p className="text-navy-400 text-sm">Dodaj produkty do planu aby móc rejestrować produkcję</p>
                    {activePlan.status !== 'closed' && (
                      <button onClick={() => { setItemForm(emptyItem()); setEditItem(null); setShowNewItem(true) }}
                        className="btn-primary mt-4 px-5 py-2">+ Dodaj pierwszy produkt</button>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-navy-700">
                          {['Prior.','Asortyment','Plan','Wykonanie','Realizacja','Termin','Status','Automaty',''].map(h => (
                            <th key={h} className="text-left py-2.5 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredItems.map(item => {
                          const produced = item.produced_qty ?? 0
                          const pct      = item.planned_qty > 0 ? Math.round(produced / item.planned_qty * 100) : 0
                          const s        = STATUS_ITEM[item.status]
                          const itemMachines = machines.filter(m => (item.machine_ids ?? []).includes(m.id))
                          return (
                            <tr key={item.id} className="border-b border-navy-800 hover:bg-navy-800/40">
                              <td className="py-2.5 px-3">
                                <span className={cn('text-xs font-bold', PRIORITY_COLORS[item.priority])}>
                                  {PRIORITY_LABELS[item.priority]}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-semibold text-white max-w-[180px]">
                                {item.product_name}
                                {item.assortment && <div className="text-xs text-brand">{item.assortment.name}</div>}
                              </td>

                              <td className="py-2.5 px-3 font-bold font-mono text-brand">{item.planned_qty.toLocaleString('pl-PL')}</td>
                              <td className="py-2.5 px-3 font-bold font-mono text-white">{produced.toLocaleString('pl-PL')}</td>
                              <td className="py-2.5 px-3 min-w-[100px]">
                                <div className="flex items-center gap-2">
                                  <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden flex-1">
                                    <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-green-500' : pct >= 75 ? 'bg-amber-500' : 'bg-brand')}
                                      style={{ width: `${Math.min(pct,100)}%` }} />
                                  </div>
                                  <span className={cn('text-xs font-bold w-8 text-right', pct >= 100 ? 'text-green-400' : pct >= 75 ? 'text-amber-400' : 'text-navy-400')}>{pct}%</span>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-xs text-navy-400 whitespace-nowrap">
                                {item.deadline ? new Date(item.deadline).toLocaleDateString('pl-PL') : '—'}
                              </td>
                              <td className="py-2.5 px-3"><span className={cn('text-xs', s.cls)}>{s.label}</span></td>
                              <td className="py-2.5 px-3 text-xs text-navy-400">
                                {itemMachines.length > 0 ? itemMachines.map(m => m.name).join(', ') : '—'}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="flex gap-1">
                                  <button onClick={() => { setEditItem(item); setItemForm({...item}); setShowNewItem(true) }}
                                    className="btn-secondary text-xs py-1 px-2">✏</button>
                                  <button onClick={() => handleDeleteItem(item.id)}
                                    className="btn-danger text-xs py-1 px-2">🗑</button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal: Nowy plan */}
      {showNewPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.9)', backdropFilter: 'blur(8px)' }}>
          <div className="bg-navy-800 border border-navy-600 rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-white mb-5">Nowy plan miesięczny</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Miesiąc</label>
                  <select value={newPlanMonth} onChange={e => setNewPlanMonth(parseInt(e.target.value))} className="input">
                    {MONTHS.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Rok</label>
                  <select value={newPlanYear} onChange={e => setNewPlanYear(parseInt(e.target.value))} className="input">
                    {[2025,2026,2027,2028].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Uwagi</label>
                <input value={newPlanNotes} onChange={e => setNewPlanNotes(e.target.value)} placeholder="Opcjonalnie..." className="input" />
              </div>
              <div className="bg-brand/10 border border-brand/20 rounded-xl p-3 text-xs text-brand">
                Plan zostanie utworzony jako szkic. Aktywuj go gdy jest gotowy do realizacji.
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleCreatePlan} disabled={saving} className="btn-primary flex-1 py-3">
                {saving ? 'Tworzenie...' : 'Utwórz plan'}
              </button>
              <button onClick={() => setShowNewPlan(false)} className="btn-secondary px-5 py-3">Anuluj</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Dodaj/edytuj pozycję */}
      {showNewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.9)', backdropFilter: 'blur(8px)' }}>
          <div className="bg-navy-800 border border-navy-600 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-white mb-5">
              {editItem ? 'Edytuj pozycję planu' : 'Dodaj produkt do planu'}
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="label">Asortyment *</label>
                <select value={itemForm.assortment_id ?? ''} onChange={e => {
                  const a = assortments.find(a => a.id === e.target.value)
                  setItemForm(f => ({...f, assortment_id: e.target.value || null, product_name: a?.name ?? f.product_name}))
                }} className="input text-base">
                  <option value="">— Wybierz asortyment —</option>
                  {assortments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Planowana ilość (szt)</label>
                <input type="number" value={itemForm.planned_qty ?? 0}
                  onChange={e => setItemForm(f => ({...f, planned_qty: parseInt(e.target.value) || 0}))}
                  className="input text-xl font-bold font-mono" />
              </div>
              <div>
                <label className="label">Termin realizacji</label>
                <input type="date" value={itemForm.deadline ?? ''}
                  onChange={e => setItemForm(f => ({...f, deadline: e.target.value}))} className="input" />
              </div>
              <div>
                <label className="label">Priorytet</label>
                <select value={itemForm.priority ?? 2} onChange={e => setItemForm(f => ({...f, priority: parseInt(e.target.value)}))} className="input">
                  <option value={1}>🔴 Wysoki</option>
                  <option value={2}>🟡 Średni</option>
                  <option value={3}>🟢 Niski</option>
                </select>
              </div>
              <div>
                <label className="label">Status</label>
                <select value={itemForm.status ?? 'planned'} onChange={e => setItemForm(f => ({...f, status: e.target.value as PlanItem['status']}))} className="input">
                  {Object.entries(STATUS_ITEM).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Przypisane automaty</label>
                <div className="flex gap-3 flex-wrap mt-1">
                  {machines.map(m => (
                    <button key={m.id} type="button"
                      onClick={() => handleMachineToggle(m.id)}
                      className={cn('px-4 py-2 rounded-xl border-2 text-sm font-medium transition-all',
                        (itemForm.machine_ids ?? []).includes(m.id)
                          ? 'border-brand bg-brand/10 text-white'
                          : 'border-navy-600 bg-navy-900 text-navy-400 hover:border-navy-500'
                      )}>
                      🤖 {m.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="col-span-2">
                <label className="label">Uwagi</label>
                <textarea value={itemForm.notes ?? ''} onChange={e => setItemForm(f => ({...f, notes: e.target.value}))}
                  placeholder="Opcjonalnie..." rows={2} className="input resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleSaveItem} disabled={saving || !itemForm.product_name}
                className="btn-primary flex-1 py-3">
                {saving ? 'Zapisywanie...' : editItem ? '💾 Zapisz zmiany' : '+ Dodaj do planu'}
              </button>
              <button onClick={() => { setShowNewItem(false); setEditItem(null); setItemForm(emptyItem()) }}
                className="btn-secondary px-5 py-3">Anuluj</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
