import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { currentShift, uploadTpmMedia, logIssueHistory, notifyUsers, getUserIdsByRole } from '@/lib/tpm'
import type { TpmMachine, TpmStation, AmResult } from '@/types/tpm'

async function fetchMachines() {
  const { data } = await supabase.from('tpm_machines').select('*').eq('is_active', true).order('sort_order')
  return data as TpmMachine[] ?? []
}

async function fetchStationsWithCheckpoints(machineId: string) {
  const { data } = await supabase
    .from('tpm_stations')
    .select('*, checkpoints:tpm_checkpoints(*)')
    .eq('machine_id', machineId)
    .eq('is_active', true)
    .order('sort_order')
  const stations = (data as TpmStation[] ?? []).map(s => ({
    ...s,
    checkpoints: (s.checkpoints ?? []).filter(c => c.is_active).sort((a, b) => a.sort_order - b.sort_order)
  }))
  return stations
}

interface ResultState {
  result: AmResult | null
  comment: string
  photo: File | null
  createIssue: boolean
}

export default function TpmAmChecklist() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [machineId, setMachineId] = useState('')
  const [shift, setShift] = useState<'I' | 'II' | 'III'>(currentShift())
  const [results, setResults] = useState<Record<string, ResultState>>({})
  const [errors, setErrors] = useState<string[]>([])

  const { data: machines = [] } = useQuery({ queryKey: ['tpm_machines'], queryFn: fetchMachines })
  const { data: stations = [] } = useQuery({
    queryKey: ['tpm_stations_cp', machineId],
    queryFn: () => fetchStationsWithCheckpoints(machineId),
    enabled: !!machineId
  })

  const allCheckpoints = stations.flatMap(s => (s.checkpoints ?? []).map(c => ({ station: s, cp: c })))

  function setResult(cpId: string, patch: Partial<ResultState>) {
    setResults(prev => {
      const base: ResultState = prev[cpId] ?? { result: null, comment: '', photo: null, createIssue: true }
      return { ...prev, [cpId]: { ...base, ...patch } }
    })
  }

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('Brak profilu.')
      const errs: string[] = []
      if (!machineId) errs.push('Wybierz automat.')
      if (allCheckpoints.length === 0) errs.push('Brak punktów kontrolnych dla wybranego automatu.')

      // każdy punkt musi mieć wynik
      for (const { station, cp } of allCheckpoints) {
        const r = results[cp.id]
        if (!r || !r.result) {
          errs.push(`Brak wyniku: ${station.station_number} — ${cp.name}`)
          continue
        }
        if (r.result === 'nok' && !r.comment.trim())
          errs.push(`NOK wymaga komentarza: ${station.station_number} — ${cp.name}`)
      }
      if (errs.length > 0) { setErrors(errs); throw new Error('Walidacja') }

      const okCount = allCheckpoints.filter(({ cp }) => results[cp.id]?.result === 'ok').length
      const nokCount = allCheckpoints.filter(({ cp }) => results[cp.id]?.result === 'nok').length
      const naCount = allCheckpoints.filter(({ cp }) => results[cp.id]?.result === 'na').length

      const now = new Date()
      // start godziny zmiany dla wykrycia "po czasie" — uproszczone: zawsze completed
      const { data: checklist, error: cErr } = await supabase
        .from('tpm_am_checklists')
        .insert({
          machine_id: machineId,
          operator_id: profile.id,
          shift_type: shift,
          checklist_date: now.toISOString().split('T')[0],
          completed_at: now.toISOString(),
          status: 'completed',
          ok_count: okCount, nok_count: nokCount, na_count: naCount
        })
        .select()
        .single()
      if (cErr) throw cErr

      const specialistIds = await getUserIdsByRole(['specialist'])
      const managerIds = await getUserIdsByRole(['manager'])

      // zapis wyników + ewentualne zgłoszenia
      for (const { station, cp } of allCheckpoints) {
        const r = results[cp.id]!
        let photoUrl: string | null = null
        if (r.photo) photoUrl = await uploadTpmMedia(r.photo, 'am')

        let issueId: string | null = null
        if (r.result === 'nok' && r.createIssue) {
          const { data: issue, error: iErr } = await supabase
            .from('tpm_issues')
            .insert({
              machine_id: machineId,
              station_id: station.id,
              reporter_id: profile.id,
              shift_type: shift,
              category: 'nieustalony',
              priority: 'normal',
              status: 'new',
              symptom: `[AM NOK] ${cp.name}: ${r.comment}`,
              problem_time: now.toISOString(),
              operator_action: 'Wykryto podczas checklisty AM'
            })
            .select()
            .single()
          if (iErr) throw iErr
          issueId = issue.id
          await logIssueHistory({ issueId: issue.id, userId: profile.id, action: 'created', newStatus: 'new', comment: 'Utworzone z checklisty AM (NOK)' })
          if (photoUrl) {
            await supabase.from('tpm_media').insert({
              machine_id: machineId, station_id: station.id, issue_id: issue.id,
              url: photoUrl, media_type: 'photo', category: 'failure',
              description: `AM NOK: ${cp.name}`, author_id: profile.id
            })
          }
          await notifyUsers([...specialistIds, ...managerIds],
            `Nowe zgłoszenie z AM: ${station.station_number}`,
            `${cp.name} — ${r.comment}`, machineId)
        }

        await supabase.from('tpm_am_results').insert({
          checklist_id: checklist.id,
          station_id: station.id,
          checkpoint_id: cp.id,
          result: r.result,
          comment: r.comment || null,
          photo_url: photoUrl,
          issue_id: issueId
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tpm_today_checklists'] })
      navigate('/tpm')
    },
    onError: (e: Error) => { if (e.message !== 'Walidacja') setErrors([e.message]) }
  })

  const resultBtn = (cpId: string, value: AmResult, label: string, activeClass: string) => {
    const active = results[cpId]?.result === value
    return (
      <button
        type="button"
        onClick={() => setResult(cpId, { result: value })}
        className={`flex-1 rounded-lg py-2 text-sm font-bold border-2 transition-all ${active ? activeClass : 'border-navy-600 text-navy-400 hover:border-navy-500'}`}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5 py-2">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/tpm')} className="text-navy-400 hover:text-white">←</button>
        <h1 className="text-xl font-bold text-white">Checklista AM</h1>
      </div>

      {errors.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-1 max-h-48 overflow-y-auto">
          {errors.map((e, i) => <p key={i} className="text-sm text-red-300">• {e}</p>)}
        </div>
      )}

      {/* Automat + zmiana */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-2">Automat</div>
          <div className="grid grid-cols-2 gap-3">
            {machines.map(m => (
              <button key={m.id} onClick={() => { setMachineId(m.id); setResults({}); setErrors([]) }}
                className={`rounded-xl border-2 p-4 text-left transition-all ${machineId === m.id ? 'border-brand bg-brand/10 text-brand' : 'border-navy-600 text-white hover:border-navy-500'}`}>
                <div className="font-bold">{m.name}</div>
                <div className="text-xs text-navy-400 font-mono">{m.code}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-2">Zmiana</div>
          <div className="grid grid-cols-3 gap-3">
            {(['I', 'II', 'III'] as const).map(s => (
              <button key={s} onClick={() => setShift(s)}
                className={`rounded-xl border-2 py-3 font-bold transition-all ${shift === s ? 'border-brand bg-brand/10 text-brand' : 'border-navy-600 text-navy-400 hover:border-navy-500'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stacje i punkty */}
      {machineId && stations.map(station => (
        <div key={station.id} className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
          <div className="font-bold text-white">{station.station_number} <span className="text-sm text-navy-400 font-normal">{station.name}</span></div>
          {(station.checkpoints ?? []).map(cp => {
            const r = results[cp.id]
            const isNok = r?.result === 'nok'
            return (
              <div key={cp.id} className="border-t border-navy-700 pt-3 first:border-0 first:pt-0">
                <div className="text-sm text-white mb-2">{cp.name}</div>
                <div className="flex gap-2">
                  {resultBtn(cp.id, 'ok', 'OK', 'border-green-500 bg-green-500/15 text-green-300')}
                  {resultBtn(cp.id, 'nok', 'NOK', 'border-red-500 bg-red-500/15 text-red-300')}
                  {resultBtn(cp.id, 'na', 'Nie dotyczy', 'border-navy-400 bg-navy-700 text-navy-200')}
                </div>
                {isNok && (
                  <div className="mt-3 space-y-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
                    <textarea
                      value={r?.comment ?? ''}
                      onChange={e => setResult(cp.id, { comment: e.target.value })}
                      rows={2}
                      placeholder="Opis problemu (wymagany przy NOK)..."
                      className="w-full bg-navy-900 border border-navy-600 rounded-lg px-3 py-2 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-red-500 resize-none"
                    />
                    <label className="flex items-center gap-2 text-xs text-navy-300">
                      <input type="file" accept="image/*,video/*" capture="environment"
                        onChange={e => setResult(cp.id, { photo: e.target.files?.[0] ?? null })}
                        className="text-xs text-navy-400" />
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={r?.createIssue ?? true}
                        onChange={e => setResult(cp.id, { createIssue: e.target.checked })}
                        className="w-4 h-4 accent-brand" />
                      <span className="text-xs text-navy-300">Utwórz zgłoszenie techniczne</span>
                    </label>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {machineId && (
        <button
          onClick={() => { setErrors([]); submitMut.mutate() }}
          disabled={submitMut.isPending}
          className="w-full py-4 rounded-2xl bg-brand text-navy-900 font-bold text-lg disabled:opacity-40 hover:bg-brand/90 transition-all"
        >
          {submitMut.isPending ? 'Zapisywanie...' : 'Zatwierdź checklistę'}
        </button>
      )}
    </div>
  )
}
