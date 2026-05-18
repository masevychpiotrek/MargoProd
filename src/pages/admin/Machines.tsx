import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Machine } from '@/types/database'

export default function AdminMachines() {
  const [machines, setMachines] = useState<Machine[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [edits, setEdits] = useState<Record<string, Partial<Machine>>>({})

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('machines').select('*').order('code')
    if (data) { setMachines(data as Machine[]); setEdits({}) }
    setLoading(false)
  }

  const set = (id: string, field: keyof Machine, value: string | number | boolean) => {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  const save = async (m: Machine) => {
    const changes = edits[m.id]
    if (!changes || Object.keys(changes).length === 0) return
    setSaving(m.id)
    const { error } = await supabase.from('machines').update(changes).eq('id', m.id)
    setSaving(null)
    if (error) { setMsg('Błąd: ' + error.message) }
    else { setMsg(`${m.name} zaktualizowany`); load() }
    setTimeout(() => setMsg(''), 3000)
  }

  const toggleActive = async (m: Machine) => {
    await supabase.from('machines').update({ is_active: !m.is_active }).eq('id', m.id)
    load()
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Konfiguracja maszyn</h1>
        <p className="text-navy-400 mt-1">Zarządzaj maszynami i targetami godzinowymi</p>
      </div>

      {msg && <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm">{msg}</div>}

      {loading ? <div className="text-navy-400">Ładowanie...</div> : (
        <div className="space-y-4">
          {machines.map(m => {
            const e = edits[m.id] ?? {}
            const name = e.name !== undefined ? e.name as string : m.name
            const target = e.target_per_hour !== undefined ? e.target_per_hour as number : m.target_per_hour
            const dept = e.department !== undefined ? e.department as string : m.department
            const desc = e.description !== undefined ? e.description as string : (m.description ?? '')

            return (
              <div key={m.id} className="card">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🤖</span>
                    <div>
                      <div className="font-bold text-white">{m.name}</div>
                      <div className="text-xs text-navy-400 font-mono">{m.code}</div>
                    </div>
                  </div>
                  <button onClick={() => toggleActive(m)}
                    className={m.is_active ? 'status-ok cursor-pointer' : 'status-alarm cursor-pointer'}>
                    {m.is_active ? '✓ Aktywna' : '✕ Nieaktywna'}
                  </button>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                  <div>
                    <label className="label">Nazwa</label>
                    <input value={name} onChange={e => set(m.id, 'name', e.target.value)} className="input" />
                  </div>
                  <div>
                    <label className="label">Target (szt/h)</label>
                    <input type="number" value={target} onChange={e => set(m.id, 'target_per_hour', parseInt(e.target.value))} className="input text-lg font-bold font-mono" />
                  </div>
                  <div>
                    <label className="label">Dział</label>
                    <input value={dept} onChange={e => set(m.id, 'department', e.target.value)} className="input" />
                  </div>
                  <div>
                    <label className="label">Opis</label>
                    <input value={desc} onChange={e => set(m.id, 'description', e.target.value)} className="input" placeholder="Opcjonalnie..." />
                  </div>
                </div>

                {edits[m.id] && Object.keys(edits[m.id]).length > 0 && (
                  <div className="flex gap-3">
                    <button onClick={() => save(m)} disabled={saving === m.id} className="btn-primary px-5 py-2">
                      {saving === m.id ? 'Zapisywanie...' : '💾 Zapisz zmiany'}
                    </button>
                    <button onClick={() => setEdits(prev => { const n = {...prev}; delete n[m.id]; return n })} className="btn-secondary px-5 py-2">
                      Anuluj
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
