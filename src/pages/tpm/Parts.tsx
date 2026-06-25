import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { notifyUsers, getUserIdsByRole } from '@/lib/tpm'
import { exportCsv, exportXlsx } from '@/lib/tpmExport'
import { PART_STATUS_LABELS } from '@/types/tpm'
import type { TpmMachine, TpmStation, TpmPart, PartStatus } from '@/types/tpm'

async function fetchParts() {
  const { data } = await supabase.from('tpm_parts').select('*, machine:tpm_machines(*), station:tpm_stations(*)').eq('is_active', true).order('name')
  return data as TpmPart[] ?? []
}
async function fetchMachines() {
  const { data } = await supabase.from('tpm_machines').select('*').eq('is_active', true).order('sort_order')
  return data as TpmMachine[] ?? []
}
async function fetchStations() {
  const { data } = await supabase.from('tpm_stations').select('*').eq('is_active', true).order('sort_order')
  return data as TpmStation[] ?? []
}

const STATUS_COLOR: Record<string, string> = {
  available: 'bg-green-500/15 text-green-300', low: 'bg-amber-500/15 text-amber-300',
  minimum: 'bg-orange-500/15 text-orange-300', none: 'bg-red-500/15 text-red-300',
  ordered: 'bg-blue-500/15 text-blue-300', awaiting_delivery: 'bg-blue-500/15 text-blue-300',
  delivered: 'bg-green-500/15 text-green-300', withdrawn: 'bg-navy-700 text-navy-400'
}

function deriveStatus(current: number, min: number): PartStatus {
  if (current <= 0) return 'none'
  if (current <= min) return 'minimum'
  if (current <= min * 1.5) return 'low'
  return 'available'
}

