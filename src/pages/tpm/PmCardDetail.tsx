import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { notifyUsers, getUserIdsByRole } from '@/lib/tpm'
import { PM_STATUS_LABELS } from '@/types/tpm'
import type { TpmPmCard, TpmPmTemplate, TpmPmResult, AmResult, PmCardStatus } from '@/types/tpm'

async function fetchCard(id: string) {
  const { data } = await supabase
    .from('tpm_pm_cards')
    .select('*, machine:tpm_machines(*), station:tpm_stations(*), performer:profiles!tpm_pm_cards_performer_id_fkey(id, full_name)')
    .eq('id', id).single()
  return data as TpmPmCard | null
}
async function fetchTemplates(stationId: string) {
  const { data } = await supabase.from('tpm_pm_templates').select('*').eq('station_id', stationId).eq('is_active', true).order('sort_order')
  return data as TpmPmTemplate[] ?? []
}
async function fetchResults(cardId: string) {
  const { data } = await supabase.from('tpm_pm_results').select('*').eq('card_id', cardId)
  return data as TpmPmResult[] ?? []
}

export default function TpmPmCardDetail() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const role = profile?.role
  const canManage = ['specialist', 'manager', 'admin'].includes(role ?? '')
  const canApprove = ['manager', 'admin'].includes(role ?? '')

  const { data: card, isLoading } = useQuery({ queryKey: ['tpm_pm_card', id], queryFn: () => fetchCard(id!), enabled: !!id })
  const { data: templates = [] } = useQuery({ queryKey: ['tpm_pm_templates', card?.station_id], queryFn: () => fetchTemplates(card!.station_id), enabled: !!card?.station_id })
  const { data: existingResults = [] } = useQuery({ queryKey: ['tpm_pm_results', id], queryFn: () => fetchResults(id!), enabled: !!id })

  const [results, setResults] = useState<Record<string, { result: AmResult; measurement: string; notes: string }>>({})
  const [form, setForm] = useState<Partial<TpmPmCard>>({})
  const [errors, setErrors] = useState<string[]>([])
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (existingResults.length > 0) {
      const map: Record<string, { result: AmResult; measurement: string; notes: string }> = {}
      for (const r of existingResults) if (r.template_id) map[r.template_id] = { result: r.result, measurement: r.measurement ?? '', notes: r.notes ?? '' }
      setResults(map)
    }
  }, [existingResults.length])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3500) }
  const val = <K extends keyof TpmPmCard>(k: K): TpmPmCard[K] => (form[k] !== undefined ? form[k]! : card![k])
  const setF = <K extends keyof TpmPmCard>(k: K, v: TpmPmCard[K]) => setForm(p => ({ ...p, [k]: v }))
  const setRes = (tid: string, patch: Partial<{ result: AmResult; measurement: string; notes: string }>) =>
    setResults(prev => {
      const base = prev[tid] ?? { result: 'ok' as AmResult, measurement: '', notes: '' }
      return { ...prev, [tid]: { ...base, ...patch } }
    })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tpm_pm_card', id] })
    qc.invalidateQueries({ queryKey: ['tpm_pm_results', id] })
    qc.invalidateQueries({ queryKey: ['tpm_pm_cards'] })
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!card || !profile) return
      // zapis wyników
      await supabase.from('tpm_pm_results').delete().eq('card_id', card.id)
      if (templates.length > 0) {
        await supabase.from('tpm_pm_results').insert(templates.map(t => ({
          card_id: card.id, template_id: t.id, name: t.name,
          result: results[t.id]?.result ?? 'ok',
          measurement: results[t.id]?.measurement || null,
          notes: results[t.id]?.notes || null
        })))
      }
      if (Object.keys(form).length > 0) await supabase.from('tpm_pm_cards').update(form).eq('id', card.id)
    },
    onSuccess: () => { setForm({}); refresh(); flash('Zapisano') },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })

  const completeMut = useMutation({
    mutationFn: async () => {
      if (!card || !profile) return
      const errs: string[] = []
      // wszystkie czynności muszą mieć wynik
      for (const t of templates) if (!results[t.id]?.result) errs.push(`Brak wyniku: ${t.name}`)
      if (errs.length > 0) { setErrors(errs); throw new Error('Walidacja') }

      // zapis wyników
      await supabase.from('tpm_pm_results').delete().eq('card_id', card.id)
      if (templates.length > 0) {
        await supabase.from('tpm_pm_results').insert(templates.map(t => ({
          card_id: card.id, template_id: t.id, name: t.name,
          result: results[t.id]?.result ?? 'ok',
          measurement: results[t.id]?.measurement || null,
          notes: results[t.id]?.notes || null
        })))
      }

      const today = new Date().toISOString().split('T')[0]
      const { error } = await supabase.from('tpm_pm_cards').update({
        ...form,
        actual_date: today,
        performer_id: profile.id,
        end_time: new Date().toISOString(),
        status: 'awaiting_approval'
      }).eq('id', card.id)
      if (error) throw error
      const mgr = await getUserIdsByRole(['manager'])
      await notifyUsers(mgr, `PM do zatwierdzenia: ${card.card_number}`, `${card.station?.station_number} — przegląd wykonany`, card.machine_id)
    },
    onSuccess: () => { setErrors([]); refresh(); flash('Przekazano do zatwierdzenia') },
    onError: (e: Error) => { if (e.message !== 'Walidacja') setErrors([e.message]) }
  })

  const approveMut = useMutation({
    mutationFn: async () => {
      if (!card || !profile) return
      const freq = card.station?.pm_frequency_days ?? 7
      const base = card.actual_date ? new Date(card.actual_date) : new Date()
      base.setDate(base.getDate() + freq)
      const late = card.actual_date && card.actual_date > card.planned_date
      await supabase.from('tpm_pm_cards').update({
        status: 'approved',
        approved_by: profile.id,
        approved_at: new Date().toISOString(),
        next_due_date: base.toISOString().split('T')[0]
      }).eq('id', card.id)
      void late
    },
    onSuccess: () => { refresh(); flash('Karta PM zatwierdzona') }
  })

  const startMut = useMutation({
    mutationFn: async () => {
      if (!card || !profile) return
      await supabase.from('tpm_pm_cards').update({ status: 'in_progress', start_time: new Date().toISOString(), performer_id: profile.id }).eq('id', card.id)
    },
    onSuccess: () => refresh()
  })

  if (isLoading || !card) return <div className="text-navy-400 text-center py-16">Ładowanie...</div>

  const isFinal = card.status === 'approved'
  const readOnly = !canManage || isFinal

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-10">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/tpm/pm')} className="text-navy-400 hover:text-white">←</button>
        <div className="flex-1">
          <div className="font-mono text-lg text-white">{card.card_number}</div>
          <div className="text-xs text-navy-400">{card.machine?.name} · {card.station?.station_number} · plan: {new Date(card.planned_date).toLocaleDateString('pl')}</div>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-navy-700 text-navy-300">{PM_STATUS_LABELS[card.status as PmCardStatus]}</span>
      </div>

      {msg && <div className="rounded-xl border border-brand/30 bg-brand/10 px-4 py-2 text-sm text-brand">{msg}</div>}
      {errors.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-1 max-h-40 overflow-y-auto">
          {errors.map((e, i) => <p key={i} className="text-sm text-red-300">• {e}</p>)}
        </div>
      )}

      {canManage && !isFinal && card.status === 'todo' && (
        <button onClick={() => startMut.mutate()} className="btn-secondary px-5 py-2">Rozpocznij przegląd</button>
      )}

      {/* Czynności */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Czynności przeglądu</div>
        {templates.length === 0 && <p className="text-navy-500 text-sm">Brak zdefiniowanych czynności dla tej stacji.</p>}
        {templates.map(t => {
          const r = results[t.id]
          return (
            <div key={t.id} className="border-t border-navy-700 pt-3 first:border-0 first:pt-0">
              <div className="text-sm text-white mb-2">{t.name}</div>
              <div className="flex gap-2 mb-2">
                {(['ok', 'nok', 'na'] as AmResult[]).map(v => (
                  <button key={v} disabled={readOnly} onClick={() => setRes(t.id, { result: v })}
                    className={`flex-1 rounded-lg py-2 text-sm font-bold border-2 transition-all ${r?.result === v
                      ? (v === 'ok' ? 'border-green-500 bg-green-500/15 text-green-300' : v === 'nok' ? 'border-red-500 bg-red-500/15 text-red-300' : 'border-navy-400 bg-navy-700 text-navy-200')
                      : 'border-navy-600 text-navy-400 hover:border-navy-500'} disabled:opacity-60`}>
                    {v === 'ok' ? 'OK' : v === 'nok' ? 'NOK' : 'N/D'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input disabled={readOnly} value={r?.measurement ?? ''} onChange={e => setRes(t.id, { measurement: e.target.value })} className="input" placeholder="Pomiar / wartość" />
                <input disabled={readOnly} value={r?.notes ?? ''} onChange={e => setRes(t.id, { notes: e.target.value })} className="input" placeholder="Uwagi" />
              </div>
            </div>
          )
        })}
      </div>

      {/* Pola opisowe */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        {([['findings', 'Wykryte nieprawidłowości'], ['actions', 'Wykonane działania'], ['parts_used', 'Wymienione części'], ['recommendations', 'Zalecenia']] as [keyof TpmPmCard, string][]).map(([k, label]) => (
          <div key={k}>
            <label className="label">{label}</label>
            <textarea disabled={readOnly} value={(val(k) as string) ?? ''} onChange={e => setF(k, e.target.value as never)} rows={2} className="input resize-none" />
          </div>
        ))}
      </div>

      {/* Akcje */}
      {canManage && !isFinal && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="btn-secondary px-5 py-2">💾 Zapisz</button>
          {card.status !== 'awaiting_approval' && (
            <button onClick={() => completeMut.mutate()} disabled={completeMut.isPending} className="btn-primary px-5 py-2">Zakończ i przekaż do zatwierdzenia</button>
          )}
          {canApprove && card.status === 'awaiting_approval' && (
            <button onClick={() => approveMut.mutate()} disabled={approveMut.isPending} className="px-5 py-2 rounded-xl bg-green-600 text-white font-bold hover:bg-green-500">Zatwierdź kartę PM</button>
          )}
        </div>
      )}

      {isFinal && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4 text-sm text-green-300">
          Karta zatwierdzona {card.approved_at ? new Date(card.approved_at).toLocaleString('pl') : ''}.
          Następny przegląd: {card.next_due_date ? new Date(card.next_due_date).toLocaleDateString('pl') : '—'}.
        </div>
      )}
    </div>
  )
}
