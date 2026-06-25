import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { currentShift, uploadTpmMedia, logIssueHistory, notifyUsers, getUserIdsByRole } from '@/lib/tpm'
import { ISSUE_CATEGORIES, ISSUE_CATEGORY_LABELS, PRIORITY_LABELS } from '@/types/tpm'
import type { TpmMachine, TpmStation, IssuePriority } from '@/types/tpm'

async function fetchMachines() {
  const { data } = await supabase.from('tpm_machines').select('*').eq('is_active', true).order('sort_order')
  return data as TpmMachine[] ?? []
}
async function fetchStations(machineId: string) {
  const { data } = await supabase.from('tpm_stations').select('*').eq('machine_id', machineId).eq('is_active', true).order('sort_order')
  return data as TpmStation[] ?? []
}

export default function TpmReportIssue() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()

  const [machineId, setMachineId] = useState('')
  const [stationId, setStationId] = useState('')
  const [component, setComponent] = useState('')
  const [category, setCategory] = useState('nieustalony')
  const [categoryOther, setCategoryOther] = useState('')
  const [priority, setPriority] = useState<IssuePriority>('normal')
  const [symptom, setSymptom] = useState('')
  const [operatorAction, setOperatorAction] = useState('')
  const [problemTime, setProblemTime] = useState('')
  const [stopTime, setStopTime] = useState('')
  const [machineStopped, setMachineStopped] = useState(false)
  const [productionResumed, setProductionResumed] = useState(false)
  const [postResumeCheck, setPostResumeCheck] = useState(false)
  const [photos, setPhotos] = useState<File[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [createdNumber, setCreatedNumber] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const { data: machines = [] } = useQuery({ queryKey: ['tpm_machines'], queryFn: fetchMachines })
  const { data: stations = [] } = useQuery({
    queryKey: ['tpm_stations', machineId],
    queryFn: () => fetchStations(machineId),
    enabled: !!machineId
  })

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('Brak profilu.')
      const errs: string[] = []
      if (!machineId) errs.push('Wybierz automat.')
      if (!stationId) errs.push('Wybierz stację.')
      if (!symptom.trim()) errs.push('Opisz objaw problemu.')
      if (category === 'inne' && !categoryOther.trim()) errs.push('Podaj własny opis kategorii „inne”.')
      if (errs.length > 0) { setErrors(errs); throw new Error('Walidacja') }

      const today = new Date().toISOString().split('T')[0]
      const toTs = (t: string) => t ? new Date(`${today}T${t}`).toISOString() : null

      const { data: issue, error } = await supabase
        .from('tpm_issues')
        .insert({
          machine_id: machineId,
          station_id: stationId,
          component: component || null,
          reporter_id: profile.id,
          shift_type: currentShift(),
          category,
          category_other: category === 'inne' ? categoryOther : null,
          priority,
          status: 'new',
          symptom,
          operator_action: operatorAction || null,
          problem_time: toTs(problemTime),
          stop_time: toTs(stopTime),
          machine_stopped: machineStopped,
          production_resumed: productionResumed,
          post_resume_check: postResumeCheck
        })
        .select()
        .single()
      if (error) throw error

      await logIssueHistory({ issueId: issue.id, userId: profile.id, action: 'created', newStatus: 'new', comment: 'Zgłoszenie utworzone przez Operatora' })

      // upload zdjęć
      for (const file of photos) {
        const url = await uploadTpmMedia(file, 'issue')
        if (url) {
          await supabase.from('tpm_media').insert({
            machine_id: machineId, station_id: stationId, issue_id: issue.id,
            url, media_type: file.type.startsWith('video') ? 'video' : 'photo',
            category: 'failure', description: 'Zgłoszenie operatora', author_id: profile.id
          })
        }
      }

      // powiadomienia
      const specialistIds = await getUserIdsByRole(['specialist'])
      const managerIds = priority === 'critical' ? await getUserIdsByRole(['manager']) : []
      await notifyUsers([...specialistIds, ...managerIds],
        `${priority === 'critical' ? '🔴 KRYTYCZNE — ' : ''}Nowe zgłoszenie ${issue.issue_number}`,
        `${symptom.slice(0, 80)}`, machineId)

      return issue.issue_number as string
    },
    onSuccess: (num) => setCreatedNumber(num),
    onError: (e: Error) => { if (e.message !== 'Walidacja') setErrors([e.message]) },
    onSettled: () => setSubmitting(false)
  })

  if (createdNumber) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-4">
        <div className="text-5xl">✓</div>
        <h2 className="text-xl font-bold text-white">Zgłoszenie utworzone</h2>
        <div className="font-mono text-lg text-brand">{createdNumber}</div>
        <p className="text-navy-400 text-sm">Zgłoszenie zostało przekazane do działu technicznego (Specialist).</p>
        <div className="flex gap-3 justify-center">
          <button onClick={() => navigate('/tpm')} className="btn-primary px-6 py-3">Pulpit</button>
          <button onClick={() => navigate('/tpm/my-issues')} className="btn-secondary px-6 py-3">Moje zgłoszenia</button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5 py-2">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/tpm')} className="text-navy-400 hover:text-white">←</button>
        <h1 className="text-xl font-bold text-white">Zgłoszenie awarii</h1>
      </div>

      {errors.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-1">
          {errors.map((e, i) => <p key={i} className="text-sm text-red-300">• {e}</p>)}
        </div>
      )}

      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
        <div>
          <label className="label">Automat *</label>
          <div className="grid grid-cols-2 gap-3">
            {machines.map(m => (
              <button key={m.id} onClick={() => { setMachineId(m.id); setStationId('') }}
                className={`rounded-xl border-2 p-3 text-left ${machineId === m.id ? 'border-brand bg-brand/10 text-brand' : 'border-navy-600 text-white hover:border-navy-500'}`}>
                <span className="font-bold">{m.name}</span> <span className="text-xs font-mono text-navy-400">{m.code}</span>
              </button>
            ))}
          </div>
        </div>

        {machineId && (
          <div>
            <label className="label">Stacja *</label>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {stations.map(s => (
                <button key={s.id} onClick={() => setStationId(s.id)}
                  className={`rounded-lg border-2 py-2 text-sm font-bold ${stationId === s.id ? 'border-brand bg-brand/10 text-brand' : 'border-navy-600 text-navy-300 hover:border-navy-500'}`}>
                  {s.station_number}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="label">Podzespół</label>
          <input value={component} onChange={e => setComponent(e.target.value)} className="input" placeholder="np. chwytak, czujnik pozycji..." />
        </div>
      </div>

      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
        <div>
          <label className="label">Opis objawu *</label>
          <textarea value={symptom} onChange={e => setSymptom(e.target.value)} rows={3} className="input resize-none" placeholder="Co się dzieje? Jaki jest efekt?" />
        </div>
        <div>
          <label className="label">Wykonane czynności (Operator)</label>
          <textarea value={operatorAction} onChange={e => setOperatorAction(e.target.value)} rows={2} className="input resize-none" placeholder="Co zostało zrobione?" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Kategoria</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className="input">
              {ISSUE_CATEGORIES.map(c => <option key={c} value={c}>{ISSUE_CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Priorytet</label>
            <select value={priority} onChange={e => setPriority(e.target.value as IssuePriority)} className="input">
              {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        {category === 'inne' && (
          <input value={categoryOther} onChange={e => setCategoryOther(e.target.value)} className="input" placeholder="Własny opis kategorii (wymagany)" />
        )}
      </div>

      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Godzina wystąpienia</label>
            <input type="time" value={problemTime} onChange={e => setProblemTime(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Godzina zatrzymania automatu</label>
            <input type="time" value={stopTime} onChange={e => setStopTime(e.target.value)} className="input" />
          </div>
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={machineStopped} onChange={e => setMachineStopped(e.target.checked)} className="w-5 h-5 accent-brand" />
            <span className="text-sm text-navy-300">Automat został zatrzymany</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={productionResumed} onChange={e => setProductionResumed(e.target.checked)} className="w-5 h-5 accent-brand" />
            <span className="text-sm text-navy-300">Produkcja została wznowiona</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={postResumeCheck} onChange={e => setPostResumeCheck(e.target.checked)} className="w-5 h-5 accent-brand" />
            <span className="text-sm text-navy-300">Potwierdzam kontrolę po wznowieniu produkcji</span>
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <label className="label">Zdjęcia / filmy</label>
        <input type="file" accept="image/*,video/*" capture="environment" multiple
          onChange={e => setPhotos(Array.from(e.target.files ?? []).slice(0, 5))}
          className="text-sm text-navy-400" />
        {photos.length > 0 && <p className="text-xs text-navy-500">{photos.length} plik(ów) gotowych do wysłania</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/tpm')} className="btn-secondary py-4">Anuluj</button>
        <button
          onClick={() => { setErrors([]); setSubmitting(true); submitMut.mutate() }}
          disabled={submitting}
          className="py-4 rounded-2xl bg-red-600 text-white font-bold text-lg disabled:opacity-40 hover:bg-red-500 transition-all"
        >
          {submitting ? 'Wysyłanie...' : 'Wyślij zgłoszenie'}
        </button>
      </div>
    </div>
  )
}
