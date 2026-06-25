import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { TpmMachine, TpmStation, TpmCheckpoint, TpmRiskLevel } from '@/types/tpm'

async function fetchMachines() {
  const { data } = await supabase.from('tpm_machines').select('*').order('sort_order')
  return data as TpmMachine[] ?? []
}
async function fetchStations(machineId: string) {
  const { data } = await supabase.from('tpm_stations').select('*').eq('machine_id', machineId).order('sort_order')
  return data as TpmStation[] ?? []
}
async function fetchCheckpoints(stationId: string) {
  const { data } = await supabase.from('tpm_checkpoints').select('*').eq('station_id', stationId).order('sort_order')
  return data as TpmCheckpoint[] ?? []
}

const RISK_COLOR: Record<string, string> = {
  low: 'text-green-400', medium: 'text-yellow-400', high: 'text-orange-400', critical: 'text-red-400'
}

export default function TpmStationsAdmin() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [machineId, setMachineId] = useState('')
  const [stationId, setStationId] = useState('')
  const [msg, setMsg] = useState('')
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  // nowa stacja
  const [newStation, setNewStation] = useState({ station_number: '', name: '', pm_frequency_days: 7 })
  const [showAddStation, setShowAddStation] = useState(false)
  // nowy punkt
  const [newCheckpoint, setNewCheckpoint] = useState('')

  const { data: machines = [] } = useQuery({ queryKey: ['tpm_machines_admin'], queryFn: fetchMachines })
  const { data: stations = [] } = useQuery({ queryKey: ['tpm_stations_admin', machineId], queryFn: () => fetchStations(machineId), enabled: !!machineId })
  const { data: checkpoints = [] } = useQuery({ queryKey: ['tpm_checkpoints_admin', stationId], queryFn: () => fetchCheckpoints(stationId), enabled: !!stationId })

  const station = stations.find(s => s.id === stationId)

  const addStationMut = useMutation({
    mutationFn: async () => {
      if (!newStation.station_number || !newStation.name) throw new Error('Numer i nazwa stacji są wymagane.')
      const { error } = await supabase.from('tpm_stations').insert({
        machine_id: machineId, station_number: newStation.station_number, name: newStation.name,
        pm_frequency_days: newStation.pm_frequency_days, sort_order: stations.length + 1
      })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tpm_stations_admin', machineId] }); setNewStation({ station_number: '', name: '', pm_frequency_days: 7 }); setShowAddStation(false); flash('Stacja dodana') },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })

  const updateStationMut = useMutation({
    mutationFn: async (patch: Partial<TpmStation>) => {
      if (!stationId) return
      const { error } = await supabase.from('tpm_stations').update(patch).eq('id', stationId)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tpm_stations_admin', machineId] }); flash('Zapisano') },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })

  const addCheckpointMut = useMutation({
    mutationFn: async () => {
      if (!newCheckpoint.trim()) throw new Error('Podaj treść punktu.')
      const { error } = await supabase.from('tpm_checkpoints').insert({ station_id: stationId, name: newCheckpoint, sort_order: checkpoints.length + 1 })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tpm_checkpoints_admin', stationId] }); setNewCheckpoint(''); flash('Punkt dodany') },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })
  const toggleCpMut = useMutation({
    mutationFn: async (cp: TpmCheckpoint) => { await supabase.from('tpm_checkpoints').update({ is_active: !cp.is_active }).eq('id', cp.id) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tpm_checkpoints_admin', stationId] })
  })
  const renameCpMut = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => { await supabase.from('tpm_checkpoints').update({ name }).eq('id', id) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tpm_checkpoints_admin', stationId] }); flash('Zmieniono') }
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Stacje i punkty kontrolne</h1>
          <p className="text-navy-400 text-sm">Konfiguracja automatów, stacji i checklist AM</p>
        </div>
        <button onClick={() => navigate('/tpm')} className="btn-secondary px-4 py-2">← Pulpit TPM</button>
      </div>

      {msg && <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm text-green-400">{msg}</div>}

      {/* Automat */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-3">Automat</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {machines.map(m => (
            <button key={m.id} onClick={() => { setMachineId(m.id); setStationId('') }}
              className={`rounded-xl border-2 p-3 text-left ${machineId === m.id ? 'border-brand bg-brand/10 text-brand' : 'border-navy-600 text-white hover:border-navy-500'}`}>
              <span className="font-bold">{m.name}</span> <span className="text-xs font-mono text-navy-400">{m.code}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Stacje */}
      {machineId && (
        <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Stacje ({stations.length})</div>
            <button onClick={() => setShowAddStation(v => !v)} className="btn-primary px-3 py-1.5 text-sm">{showAddStation ? 'Anuluj' : '+ Stacja'}</button>
          </div>

          {showAddStation && (
            <div className="rounded-xl bg-navy-900 p-3 grid grid-cols-1 sm:grid-cols-4 gap-2">
              <input value={newStation.station_number} onChange={e => setNewStation({ ...newStation, station_number: e.target.value })} className="input" placeholder="Numer (np. ST99)" />
              <input value={newStation.name} onChange={e => setNewStation({ ...newStation, name: e.target.value })} className="input sm:col-span-2" placeholder="Nazwa stacji" />
              <button onClick={() => addStationMut.mutate()} className="btn-primary px-4 py-2">Dodaj</button>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {stations.map(s => (
              <button key={s.id} onClick={() => setStationId(s.id)}
                className={`rounded-lg border-2 p-2 text-left ${stationId === s.id ? 'border-brand bg-brand/10' : 'border-navy-600 hover:border-navy-500'}`}>
                <div className="font-bold text-sm text-white">{s.station_number}</div>
                <div className={`text-xs ${RISK_COLOR[s.risk_level]}`}>ryzyko: {s.risk_level}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Karta stacji + punkty */}
      {station && (
        <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-bold text-white">{station.station_number} — {station.name}</div>
            <button onClick={() => navigate(`/tpm/station/${station.id}`)} className="btn-secondary px-3 py-1.5 text-sm">Otwórz kartę stacji →</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Częstotliwość PM (dni)</label>
              <input type="number" defaultValue={station.pm_frequency_days} onBlur={e => updateStationMut.mutate({ pm_frequency_days: parseInt(e.target.value) || 7 })} className="input" />
            </div>
            <div>
              <label className="label">Poziom ryzyka</label>
              <select defaultValue={station.risk_level} onChange={e => updateStationMut.mutate({ risk_level: e.target.value as TpmRiskLevel })} className="input">
                <option value="low">Niski</option><option value="medium">Średni</option><option value="high">Wysoki</option><option value="critical">Krytyczny</option>
              </select>
            </div>
            <div>
              <label className="label">Stacja krytyczna</label>
              <select defaultValue={station.is_critical ? '1' : '0'} onChange={e => updateStationMut.mutate({ is_critical: e.target.value === '1' })} className="input">
                <option value="1">Tak</option><option value="0">Nie</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">Opis działania stacji</label>
            <textarea defaultValue={station.function_desc ?? ''} onBlur={e => updateStationMut.mutate({ function_desc: e.target.value })} rows={2} className="input resize-none" placeholder="Opis funkcji stacji..." />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Standardowe ustawienia</label>
              <textarea defaultValue={station.standard_settings ?? ''} onBlur={e => updateStationMut.mutate({ standard_settings: e.target.value })} rows={2} className="input resize-none" />
            </div>
            <div>
              <label className="label">Standardowe parametry / zakresy</label>
              <textarea defaultValue={station.param_ranges ?? ''} onBlur={e => updateStationMut.mutate({ param_ranges: e.target.value })} rows={2} className="input resize-none" />
            </div>
          </div>

          {/* Punkty kontrolne */}
          <div className="border-t border-navy-700 pt-3">
            <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-3">Punkty kontrolne AM ({checkpoints.length})</div>
            <div className="space-y-2">
              {checkpoints.map(cp => (
                <div key={cp.id} className="flex items-center gap-2">
                  <input defaultValue={cp.name} onBlur={e => { if (e.target.value !== cp.name) renameCpMut.mutate({ id: cp.id, name: e.target.value }) }}
                    className={`input flex-1 ${!cp.is_active ? 'opacity-50 line-through' : ''}`} />
                  <button onClick={() => toggleCpMut.mutate(cp)} className={cp.is_active ? 'status-ok cursor-pointer' : 'status-alarm cursor-pointer'}>{cp.is_active ? '✓' : '✕'}</button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <input value={newCheckpoint} onChange={e => setNewCheckpoint(e.target.value)} className="input flex-1" placeholder="Nowy punkt kontrolny..." />
              <button onClick={() => addCheckpointMut.mutate()} className="btn-primary px-4 py-2">Dodaj punkt</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
