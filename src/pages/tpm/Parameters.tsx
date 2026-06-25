import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { uploadTpmMedia, notifyUsers, getUserIdsByRole } from '@/lib/tpm'
import { exportCsv, exportXlsx } from '@/lib/tpmExport'
import type { TpmMachine, TpmStation, TpmParameter } from '@/types/tpm'

async function fetchMachines() {
  const { data } = await supabase.from('tpm_machines').select('*').eq('is_active', true).order('sort_order')
  return data as TpmMachine[] ?? []
}
async function fetchStations() {
  const { data } = await supabase.from('tpm_stations').select('*').eq('is_active', true).order('sort_order')
  return data as TpmStation[] ?? []
}
async function fetchParameters(stationId: string) {
  let q = supabase.from('tpm_parameters').select('*, user:profiles(id, full_name)').order('created_at', { ascending: false }).limit(200)
  if (stationId) q = q.eq('station_id', stationId)
  const { data } = await q
  return data as TpmParameter[] ?? []
}

export default function TpmParameters() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const canManage = ['specialist', 'manager', 'admin'].includes(profile?.role ?? '')
  const canApprove = ['manager', 'admin'].includes(profile?.role ?? '')

  const [machineId, setMachineId] = useState('')
  const [stationId, setStationId] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [msg, setMsg] = useState('')
  const [errors, setErrors] = useState<string[]>([])

  const [f, setF] = useState({
    param_name: '', value_before: '', value_after: '', unit: '', approved_range: '',
    reason: '', expected_effect: '', result_after: '', test_cycles: '', test_ok: '', test_nok: '',
    out_of_range: false, comment: ''
  })
  const [screenPhoto, setScreenPhoto] = useState<File | null>(null)
  const [settingPhoto, setSettingPhoto] = useState<File | null>(null)

  const { data: machines = [] } = useQuery({ queryKey: ['tpm_machines'], queryFn: fetchMachines })
  const { data: stations = [] } = useQuery({ queryKey: ['tpm_stations_all'], queryFn: fetchStations })
  const { data: params = [], isLoading } = useQuery({ queryKey: ['tpm_parameters', stationId], queryFn: () => fetchParameters(stationId) })

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3500) }
  const stOfMachine = stations.filter(s => s.machine_id === machineId)

  const exportParams = (kind: 'csv' | 'xlsx') => {
    const header = ['Data', 'Parametr', 'Przed', 'Po', 'Jednostka', 'Zakres', 'Powód', 'Poza zakresem', 'Zatwierdzone', 'Osoba']
    const rows = params.map(p => [
      new Date(p.created_at).toLocaleString('pl'), p.param_name, p.value_before ?? '', p.value_after, p.unit ?? '',
      p.approved_range ?? '', p.reason ?? '', p.out_of_range ? 'TAK' : 'NIE', p.approved_at ? 'TAK' : 'NIE',
      (p.user as { full_name?: string })?.full_name ?? ''
    ])
    const fname = `Parametry_TPM_${new Date().toISOString().split('T')[0]}`
    if (kind === 'csv') exportCsv(fname, header, rows)
    else exportXlsx(fname, [{ name: 'Parametry', header, rows }])
  }

  const addMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('Brak profilu.')
      const errs: string[] = []
      if (!machineId || !stationId) errs.push('Wybierz automat i stację.')
      if (!f.param_name.trim()) errs.push('Podaj nazwę parametru.')
      if (!f.value_after.trim()) errs.push('Podaj wartość po zmianie.')
      if (f.out_of_range && !f.reason.trim()) errs.push('Zmiana poza zakresem wymaga podania powodu.')
      if (errs.length > 0) { setErrors(errs); throw new Error('Walidacja') }

      let screenUrl: string | null = null, settingUrl: string | null = null
      if (screenPhoto) screenUrl = await uploadTpmMedia(screenPhoto, 'param')
      if (settingPhoto) settingUrl = await uploadTpmMedia(settingPhoto, 'param')

      const { error } = await supabase.from('tpm_parameters').insert({
        machine_id: machineId, station_id: stationId, user_id: profile.id,
        param_name: f.param_name, value_before: f.value_before || null, value_after: f.value_after,
        unit: f.unit || null, approved_range: f.approved_range || null, reason: f.reason || null,
        expected_effect: f.expected_effect || null, result_after: f.result_after || null,
        test_cycles: f.test_cycles ? parseInt(f.test_cycles) : null,
        test_ok: f.test_ok ? parseInt(f.test_ok) : null,
        test_nok: f.test_nok ? parseInt(f.test_nok) : null,
        screen_photo_url: screenUrl, setting_photo_url: settingUrl,
        comment: f.comment || null,
        out_of_range: f.out_of_range, requires_approval: f.out_of_range
      })
      if (error) throw error

      if (f.out_of_range) {
        const mgr = await getUserIdsByRole(['manager'])
        await notifyUsers(mgr, 'Zmiana parametru poza zakresem', `${f.param_name}: ${f.value_before ?? '?'} → ${f.value_after}`, machineId)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tpm_parameters'] })
      setF({ param_name: '', value_before: '', value_after: '', unit: '', approved_range: '', reason: '', expected_effect: '', result_after: '', test_cycles: '', test_ok: '', test_nok: '', out_of_range: false, comment: '' })
      setScreenPhoto(null); setSettingPhoto(null); setShowAdd(false); flash('Zapisano zmianę parametru')
    },
    onError: (e: Error) => { if (e.message !== 'Walidacja') setErrors([e.message]) }
  })

  const approveMut = useMutation({
    mutationFn: async (p: TpmParameter) => {
      await supabase.from('tpm_parameters').update({ approved_by: profile!.id, approved_at: new Date().toISOString() }).eq('id', p.id)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tpm_parameters'] }); flash('Zatwierdzono') }
  })
  const markGoodMut = useMutation({
    mutationFn: async (p: TpmParameter) => {
      // odznacz poprzednie dla tej stacji + parametru
      await supabase.from('tpm_parameters').update({ is_last_good: false }).eq('station_id', p.station_id).eq('param_name', p.param_name)
      await supabase.from('tpm_parameters').update({ is_last_good: true }).eq('id', p.id)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tpm_parameters'] }); flash('Oznaczono jako ostatnie prawidłowe') }
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Rejestr zmian parametrów</h1>
          <p className="text-navy-400 text-sm">Pełna historia regulacji — bez usuwania</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportParams('csv')} className="btn-secondary px-3 py-2 text-sm">CSV</button>
          <button onClick={() => exportParams('xlsx')} className="btn-secondary px-3 py-2 text-sm">XLSX</button>
          <button onClick={() => navigate('/tpm')} className="btn-secondary px-4 py-2">← Pulpit TPM</button>
        </div>
      </div>

      {msg && <div className="rounded-xl border border-brand/30 bg-brand/10 px-4 py-2 text-sm text-brand">{msg}</div>}

      {/* Filtr stacji */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <select value={machineId} onChange={e => { setMachineId(e.target.value); setStationId('') }} className="input">
          <option value="">Automat: wszystkie</option>
          {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={stationId} onChange={e => setStationId(e.target.value)} className="input" disabled={!machineId}>
          <option value="">Stacja: wszystkie</option>
          {stOfMachine.map(s => <option key={s.id} value={s.id}>{s.station_number}</option>)}
        </select>
      </div>

      {canManage && (
        <button onClick={() => setShowAdd(v => !v)} className="btn-primary px-4 py-2">{showAdd ? 'Anuluj' : '+ Zarejestruj zmianę parametru'}</button>
      )}

      {showAdd && canManage && (
        <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
          {errors.length > 0 && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 space-y-1">{errors.map((e, i) => <p key={i} className="text-sm text-red-300">• {e}</p>)}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select value={machineId} onChange={e => { setMachineId(e.target.value); setStationId('') }} className="input">
              <option value="">Automat *</option>
              {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select value={stationId} onChange={e => setStationId(e.target.value)} className="input" disabled={!machineId}>
              <option value="">Stacja *</option>
              {stOfMachine.map(s => <option key={s.id} value={s.id}>{s.station_number}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <input value={f.param_name} onChange={e => setF({ ...f, param_name: e.target.value })} className="input" placeholder="Nazwa parametru *" />
            <input value={f.value_before} onChange={e => setF({ ...f, value_before: e.target.value })} className="input" placeholder="Wartość przed" />
            <input value={f.value_after} onChange={e => setF({ ...f, value_after: e.target.value })} className="input" placeholder="Wartość po *" />
            <input value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} className="input" placeholder="Jednostka" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={f.approved_range} onChange={e => setF({ ...f, approved_range: e.target.value })} className="input" placeholder="Zatwierdzony zakres (np. 2.0–2.5)" />
            <input value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} className="input" placeholder="Powód zmiany" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={f.expected_effect} onChange={e => setF({ ...f, expected_effect: e.target.value })} className="input" placeholder="Oczekiwany efekt" />
            <input value={f.result_after} onChange={e => setF({ ...f, result_after: e.target.value })} className="input" placeholder="Wynik po zmianie" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <input type="number" value={f.test_cycles} onChange={e => setF({ ...f, test_cycles: e.target.value })} className="input" placeholder="Cykle testowe" />
            <input type="number" value={f.test_ok} onChange={e => setF({ ...f, test_ok: e.target.value })} className="input" placeholder="Sztuki OK" />
            <input type="number" value={f.test_nok} onChange={e => setF({ ...f, test_nok: e.target.value })} className="input" placeholder="Sztuki NOK" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="label">Zdjęcie ekranu parametrów</label><input type="file" accept="image/*" capture="environment" onChange={e => setScreenPhoto(e.target.files?.[0] ?? null)} className="text-sm text-navy-400" /></div>
            <div><label className="label">Zdjęcie ustawienia mechanicznego</label><input type="file" accept="image/*" capture="environment" onChange={e => setSettingPhoto(e.target.files?.[0] ?? null)} className="text-sm text-navy-400" /></div>
          </div>
          <textarea value={f.comment} onChange={e => setF({ ...f, comment: e.target.value })} rows={2} className="input resize-none" placeholder="Komentarz Specialist" />
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={f.out_of_range} onChange={e => setF({ ...f, out_of_range: e.target.checked })} className="w-4 h-4 accent-amber-500" />
            <span className="text-sm text-amber-300">Zmiana poza zatwierdzonym zakresem (wymaga powodu i zatwierdzenia Kierownika)</span>
          </label>
          <button onClick={() => { setErrors([]); addMut.mutate() }} disabled={addMut.isPending} className="btn-primary px-5 py-2">{addMut.isPending ? 'Zapisywanie...' : 'Zapisz zmianę parametru'}</button>
        </div>
      )}

      {/* Historia */}
      {isLoading ? <div className="text-navy-400">Ładowanie...</div> : (
        <div className="space-y-2">
          {params.length === 0 && <div className="text-center py-12 text-navy-500">Brak zarejestrowanych zmian parametrów.</div>}
          {params.map(p => (
            <div key={p.id} className={`rounded-xl border p-4 ${p.is_last_good ? 'border-green-500/40 bg-green-500/5' : p.out_of_range ? 'border-amber-500/30 bg-amber-500/5' : 'border-navy-700 bg-navy-800'}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-medium text-white">
                    {p.param_name}: <span className="text-navy-300">{p.value_before ?? '—'}</span> → <span className="text-brand font-bold">{p.value_after}{p.unit ? ` ${p.unit}` : ''}</span>
                  </div>
                  <div className="text-xs text-navy-400 mt-0.5">
                    {new Date(p.created_at).toLocaleString('pl')} · {(p.user as { full_name?: string })?.full_name}
                    {p.approved_range && ` · zakres: ${p.approved_range}`}
                  </div>
                  {p.reason && <div className="text-xs text-navy-500 mt-0.5">Powód: {p.reason}</div>}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {p.is_last_good && <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-300">Ostatnie prawidłowe</span>}
                  {p.out_of_range && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">Poza zakresem</span>}
                  {p.requires_approval && (p.approved_at
                    ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-300">Zatwierdzone</span>
                    : <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-300">Oczekuje zatwierdzenia</span>)}
                </div>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                {(p.screen_photo_url || p.setting_photo_url) && (
                  <>
                    {p.screen_photo_url && <a href={p.screen_photo_url} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">📷 ekran</a>}
                    {p.setting_photo_url && <a href={p.setting_photo_url} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">📷 ustawienie</a>}
                  </>
                )}
                {canApprove && p.requires_approval && !p.approved_at && (
                  <button onClick={() => approveMut.mutate(p)} className="text-xs px-2 py-1 rounded-lg border border-green-500/40 bg-green-500/10 text-green-300">Zatwierdź</button>
                )}
                {canManage && !p.is_last_good && (
                  <button onClick={() => markGoodMut.mutate(p)} className="text-xs px-2 py-1 rounded-lg border border-navy-600 text-navy-300 hover:border-green-500/40">Oznacz jako prawidłowe</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
