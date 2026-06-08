import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ProductionTarget, Machine } from '@/types/database'

export default function AdminTargets() {
  const [targets, setTargets] = useState<(ProductionTarget & { machine?: Machine })[]>([])
  const [machines, setMachines] = useState<Machine[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ machine_id: '', target_per_hour: 3200, valid_from: new Date().toISOString().split('T')[0], valid_to: '', note: '' })

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [tRes, mRes] = await Promise.all([
      supabase.from('production_targets').select('*, machine:machines(*)').order('valid_from', { ascending: false }),
      supabase.from('machines').select('*').eq('is_active', true)
    ])
    if (tRes.data) setTargets(tRes.data as never)
    if (mRes.data) { setMachines(mRes.data as Machine[]); if (mRes.data[0]) setForm(f => ({ ...f, machine_id: mRes.data![0].id })) }
    setLoading(false)
  }

  const handleAdd = async () => {
    const { error } = await supabase.from('production_targets').insert({
      machine_id: form.machine_id,
      target_per_hour: form.target_per_hour,
      valid_from: form.valid_from,
      valid_to: form.valid_to || null,
      note: form.note || null
    })
    if (error) { setMsg('Błąd: ' + error.message) }
    else { setMsg('Target dodany'); setShowAdd(false); load() }
    setTimeout(() => setMsg(''), 3000)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Usunąć ten target?')) return
    await supabase.from('production_targets').delete().eq('id', id)
    load()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Targety produkcji</h1>
          <p className="text-navy-400 mt-1">Progi efektywności dla maszyn w określonych datach</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary px-5 py-2.5">+ Dodaj target</button>
      </div>

      {msg && <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm">{msg}</div>}

      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-sm text-amber-400">
        ℹ Domyślny target to <strong>3200 szt/h</strong> ustawiony bezpośrednio na maszynie. Tutaj możesz dodać tymczasowe nadpisanie dla konkretnego okresu.
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-700">
              {['Maszyna','Target','Obowiązuje od','Obowiązuje do','Notatka',''].map(h => (
                <th key={h} className="text-left py-2.5 px-4 text-xs font-bold text-navy-400 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? <tr><td colSpan={6} className="text-center py-8 text-navy-500">Ładowanie...</td></tr>
              : targets.length === 0
                ? <tr><td colSpan={6} className="text-center py-8 text-navy-500">Brak targetów — używane są wartości domyślne z maszyn</td></tr>
                : targets.map(t => (
                  <tr key={t.id} className="border-b border-navy-800 hover:bg-navy-800/40">
                    <td className="py-2.5 px-4 font-semibold text-white">{(t.machine as Machine)?.name ?? '—'}</td>
                    <td className="py-2.5 px-4 font-bold font-mono text-brand">{t.target_per_hour} szt/h</td>
                    <td className="py-2.5 px-4 font-mono text-xs text-navy-300">{t.valid_from}</td>
                    <td className="py-2.5 px-4 font-mono text-xs text-navy-400">{t.valid_to ?? '—'}</td>
                    <td className="py-2.5 px-4 text-xs text-navy-500">{t.note ?? '—'}</td>
                    <td className="py-2.5 px-4">
                      <button onClick={() => handleDelete(t.id)} className="btn-danger text-xs py-1 px-3">Usuń</button>
                    </td>
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.85)', backdropFilter: 'blur(8px)' }}>
          <div className="bg-navy-800 border border-navy-600 rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-white mb-5">Dodaj target</h2>
            <div className="space-y-4">
              <div>
                <label className="label">Maszyna</label>
                <select value={form.machine_id} onChange={e => setForm(f => ({...f, machine_id: e.target.value}))} className="input">
                  {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Target (szt/h)</label>
                <input type="number" value={form.target_per_hour} onChange={e => setForm(f => ({...f, target_per_hour: parseInt(e.target.value)}))} className="input text-lg font-bold font-mono" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Obowiązuje od</label>
                  <input type="date" value={form.valid_from} onChange={e => setForm(f => ({...f, valid_from: e.target.value}))} className="input" />
                </div>
                <div>
                  <label className="label">Obowiązuje do</label>
                  <input type="date" value={form.valid_to} onChange={e => setForm(f => ({...f, valid_to: e.target.value}))} className="input" />
                </div>
              </div>
              <div>
                <label className="label">Notatka</label>
                <input value={form.note} onChange={e => setForm(f => ({...f, note: e.target.value}))} className="input" placeholder="Opcjonalnie..." />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleAdd} className="btn-primary flex-1 py-3">Dodaj target</button>
              <button onClick={() => setShowAdd(false)} className="btn-secondary px-5 py-3">Anuluj</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
