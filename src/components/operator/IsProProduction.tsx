import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useIsProProduction } from '@/hooks/useIsProProduction'
import type { HourlyReport, Shift } from '@/types/database'
import { getShiftStartAt, getShiftEndAt } from '@/lib/utils'
import { overlapMilliseconds } from '@/lib/isProProduction'

const duration = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
const time = (date: string) => new Date(date).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' })

export default function IsProProduction({ shift, reports, readOnly = false }: { shift: Shift; reports: HourlyReport[]; readOnly?: boolean }) {
  const { segments, changeovers, active, changeover, error: loadError, loading, reload } = useIsProProduction(shift.id, shift.machine_id, shift.started_at)
  const [assortments, setAssortments] = useState<{ id: string; name: string }[]>([])
  const [assortment, setAssortment] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [good, setGood] = useState('')
  const [reject, setReject] = useState('')
  const [reset, setReset] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!readOnly && !shift.ended_at) supabase.from('assortments').select('id,name').eq('is_active', true).order('sort_order')
      .then(({ data, error }) => { if (error) setError('Nie udało się wczytać listy asortymentów.'); else setAssortments(data ?? []) })
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [shift.id, shift.ended_at, readOnly])
  useEffect(() => { setConfirm(false); setGood(''); setReject(''); setReset(false) }, [active?.id])
  const writable = !readOnly && !shift.ended_at
  const segmentReports = reports.filter(r => r.segment_id === active?.id)
  const currentGood = segmentReports.reduce((n, r) => n + r.good_count, 0)
  const currentReject = segmentReports.reduce((n, r) => n + r.reject_count, 0)
  const command = async (action: 'start' | 'changeover') => {
    setError('')
    if (action === 'changeover' && (!/^\d+$/.test(good) || !/^\d+$/.test(reject) || Number(good) < currentGood || Number(reject) < currentReject)) {
      setError('Wpisz oba końcowe liczniki. Nie mogą być mniejsze od zapisanych wyników.'); return
    }
    if (action === 'start' && (!assortment || !reset)) { setError('Wybierz asortyment i potwierdź wyzerowanie liczników sztuk.'); return }
    setBusy(true)
    try {
      const { error } = await supabase.rpc('is_pro_command', { p_shift: shift.id, p_action: action,
        p_segment: active?.id ?? null, p_assortment: assortment || null,
        p_good: action === 'changeover' ? Number(good) : null, p_reject: action === 'changeover' ? Number(reject) : null })
      if (error) { setError(error.message); return }
      setConfirm(false); setReset(false); setAssortment('')
      await reload()
      window.dispatchEvent(new Event('is-pro-updated'))
    } catch { setError('Nie udało się zapisać. Sprawdź połączenie i spróbuj ponownie.') }
    finally { setBusy(false) }
  }
  const start = Math.max(new Date(shift.started_at).getTime(), getShiftStartAt(shift.shift_date, shift.shift_type).getTime())
  const end = Math.min(shift.ended_at ? new Date(shift.ended_at).getTime() : now, getShiftEndAt(shift.shift_date, shift.shift_type).getTime())
  const events = changeovers.filter(c => new Date(c.started_at).getTime() < end && (!c.ended_at || new Date(c.ended_at).getTime() > start))
  const overlap = (c: typeof changeover) => c ? overlapMilliseconds(new Date(c.started_at).getTime(), c.ended_at ? new Date(c.ended_at).getTime() : now, start, end) : 0
  if (loading) return <div className="card p-4 mb-4 text-navy-300">Wczytywanie asortymentu…</div>
  if (loadError) return <div role="alert" className="card p-4 mb-4 text-amber-300">{loadError}</div>
  const legacy = !segments.length && reports.length > 0
  return <section className="card p-4 mb-4 space-y-4" aria-label="Asortyment i przezbrojenie">
    <div>
      <div className="text-sm text-navy-400">{changeover && writable ? 'Przezbrojenie w toku' : 'Asortyment'}</div>
      <div className="text-xl font-bold text-white">{active?.assortment?.name ?? (changeover && writable ? `Czas: ${duration(now - new Date(changeover.started_at).getTime())}` : legacy ? 'Wyniki historyczne bez podziału' : 'Wybierz asortyment na początek produkcji')}</div>
    </div>
    {writable && !legacy && (active ? <>
      {!confirm ? <button className="btn-secondary w-full" onClick={() => { setConfirm(true); setGood(String(currentGood)); setReject(String(currentReject)) }}>Rozpocznij przezbrojenie</button> : <div className="space-y-3">
        <p className="text-sm text-navy-300">Wpisz końcowy stan przed wyzerowaniem liczników.</p>
        <label className="block text-sm text-white">Dobre sztuki — licznik końcowy<input className="input mt-1" type="number" min={currentGood} step="1" value={good} onChange={e => setGood(e.target.value)} /></label>
        <label className="block text-sm text-white">Odrzut — licznik końcowy<input className="input mt-1" type="number" min={currentReject} step="1" value={reject} onChange={e => setReject(e.target.value)} /></label>
        <button disabled={busy} className="btn-primary w-full" onClick={() => void command('changeover')}>{busy ? 'Zapisywanie…' : 'Zapisz wynik i rozpocznij przezbrojenie'}</button>
        <button disabled={busy} className="btn-secondary w-full" onClick={() => setConfirm(false)}>Anuluj</button>
      </div>}
    </> : <div className="space-y-3">
      <label className="block text-sm text-white">{changeover ? 'Nowy asortyment' : 'Asortyment'}<select className="input mt-1" value={assortment} onChange={e => setAssortment(e.target.value)}><option value="">Wybierz asortyment…</option>{assortments.filter(a => !segments.some(s => s.assortment_id === a.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="flex items-center gap-2 text-sm text-navy-300"><input type="checkbox" checked={reset} onChange={e => setReset(e.target.checked)} />Liczniki dobrych sztuk i odrzutu są wyzerowane</label>
      <button disabled={busy || !assortment || !reset} className="btn-primary w-full" onClick={() => void command('start')}>{busy ? 'Zapisywanie…' : 'Rozpocznij produkcję'}</button>
    </div>)}
    {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
    {segments.length > 0 && <div>
      <div className="text-sm font-bold text-white mb-2">Produkcja na tej zmianie</div>
      <table className="w-full text-sm"><thead className="text-navy-400"><tr><th className="text-left">Asortyment</th><th className="text-right">Dobre szt.</th><th className="text-right">Odrzut</th></tr></thead><tbody>{segments.map(s => <tr key={s.id} className="text-white"><td className="py-2">{s.assortment?.name}{!s.ended_at && ' · teraz'}</td><td className="text-right">{(s.final_good ?? reports.filter(r => r.segment_id === s.id).reduce((n, r) => n + r.good_count, 0)).toLocaleString('pl-PL')}</td><td className="text-right">{(s.final_reject ?? reports.filter(r => r.segment_id === s.id).reduce((n, r) => n + r.reject_count, 0)).toLocaleString('pl-PL')}</td></tr>)}</tbody><tfoot className="text-white font-bold"><tr><td>Razem</td><td className="text-right">{reports.reduce((n, r) => n + r.good_count, 0).toLocaleString('pl-PL')}</td><td className="text-right">{reports.reduce((n, r) => n + r.reject_count, 0).toLocaleString('pl-PL')}</td></tr></tfoot></table>
    </div>}
    {events.length > 0 && <div className="text-sm text-amber-300">Przezbrojenia na tej zmianie: <strong>{duration(events.reduce((n, c) => n + overlap(c), 0))}</strong>{events.map(c => <div key={c.id} className="text-navy-300 mt-1">{time(c.started_at)}–{c.ended_at ? time(c.ended_at) : 'w toku'} · na tej zmianie {duration(overlap(c))}</div>)}</div>}
  </section>
}