export default function TpmParts() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const canManage = ['specialist', 'manager', 'admin'].includes(profile?.role ?? '')

  const [showAdd, setShowAdd] = useState(false)
  const [msg, setMsg] = useState('')
  const [newP, setNewP] = useState({ name: '', part_number: '', manufacturer: '', manufacturer_number: '', machine_id: '', station_id: '', min_stock: 0, current_stock: 0, unit: 'szt', location: '', lead_time_days: 0, usage_desc: '' })

  const { data: parts = [], isLoading } = useQuery({ queryKey: ['tpm_parts'], queryFn: fetchParts, refetchInterval: 60000 })
  const { data: machines = [] } = useQuery({ queryKey: ['tpm_machines'], queryFn: fetchMachines })
  const { data: stations = [] } = useQuery({ queryKey: ['tpm_stations_all'], queryFn: fetchStations })

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3500) }
  const stOfMachine = stations.filter(s => s.machine_id === newP.machine_id)

  const exportParts = (kind: 'csv' | 'xlsx') => {
    const header = ['Nazwa', 'Nr części', 'Producent', 'Nr producenta', 'Stacja', 'Stan', 'Min', 'Jednostka', 'Lokalizacja', 'Dostawa(dni)', 'Użyto', 'Status']
    const rows = parts.map(p => [
      p.name, p.part_number ?? '', p.manufacturer ?? '', p.manufacturer_number ?? '',
      (p.station as { station_number?: string })?.station_number ?? '', p.current_stock, p.min_stock, p.unit,
      p.location ?? '', p.lead_time_days ?? '', p.used_count, PART_STATUS_LABELS[p.status]
    ])
    const fname = `Czesci_TPM_${new Date().toISOString().split('T')[0]}`
    if (kind === 'csv') exportCsv(fname, header, rows)
    else exportXlsx(fname, [{ name: 'Części', header, rows }])
  }

  const addMut = useMutation({
    mutationFn: async () => {
      if (!newP.name.trim()) throw new Error('Podaj nazwę części.')
      const { error } = await supabase.from('tpm_parts').insert({
        ...newP,
        machine_id: newP.machine_id || null, station_id: newP.station_id || null,
        lead_time_days: newP.lead_time_days || null,
        status: deriveStatus(newP.current_stock, newP.min_stock)
      })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tpm_parts'] }); setShowAdd(false); setNewP({ name: '', part_number: '', manufacturer: '', manufacturer_number: '', machine_id: '', station_id: '', min_stock: 0, current_stock: 0, unit: 'szt', location: '', lead_time_days: 0, usage_desc: '' }); flash('Część dodana') },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })

  const stockMut = useMutation({
    mutationFn: async ({ part, delta }: { part: TpmPart; delta: number }) => {
      const next = Math.max(0, Number(part.current_stock) + delta)
      const status = deriveStatus(next, Number(part.min_stock))
      await supabase.from('tpm_parts').update({
        current_stock: next, status,
        ...(delta < 0 ? { used_count: part.used_count + Math.abs(delta), last_used_at: new Date().toISOString() } : {})
      }).eq('id', part.id)
      if (delta < 0 && profile) {
        await supabase.from('tpm_part_usages').insert({ part_id: part.id, user_id: profile.id, qty: Math.abs(delta) })
      }
      if (status === 'none' || status === 'minimum') {
        const ids = await getUserIdsByRole(['specialist', 'manager'])
        await notifyUsers(ids, `Brak/niski stan części: ${part.name}`, `Stan: ${next} ${part.unit} (min: ${part.min_stock})`, part.machine_id ?? undefined)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tpm_parts'] })
  })

  const statusMut = useMutation({
    mutationFn: async ({ part, status }: { part: TpmPart; status: PartStatus }) => {
      await supabase.from('tpm_parts').update({ status }).eq('id', part.id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tpm_parts'] })
  })

  const lowParts = parts.filter(p => ['none', 'minimum', 'low'].includes(p.status))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Rejestr części krytycznych</h1>
          <p className="text-navy-400 text-sm">{parts.length} pozycji · {lowParts.length} z niskim stanem</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportParts('csv')} className="btn-secondary px-3 py-2 text-sm">CSV</button>
          <button onClick={() => exportParts('xlsx')} className="btn-secondary px-3 py-2 text-sm">XLSX</button>
          <button onClick={() => navigate('/tpm')} className="btn-secondary px-4 py-2">← Pulpit TPM</button>
        </div>
      </div>

      {msg && <div className="rounded-xl border border-brand/30 bg-brand/10 px-4 py-2 text-sm text-brand">{msg}</div>}

      {lowParts.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-2">Alert — części wymagające uwagi</div>
          <div className="flex flex-wrap gap-2">
            {lowParts.map(p => (
              <span key={p.id} className={`text-xs px-2.5 py-1 rounded-full ${STATUS_COLOR[p.status]}`}>{p.name}: {p.current_stock} {p.unit}</span>
            ))}
          </div>
        </div>
      )}

      {canManage && <button onClick={() => setShowAdd(v => !v)} className="btn-primary px-4 py-2">{showAdd ? 'Anuluj' : '+ Dodaj część'}</button>}

      {showAdd && canManage && (
        <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input value={newP.name} onChange={e => setNewP({ ...newP, name: e.target.value })} className="input" placeholder="Nazwa części *" />
            <input value={newP.part_number} onChange={e => setNewP({ ...newP, part_number: e.target.value })} className="input" placeholder="Numer części" />
            <input value={newP.manufacturer} onChange={e => setNewP({ ...newP, manufacturer: e.target.value })} className="input" placeholder="Producent" />
            <input value={newP.manufacturer_number} onChange={e => setNewP({ ...newP, manufacturer_number: e.target.value })} className="input" placeholder="Nr producenta" />
            <select value={newP.machine_id} onChange={e => setNewP({ ...newP, machine_id: e.target.value, station_id: '' })} className="input">
              <option value="">Automat (opc.)</option>
              {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select value={newP.station_id} onChange={e => setNewP({ ...newP, station_id: e.target.value })} className="input" disabled={!newP.machine_id}>
              <option value="">Stacja (opc.)</option>
              {stOfMachine.map(s => <option key={s.id} value={s.id}>{s.station_number}</option>)}
            </select>
            <input type="number" value={newP.current_stock} onChange={e => setNewP({ ...newP, current_stock: parseFloat(e.target.value) || 0 })} className="input" placeholder="Stan aktualny" />
            <input type="number" value={newP.min_stock} onChange={e => setNewP({ ...newP, min_stock: parseFloat(e.target.value) || 0 })} className="input" placeholder="Stan minimalny" />
            <input value={newP.unit} onChange={e => setNewP({ ...newP, unit: e.target.value })} className="input" placeholder="Jednostka" />
            <input value={newP.location} onChange={e => setNewP({ ...newP, location: e.target.value })} className="input" placeholder="Lokalizacja magazynowa" />
            <input type="number" value={newP.lead_time_days} onChange={e => setNewP({ ...newP, lead_time_days: parseInt(e.target.value) || 0 })} className="input" placeholder="Czas dostawy (dni)" />
            <input value={newP.usage_desc} onChange={e => setNewP({ ...newP, usage_desc: e.target.value })} className="input" placeholder="Zastosowanie" />
          </div>
          <button onClick={() => addMut.mutate()} disabled={addMut.isPending} className="btn-primary px-5 py-2">{addMut.isPending ? 'Dodawanie...' : 'Dodaj część'}</button>
        </div>
      )}

      {isLoading ? <div className="text-navy-400">Ładowanie...</div> : (
        <div className="space-y-2">
          {parts.map(p => (
            <div key={p.id} className="rounded-xl border border-navy-700 bg-navy-800 p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="font-medium text-white">{p.name}</div>
                  <div className="text-xs text-navy-400 mt-0.5">
                    {p.part_number && `${p.part_number} · `}{p.manufacturer}
                    {p.station && ` · ${(p.station as { station_number?: string }).station_number}`}
                    {p.location && ` · ${p.location}`}
                  </div>
                  <div className="text-xs text-navy-500 mt-0.5">
                    Stan: <strong className="text-white">{p.current_stock} {p.unit}</strong> · min: {p.min_stock} · użyto: {p.used_count}
                    {p.lead_time_days ? ` · dostawa: ${p.lead_time_days} dni` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[p.status]}`}>{PART_STATUS_LABELS[p.status]}</span>
                </div>
              </div>
              {canManage && (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <button onClick={() => stockMut.mutate({ part: p, delta: -1 })} className="text-xs px-2.5 py-1 rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10">− Zużyj 1</button>
                  <button onClick={() => stockMut.mutate({ part: p, delta: 1 })} className="text-xs px-2.5 py-1 rounded-lg border border-green-500/30 text-green-300 hover:bg-green-500/10">+ Przyjmij 1</button>
                  <select value={p.status} onChange={e => statusMut.mutate({ part: p, status: e.target.value as PartStatus })} className="input text-xs py-1 px-2 max-w-[180px]">
                    {Object.entries(PART_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              )}
            </div>
          ))}
          {parts.length === 0 && <div className="text-center py-12 text-navy-500">Brak zarejestrowanych części.</div>}
        </div>
      )}
    </div>
  )
}
