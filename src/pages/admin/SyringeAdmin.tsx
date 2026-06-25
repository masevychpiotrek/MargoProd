import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, logAudit } from '@/lib/supabase'
import type {
  SaMachine, SaAssortment, SaDefectCategory, SaDowntimeCategory,
  SaChecklistItem, SaOrder
} from '@/types/database'

type Tab = 'machines' | 'assortments' | 'defects' | 'downtimes' | 'checklist' | 'orders'

const TABS: { id: Tab; label: string }[] = [
  { id: 'machines',    label: 'Automaty' },
  { id: 'assortments', label: 'Asortymenty' },
  { id: 'defects',     label: 'Kategorie braków' },
  { id: 'downtimes',   label: 'Kategorie przestojów' },
  { id: 'checklist',   label: 'Checklista przezbrojenia' },
  { id: 'orders',      label: 'Zlecenia produkcyjne' },
]

function Toast({ msg }: { msg: string }) {
  if (!msg) return null
  const isError = msg.toLowerCase().startsWith('błąd') || msg.toLowerCase().startsWith('blad')
  return (
    <div className={`rounded-xl px-4 py-3 text-sm border ${isError ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-green-500/10 border-green-500/30 text-green-400'}`}>
      {msg}
    </div>
  )
}

export default function SyringeAdmin() {
  const [tab, setTab] = useState<Tab>('machines')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Automaty strzykawkowe — konfiguracja</h1>
        <p className="text-navy-400 mt-1">Zarządzaj automatami, asortymentami, kategoriami i zleceniami modułu strzykawkowego</p>
      </div>

      <div className="flex gap-2 flex-wrap border-b border-navy-700 pb-3">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition-all border ${
              tab === t.id ? 'border-brand bg-brand/10 text-brand' : 'border-navy-600 text-navy-400 hover:border-navy-500 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'machines'    && <MachinesTab />}
      {tab === 'assortments' && <AssortmentsTab />}
      {tab === 'defects'     && <DefectsTab />}
      {tab === 'downtimes'   && <DowntimesTab />}
      {tab === 'checklist'   && <ChecklistTab />}
      {tab === 'orders'      && <OrdersTab />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// AUTOMATY
// ════════════════════════════════════════════════════════════
function MachinesTab() {
  const qc = useQueryClient()
  const [msg, setMsg] = useState('')
  const [edits, setEdits] = useState<Record<string, Partial<SaMachine>>>({})
  const [newM, setNewM] = useState({ name: '', code: '', location: '', nominal_per_hour: 1000 })
  const [showAdd, setShowAdd] = useState(false)

  const { data: machines = [], isLoading } = useQuery({
    queryKey: ['admin_sa_machines'],
    queryFn: async () => {
      const { data } = await supabase.from('sa_machines').select('*').is('deleted_at', null).order('sort_order')
      return data as SaMachine[] ?? []
    }
  })

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  const addMut = useMutation({
    mutationFn: async () => {
      if (!newM.name || !newM.code) throw new Error('Nazwa i kod są wymagane.')
      const { error } = await supabase.from('sa_machines').insert({
        name: newM.name, code: newM.code, location: newM.location || null,
        nominal_per_hour: newM.nominal_per_hour, sort_order: machines.length + 1
      })
      if (error) throw error
      await logAudit('config_change', 'sa_machines', undefined, undefined, { name: newM.name, code: newM.code })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin_sa_machines'] })
      setNewM({ name: '', code: '', location: '', nominal_per_hour: 1000 })
      setShowAdd(false)
      flash('Automat dodany')
    },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })

  const saveMut = useMutation({
    mutationFn: async (m: SaMachine) => {
      const changes = edits[m.id]
      if (!changes) return
      const { error } = await supabase.from('sa_machines').update(changes).eq('id', m.id)
      if (error) throw error
      await logAudit('config_change', 'sa_machines', m.id, { name: m.name }, changes)
    },
    onSuccess: (_d, m) => {
      qc.invalidateQueries({ queryKey: ['admin_sa_machines'] })
      setEdits(prev => { const n = { ...prev }; delete n[m.id]; return n })
      flash('Zapisano')
    },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })

  const toggleMut = useMutation({
    mutationFn: async (m: SaMachine) => {
      await supabase.from('sa_machines').update({ is_active: !m.is_active }).eq('id', m.id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin_sa_machines'] })
  })

  const set = (id: string, field: keyof SaMachine, value: string | number) =>
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))

  return (
    <div className="space-y-4">
      <Toast msg={msg} />

      <div className="flex justify-between items-center">
        <p className="text-navy-400 text-sm">{machines.length} automatów</p>
        <button onClick={() => setShowAdd(v => !v)} className="btn-primary px-4 py-2">
          {showAdd ? 'Anuluj' : '+ Dodaj automat'}
        </button>
      </div>

      {showAdd && (
        <div className="card space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="label">Nazwa *</label>
              <input value={newM.name} onChange={e => setNewM({ ...newM, name: e.target.value })} className="input" placeholder="np. Automat strzykawkowy 1" />
            </div>
            <div>
              <label className="label">Kod *</label>
              <input value={newM.code} onChange={e => setNewM({ ...newM, code: e.target.value })} className="input" placeholder="np. SA-01" />
            </div>
            <div>
              <label className="label">Lokalizacja</label>
              <input value={newM.location} onChange={e => setNewM({ ...newM, location: e.target.value })} className="input" placeholder="np. Hala B" />
            </div>
            <div>
              <label className="label">Wydajność nom. (szt/h)</label>
              <input type="number" value={newM.nominal_per_hour} onChange={e => setNewM({ ...newM, nominal_per_hour: parseInt(e.target.value) || 0 })} className="input" />
            </div>
          </div>
          <button onClick={() => addMut.mutate()} disabled={addMut.isPending} className="btn-primary px-5 py-2">
            {addMut.isPending ? 'Dodawanie...' : 'Utwórz automat'}
          </button>
        </div>
      )}

      {isLoading ? <div className="text-navy-400">Ładowanie...</div> : machines.map(m => {
        const e = edits[m.id] ?? {}
        const hasChanges = Object.keys(e).length > 0
        return (
          <div key={m.id} className="card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">💉</span>
                <div>
                  <div className="font-bold text-white">{m.name}</div>
                  <div className="text-xs text-navy-400 font-mono">{m.code}</div>
                </div>
              </div>
              <button onClick={() => toggleMut.mutate(m)} className={m.is_active ? 'status-ok cursor-pointer' : 'status-alarm cursor-pointer'}>
                {m.is_active ? '✓ Aktywny' : '✕ Nieaktywny'}
              </button>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <div>
                <label className="label">Nazwa</label>
                <input value={e.name ?? m.name} onChange={ev => set(m.id, 'name', ev.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Lokalizacja</label>
                <input value={(e.location ?? m.location) ?? ''} onChange={ev => set(m.id, 'location', ev.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Wydajność nom. (szt/h)</label>
                <input type="number" value={e.nominal_per_hour ?? m.nominal_per_hour} onChange={ev => set(m.id, 'nominal_per_hour', parseInt(ev.target.value) || 0)} className="input font-bold font-mono" />
              </div>
              <div>
                <label className="label">Kolejność</label>
                <input type="number" value={e.sort_order ?? m.sort_order} onChange={ev => set(m.id, 'sort_order', parseInt(ev.target.value) || 0)} className="input" />
              </div>
            </div>
            {hasChanges && (
              <div className="flex gap-3">
                <button onClick={() => saveMut.mutate(m)} disabled={saveMut.isPending} className="btn-primary px-5 py-2">💾 Zapisz</button>
                <button onClick={() => setEdits(prev => { const n = { ...prev }; delete n[m.id]; return n })} className="btn-secondary px-5 py-2">Anuluj</button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// ASORTYMENTY
// ════════════════════════════════════════════════════════════
function AssortmentsTab() {
  const qc = useQueryClient()
  const [msg, setMsg] = useState('')
  const [edits, setEdits] = useState<Record<string, Partial<SaAssortment>>>({})
  const [newA, setNewA] = useState({ name: '', code: '', volume_ml: 0, nominal_per_hour: 1000 })
  const [showAdd, setShowAdd] = useState(false)

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['admin_sa_assortments'],
    queryFn: async () => {
      const { data } = await supabase.from('sa_assortments').select('*').order('sort_order')
      return data as SaAssortment[] ?? []
    }
  })
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  const addMut = useMutation({
    mutationFn: async () => {
      if (!newA.name || !newA.code) throw new Error('Nazwa i kod są wymagane.')
      const { error } = await supabase.from('sa_assortments').insert({
        name: newA.name, code: newA.code, volume_ml: newA.volume_ml || null,
        nominal_per_hour: newA.nominal_per_hour, sort_order: items.length + 1
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin_sa_assortments'] })
      setNewA({ name: '', code: '', volume_ml: 0, nominal_per_hour: 1000 })
      setShowAdd(false); flash('Asortyment dodany')
    },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })
  const saveMut = useMutation({
    mutationFn: async (a: SaAssortment) => {
      const changes = edits[a.id]; if (!changes) return
      const { error } = await supabase.from('sa_assortments').update(changes).eq('id', a.id)
      if (error) throw error
    },
    onSuccess: (_d, a) => { qc.invalidateQueries({ queryKey: ['admin_sa_assortments'] }); setEdits(prev => { const n = { ...prev }; delete n[a.id]; return n }); flash('Zapisano') },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })
  const toggleMut = useMutation({
    mutationFn: async (a: SaAssortment) => { await supabase.from('sa_assortments').update({ is_active: !a.is_active }).eq('id', a.id) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin_sa_assortments'] })
  })
  const set = (id: string, field: keyof SaAssortment, value: string | number) =>
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))

  return (
    <div className="space-y-4">
      <Toast msg={msg} />
      <div className="flex justify-between items-center">
        <p className="text-navy-400 text-sm">{items.length} asortymentów</p>
        <button onClick={() => setShowAdd(v => !v)} className="btn-primary px-4 py-2">{showAdd ? 'Anuluj' : '+ Dodaj asortyment'}</button>
      </div>

      {showAdd && (
        <div className="card space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div><label className="label">Nazwa *</label><input value={newA.name} onChange={e => setNewA({ ...newA, name: e.target.value })} className="input" placeholder="np. Strzykawka 100 ml" /></div>
            <div><label className="label">Kod *</label><input value={newA.code} onChange={e => setNewA({ ...newA, code: e.target.value })} className="input" placeholder="np. SYR_100ML" /></div>
            <div><label className="label">Pojemność (ml)</label><input type="number" value={newA.volume_ml} onChange={e => setNewA({ ...newA, volume_ml: parseFloat(e.target.value) || 0 })} className="input" /></div>
            <div><label className="label">Wydajność nom. (szt/h)</label><input type="number" value={newA.nominal_per_hour} onChange={e => setNewA({ ...newA, nominal_per_hour: parseInt(e.target.value) || 0 })} className="input" /></div>
          </div>
          <button onClick={() => addMut.mutate()} disabled={addMut.isPending} className="btn-primary px-5 py-2">{addMut.isPending ? 'Dodawanie...' : 'Utwórz asortyment'}</button>
        </div>
      )}

      {isLoading ? <div className="text-navy-400">Ładowanie...</div> : items.map(a => {
        const e = edits[a.id] ?? {}; const hasChanges = Object.keys(e).length > 0
        return (
          <div key={a.id} className="card">
            <div className="flex items-center justify-between mb-4">
              <div className="font-bold text-white">{a.name} <span className="text-xs text-navy-400 font-mono ml-2">{a.code}</span></div>
              <button onClick={() => toggleMut.mutate(a)} className={a.is_active ? 'status-ok cursor-pointer' : 'status-alarm cursor-pointer'}>{a.is_active ? '✓ Aktywny' : '✕ Nieaktywny'}</button>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <div><label className="label">Nazwa</label><input value={e.name ?? a.name} onChange={ev => set(a.id, 'name', ev.target.value)} className="input" /></div>
              <div><label className="label">Pojemność (ml)</label><input type="number" value={(e.volume_ml ?? a.volume_ml) ?? 0} onChange={ev => set(a.id, 'volume_ml', parseFloat(ev.target.value) || 0)} className="input" /></div>
              <div><label className="label">Wydajność nom. (szt/h)</label><input type="number" value={e.nominal_per_hour ?? a.nominal_per_hour} onChange={ev => set(a.id, 'nominal_per_hour', parseInt(ev.target.value) || 0)} className="input font-bold font-mono" /></div>
              <div><label className="label">Kolejność</label><input type="number" value={e.sort_order ?? a.sort_order} onChange={ev => set(a.id, 'sort_order', parseInt(ev.target.value) || 0)} className="input" /></div>
            </div>
            {hasChanges && (
              <div className="flex gap-3">
                <button onClick={() => saveMut.mutate(a)} disabled={saveMut.isPending} className="btn-primary px-5 py-2">💾 Zapisz</button>
                <button onClick={() => setEdits(prev => { const n = { ...prev }; delete n[a.id]; return n })} className="btn-secondary px-5 py-2">Anuluj</button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// KATEGORIE BRAKÓW
// ════════════════════════════════════════════════════════════
function DefectsTab() {
  const qc = useQueryClient()
  const [msg, setMsg] = useState('')
  const [newName, setNewName] = useState('')
  const [newCode, setNewCode] = useState('')
  const [newType, setNewType] = useState<'quality' | 'tech' | 'other'>('quality')
  const [newRequiresComment, setNewRequiresComment] = useState(false)

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['admin_sa_defects'],
    queryFn: async () => {
      const { data } = await supabase.from('sa_defect_categories').select('*').order('sort_order')
      return data as SaDefectCategory[] ?? []
    }
  })
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  const addMut = useMutation({
    mutationFn: async () => {
      if (!newName || !newCode) throw new Error('Nazwa i kod są wymagane.')
      const { error } = await supabase.from('sa_defect_categories').insert({
        name: newName, code: newCode, defect_type: newType, requires_comment: newRequiresComment, sort_order: items.length + 1
      })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin_sa_defects'] }); setNewName(''); setNewCode(''); setNewRequiresComment(false); flash('Kategoria dodana') },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })
  const toggleMut = useMutation({
    mutationFn: async (c: SaDefectCategory) => { await supabase.from('sa_defect_categories').update({ is_active: !c.is_active }).eq('id', c.id) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin_sa_defects'] })
  })
  const toggleCommentMut = useMutation({
    mutationFn: async (c: SaDefectCategory) => { await supabase.from('sa_defect_categories').update({ requires_comment: !c.requires_comment }).eq('id', c.id) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin_sa_defects'] })
  })

  const TYPE_LABEL: Record<string, string> = { quality: 'Jakościowy', tech: 'Technologiczny', other: 'Inny' }

  return (
    <div className="space-y-4">
      <Toast msg={msg} />
      <div className="card space-y-3">
        <div className="text-sm font-bold text-navy-300">Dodaj kategorię braku</div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div><label className="label">Nazwa *</label><input value={newName} onChange={e => setNewName(e.target.value)} className="input" placeholder="np. Pęknięty korpus" /></div>
          <div><label className="label">Kod *</label><input value={newCode} onChange={e => setNewCode(e.target.value)} className="input" placeholder="np. BODY_CRACK" /></div>
          <div>
            <label className="label">Typ</label>
            <select value={newType} onChange={e => setNewType(e.target.value as typeof newType)} className="input">
              <option value="quality">Jakościowy</option>
              <option value="tech">Technologiczny</option>
              <option value="other">Inny</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer pb-2">
              <input type="checkbox" checked={newRequiresComment} onChange={e => setNewRequiresComment(e.target.checked)} className="w-4 h-4 accent-brand" />
              <span className="text-sm text-navy-300">Wymaga komentarza</span>
            </label>
          </div>
        </div>
        <button onClick={() => addMut.mutate()} disabled={addMut.isPending} className="btn-primary px-5 py-2">{addMut.isPending ? 'Dodawanie...' : 'Dodaj'}</button>
      </div>

      {isLoading ? <div className="text-navy-400">Ładowanie...</div> : (
        <div className="card divide-y divide-navy-700">
          {items.map(c => (
            <div key={c.id} className="flex items-center justify-between py-3 gap-4">
              <div>
                <div className="font-medium text-white">{c.name}</div>
                <div className="text-xs text-navy-500 font-mono">{c.code} · {TYPE_LABEL[c.defect_type]}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => toggleCommentMut.mutate(c)} className={`text-xs px-2.5 py-1 rounded-lg border ${c.requires_comment ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-navy-600 text-navy-400'}`}>
                  {c.requires_comment ? 'Komentarz wym.' : 'Komentarz opc.'}
                </button>
                <button onClick={() => toggleMut.mutate(c)} className={c.is_active ? 'status-ok cursor-pointer' : 'status-alarm cursor-pointer'}>{c.is_active ? '✓' : '✕'}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// KATEGORIE PRZESTOJÓW
// ════════════════════════════════════════════════════════════
function DowntimesTab() {
  const qc = useQueryClient()
  const [msg, setMsg] = useState('')
  const [newName, setNewName] = useState('')
  const [newCode, setNewCode] = useState('')
  const [newType, setNewType] = useState<'planned' | 'unplanned' | 'quality' | 'logistics'>('unplanned')

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['admin_sa_downtimes'],
    queryFn: async () => {
      const { data } = await supabase.from('sa_downtime_categories').select('*').order('sort_order')
      return data as SaDowntimeCategory[] ?? []
    }
  })
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  const addMut = useMutation({
    mutationFn: async () => {
      if (!newName || !newCode) throw new Error('Nazwa i kod są wymagane.')
      const { error } = await supabase.from('sa_downtime_categories').insert({ name: newName, code: newCode, category_type: newType, sort_order: items.length + 1 })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin_sa_downtimes'] }); setNewName(''); setNewCode(''); flash('Kategoria dodana') },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })
  const toggleMut = useMutation({
    mutationFn: async (c: SaDowntimeCategory) => { await supabase.from('sa_downtime_categories').update({ is_active: !c.is_active }).eq('id', c.id) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin_sa_downtimes'] })
  })

  const TYPE_LABEL: Record<string, string> = { planned: 'Planowany', unplanned: 'Nieplanowany', quality: 'Jakość', logistics: 'Logistyka' }

  return (
    <div className="space-y-4">
      <Toast msg={msg} />
      <div className="card space-y-3">
        <div className="text-sm font-bold text-navy-300">Dodaj kategorię przestoju</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="label">Nazwa *</label><input value={newName} onChange={e => setNewName(e.target.value)} className="input" placeholder="np. Wymiana formy" /></div>
          <div><label className="label">Kod *</label><input value={newCode} onChange={e => setNewCode(e.target.value)} className="input" placeholder="np. MOLD_CHANGE" /></div>
          <div>
            <label className="label">Typ</label>
            <select value={newType} onChange={e => setNewType(e.target.value as typeof newType)} className="input">
              <option value="unplanned">Nieplanowany</option>
              <option value="planned">Planowany</option>
              <option value="quality">Jakość</option>
              <option value="logistics">Logistyka</option>
            </select>
          </div>
        </div>
        <button onClick={() => addMut.mutate()} disabled={addMut.isPending} className="btn-primary px-5 py-2">{addMut.isPending ? 'Dodawanie...' : 'Dodaj'}</button>
      </div>

      {isLoading ? <div className="text-navy-400">Ładowanie...</div> : (
        <div className="card divide-y divide-navy-700">
          {items.map(c => (
            <div key={c.id} className="flex items-center justify-between py-3 gap-4">
              <div>
                <div className="font-medium text-white">{c.name}</div>
                <div className="text-xs text-navy-500 font-mono">{c.code} · {TYPE_LABEL[c.category_type]}</div>
              </div>
              <button onClick={() => toggleMut.mutate(c)} className={c.is_active ? 'status-ok cursor-pointer' : 'status-alarm cursor-pointer'}>{c.is_active ? '✓ Aktywna' : '✕ Wyłączona'}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// CHECKLISTA PRZEZBROJENIA
// ════════════════════════════════════════════════════════════
function ChecklistTab() {
  const qc = useQueryClient()
  const [msg, setMsg] = useState('')
  const [newName, setNewName] = useState('')
  const [newRequired, setNewRequired] = useState(true)

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['admin_sa_checklist'],
    queryFn: async () => {
      const { data } = await supabase.from('sa_checklist_items').select('*').order('sort_order')
      return data as SaChecklistItem[] ?? []
    }
  })
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  const addMut = useMutation({
    mutationFn: async () => {
      if (!newName) throw new Error('Nazwa jest wymagana.')
      const { error } = await supabase.from('sa_checklist_items').insert({ name: newName, is_required: newRequired, sort_order: items.length + 1 })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin_sa_checklist'] }); setNewName(''); setNewRequired(true); flash('Pozycja dodana') },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })
  const toggleActiveMut = useMutation({
    mutationFn: async (c: SaChecklistItem) => { await supabase.from('sa_checklist_items').update({ is_active: !c.is_active }).eq('id', c.id) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin_sa_checklist'] })
  })
  const toggleReqMut = useMutation({
    mutationFn: async (c: SaChecklistItem) => { await supabase.from('sa_checklist_items').update({ is_required: !c.is_required }).eq('id', c.id) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin_sa_checklist'] })
  })

  return (
    <div className="space-y-4">
      <Toast msg={msg} />
      <div className="card space-y-3">
        <div className="text-sm font-bold text-navy-300">Dodaj pozycję checklisty</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2"><label className="label">Treść pozycji *</label><input value={newName} onChange={e => setNewName(e.target.value)} className="input" placeholder="np. Sprawdzono ciśnienie sprężonego powietrza" /></div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer pb-2">
              <input type="checkbox" checked={newRequired} onChange={e => setNewRequired(e.target.checked)} className="w-4 h-4 accent-brand" />
              <span className="text-sm text-navy-300">Wymagana</span>
            </label>
          </div>
        </div>
        <button onClick={() => addMut.mutate()} disabled={addMut.isPending} className="btn-primary px-5 py-2">{addMut.isPending ? 'Dodawanie...' : 'Dodaj'}</button>
      </div>

      {isLoading ? <div className="text-navy-400">Ładowanie...</div> : (
        <div className="card divide-y divide-navy-700">
          {items.map(c => (
            <div key={c.id} className="flex items-center justify-between py-3 gap-4">
              <div className="font-medium text-white">{c.name}</div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => toggleReqMut.mutate(c)} className={`text-xs px-2.5 py-1 rounded-lg border ${c.is_required ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-navy-600 text-navy-400'}`}>
                  {c.is_required ? 'Wymagana' : 'Opcjonalna'}
                </button>
                <button onClick={() => toggleActiveMut.mutate(c)} className={c.is_active ? 'status-ok cursor-pointer' : 'status-alarm cursor-pointer'}>{c.is_active ? '✓' : '✕'}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// ZLECENIA PRODUKCYJNE
// ════════════════════════════════════════════════════════════
function OrdersTab() {
  const qc = useQueryClient()
  const [msg, setMsg] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ order_number: '', machine_id: '', assortment_id: '', target_qty: 0, planned_date: '' })

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['admin_sa_orders'],
    queryFn: async () => {
      const { data } = await supabase.from('sa_orders').select('*, assortment:sa_assortments(*), machine:sa_machines(*)').order('created_at', { ascending: false }).limit(100)
      return data as SaOrder[] ?? []
    }
  })
  const { data: machines = [] } = useQuery({
    queryKey: ['admin_sa_machines_sel'],
    queryFn: async () => { const { data } = await supabase.from('sa_machines').select('*').eq('is_active', true).is('deleted_at', null).order('sort_order'); return data as SaMachine[] ?? [] }
  })
  const { data: assortments = [] } = useQuery({
    queryKey: ['admin_sa_assortments_sel'],
    queryFn: async () => { const { data } = await supabase.from('sa_assortments').select('*').eq('is_active', true).order('sort_order'); return data as SaAssortment[] ?? [] }
  })
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  const addMut = useMutation({
    mutationFn: async () => {
      if (!form.order_number) throw new Error('Numer zlecenia jest wymagany.')
      if (!form.assortment_id) throw new Error('Wybierz asortyment.')
      if (form.target_qty <= 0) throw new Error('Podaj ilość docelową.')
      const { error } = await supabase.from('sa_orders').insert({
        order_number: form.order_number,
        machine_id: form.machine_id || null,
        assortment_id: form.assortment_id,
        target_qty: form.target_qty,
        planned_date: form.planned_date || null,
        status: 'planned'
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin_sa_orders'] })
      setForm({ order_number: '', machine_id: '', assortment_id: '', target_qty: 0, planned_date: '' })
      setShowAdd(false); flash('Zlecenie utworzone')
    },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })
  const statusMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => { await supabase.from('sa_orders').update({ status }).eq('id', id) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin_sa_orders'] })
  })

  const STATUS_LABEL: Record<string, string> = { planned: 'Zaplanowane', in_progress: 'W toku', completed: 'Zakończone', cancelled: 'Anulowane', on_hold: 'Wstrzymane' }
  const STATUS_COLOR: Record<string, string> = {
    planned: 'bg-blue-500/15 text-blue-300', in_progress: 'bg-green-500/15 text-green-300',
    completed: 'bg-navy-700 text-navy-300', cancelled: 'bg-red-500/15 text-red-300', on_hold: 'bg-amber-500/15 text-amber-300'
  }

  return (
    <div className="space-y-4">
      <Toast msg={msg} />
      <div className="flex justify-between items-center">
        <p className="text-navy-400 text-sm">{orders.length} zleceń</p>
        <button onClick={() => setShowAdd(v => !v)} className="btn-primary px-4 py-2">{showAdd ? 'Anuluj' : '+ Nowe zlecenie'}</button>
      </div>

      {showAdd && (
        <div className="card space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <div><label className="label">Numer zlecenia *</label><input value={form.order_number} onChange={e => setForm({ ...form, order_number: e.target.value })} className="input" placeholder="np. ZP/2026/001" /></div>
            <div>
              <label className="label">Asortyment *</label>
              <select value={form.assortment_id} onChange={e => setForm({ ...form, assortment_id: e.target.value })} className="input">
                <option value="">— wybierz —</option>
                {assortments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Automat</label>
              <select value={form.machine_id} onChange={e => setForm({ ...form, machine_id: e.target.value })} className="input">
                <option value="">— dowolny —</option>
                {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div><label className="label">Ilość docelowa *</label><input type="number" value={form.target_qty} onChange={e => setForm({ ...form, target_qty: parseInt(e.target.value) || 0 })} className="input" /></div>
            <div><label className="label">Planowana data</label><input type="date" value={form.planned_date} onChange={e => setForm({ ...form, planned_date: e.target.value })} className="input" /></div>
          </div>
          <button onClick={() => addMut.mutate()} disabled={addMut.isPending} className="btn-primary px-5 py-2">{addMut.isPending ? 'Tworzenie...' : 'Utwórz zlecenie'}</button>
        </div>
      )}

      {isLoading ? <div className="text-navy-400">Ładowanie...</div> : (
        <div className="card divide-y divide-navy-700">
          {orders.length === 0 && <div className="py-6 text-center text-navy-500">Brak zleceń.</div>}
          {orders.map(o => {
            const pct = o.target_qty > 0 ? Math.round(o.produced_qty / o.target_qty * 100) : 0
            return (
              <div key={o.id} className="flex items-center justify-between py-3 gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="font-bold text-white">{o.order_number}</div>
                  <div className="text-xs text-navy-400">
                    {o.assortment?.name ?? '—'} · {o.machine?.name ?? 'dowolny automat'}
                    {o.planned_date && ` · ${new Date(o.planned_date).toLocaleDateString('pl')}`}
                  </div>
                  <div className="text-xs text-navy-500 mt-0.5">
                    {o.produced_qty.toLocaleString('pl')} / {o.target_qty.toLocaleString('pl')} szt ({pct}%)
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS_COLOR[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                  <select value={o.status} onChange={e => statusMut.mutate({ id: o.id, status: e.target.value })} className="input text-xs py-1 px-2">
                    {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
