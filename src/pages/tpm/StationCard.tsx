import { useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ISSUE_STATUS_LABELS, ISSUE_CATEGORY_LABELS, PM_STATUS_LABELS } from '@/types/tpm'
import type {
  TpmStation, TpmCheckpoint, TpmIssue, AmResultRow, TpmPmCard,
  TpmParameter, TpmMedia, TpmPart, IssueStatus, PmCardStatus
} from '@/types/tpm'

const OPEN_STATUSES = ['new','awaiting_ack','accepted','diagnosing','immediate_done','repairing','awaiting_part','awaiting_manager','observation','testing','escalated_a1tec','resolved','awaiting_approval','reopened']

async function fetchStationBundle(stationId: string) {
  const { data: station } = await supabase
    .from('tpm_stations').select('*, machine:tpm_machines(*)').eq('id', stationId).single()
  if (!station) return null
  const [checkpoints, issues, amResults, pmCards, params, media, parts] = await Promise.all([
    supabase.from('tpm_checkpoints').select('*').eq('station_id', stationId).order('sort_order'),
    supabase.from('tpm_issues').select('*, reporter:profiles!tpm_issues_reporter_id_fkey(id, full_name)').eq('station_id', stationId).order('report_time', { ascending: false }),
    supabase.from('tpm_am_results').select('*').eq('station_id', stationId).order('created_at', { ascending: false }).limit(100),
    supabase.from('tpm_pm_cards').select('*').eq('station_id', stationId).order('planned_date', { ascending: false }),
    supabase.from('tpm_parameters').select('*, user:profiles(id, full_name)').eq('station_id', stationId).order('created_at', { ascending: false }),
    supabase.from('tpm_media').select('*').eq('station_id', stationId).is('deleted_at', null).order('created_at', { ascending: false }),
    supabase.from('tpm_parts').select('*').eq('station_id', stationId).eq('is_active', true)
  ])
  return {
    station: station as TpmStation,
    checkpoints: (checkpoints.data ?? []) as TpmCheckpoint[],
    issues: (issues.data ?? []) as TpmIssue[],
    amResults: (amResults.data ?? []) as AmResultRow[],
    pmCards: (pmCards.data ?? []) as TpmPmCard[],
    params: (params.data ?? []) as TpmParameter[],
    media: (media.data ?? []) as TpmMedia[],
    parts: (parts.data ?? []) as TpmPart[]
  }
}

function fmtDate(ts?: string | null) {
  return ts ? new Date(ts).toLocaleDateString('pl') : '—'
}

const RISK_COLOR: Record<string, string> = {
  low: 'text-green-400', medium: 'text-yellow-400', high: 'text-orange-400', critical: 'text-red-400'
}

export default function TpmStationCard() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({ queryKey: ['tpm_station_card', id], queryFn: () => fetchStationBundle(id!), enabled: !!id })

  const kpi = useMemo(() => {
    if (!data) return null
    const { issues, pmCards } = data
    const open = issues.filter(i => OPEN_STATUSES.includes(i.status))
    const totalDowntime = issues.reduce((s, i) => s + (i.downtime_min ?? 0), 0)
    const totalNok = issues.reduce((s, i) => s + (i.nok_count ?? 0), 0)
    const a1tec = issues.filter(i => i.a1tec_escalated).length
    const recurring = issues.some(i => i.is_recurring)

    // MTTR — średni czas naprawy
    const repaired = issues.filter(i => i.intervention_start && i.intervention_end)
    const mttr = repaired.length > 0
      ? Math.round(repaired.reduce((s, i) => s + (new Date(i.intervention_end!).getTime() - new Date(i.intervention_start!).getTime()) / 60000, 0) / repaired.length)
      : 0

    // MTBF — średni odstęp między awariami (dni)
    const times = issues.map(i => new Date(i.report_time).getTime()).sort((a, b) => a - b)
    let mtbf = 0
    if (times.length >= 2) {
      let sum = 0
      for (let k = 1; k < times.length; k++) sum += times[k] - times[k - 1]
      mtbf = Math.round(sum / (times.length - 1) / 864e5 * 10) / 10
    }

    // częstotliwość — awarie / 30 dni
    const last30 = issues.filter(i => new Date(i.report_time).getTime() >= Date.now() - 30 * 864e5).length

    // ostatnia prawidłowa wartość / ostatni zatwierdzony PM
    const lastApprovedPm = pmCards.find(p => p.status === 'approved')

    return { failures: issues.length, open: open.length, totalDowntime, totalNok, a1tec, recurring, mttr, mtbf, last30, lastApprovedPm }
  }, [data])

  if (isLoading || !data || !kpi) return <div className="text-navy-400 text-center py-16">Ładowanie...</div>

  const { station, checkpoints, issues, amResults, pmCards, params, media, parts } = data
  const openIssues = issues.filter(i => OPEN_STATUSES.includes(i.status))
  const closedIssues = issues.filter(i => i.status === 'closed')
  const lastGoodParams = params.filter(p => p.is_last_good)
  const nokAm = amResults.filter(a => a.result === 'nok')

  return (
    <div className="max-w-4xl mx-auto space-y-4 pb-10">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-navy-400 hover:text-white">←</button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">{station.station_number} — {station.name}</h1>
          <p className="text-navy-400 text-sm">{station.machine?.name} ({station.machine?.code})</p>
        </div>
        <span className={`text-sm font-bold ${RISK_COLOR[station.risk_level]}`}>ryzyko: {station.risk_level}</span>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { l: 'Awarie łącznie', v: kpi.failures },
          { l: 'Otwarte', v: kpi.open, c: kpi.open ? 'text-amber-400' : 'text-white' },
          { l: 'Czas postoju', v: `${kpi.totalDowntime} min` },
          { l: 'Sztuki NOK', v: kpi.totalNok },
          { l: 'MTTR', v: `${kpi.mttr} min` },
          { l: 'MTBF', v: kpi.mtbf ? `${kpi.mtbf} dni` : '—' },
          { l: 'Awarie / 30 dni', v: kpi.last30 },
          { l: 'Do A1TEC', v: kpi.a1tec, c: kpi.a1tec ? 'text-cyan-400' : 'text-white' },
        ].map(t => (
          <div key={t.l} className="rounded-xl border border-navy-700 bg-navy-800 p-4">
            <div className="text-xs text-navy-400 uppercase tracking-wider">{t.l}</div>
            <div className={`text-2xl font-bold mt-1 ${t.c ?? 'text-white'}`}>{t.v}</div>
          </div>
        ))}
      </div>

      {kpi.recurring && (
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4 text-sm text-purple-300">
          Stacja oznaczona jako generująca problemy powtarzalne — rozważ przekazanie do A1TEC.
        </div>
      )}

      {/* Opis i ustawienia bazowe */}
      <Card title="Opis i stan bazowy">
        <Field label="Opis działania stacji" value={station.function_desc} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Standardowe ustawienia" value={station.standard_settings} />
          <Field label="Dopuszczalne zakresy parametrów" value={station.param_ranges} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Instrukcja kontroli" value={station.control_instruction} />
          <Field label="Instrukcja techniczna" value={station.tech_instruction} />
        </div>
        <Field label="Częstotliwość PM" value={`co ${station.pm_frequency_days} dni`} />
        {station.base_photo_url && (
          <div>
            <div className="text-xs text-navy-500 mb-1">Zdjęcie stanu bazowego</div>
            <a href={station.base_photo_url} target="_blank" rel="noreferrer">
              <img src={station.base_photo_url} alt="stan bazowy" className="rounded-lg border border-navy-700 max-h-48" />
            </a>
          </div>
        )}
        {kpi.lastApprovedPm && (
          <div className="text-xs text-green-400">Ostatni zatwierdzony przegląd PM: {kpi.lastApprovedPm.card_number} ({fmtDate(kpi.lastApprovedPm.actual_date)})</div>
        )}
      </Card>

      {/* Ostatnie prawidłowe parametry */}
      {lastGoodParams.length > 0 && (
        <Card title="Ostatnie prawidłowe ustawienia">
          <div className="space-y-1">
            {lastGoodParams.map(p => (
              <div key={p.id} className="flex justify-between text-sm border-b border-navy-700 last:border-0 py-1.5">
                <span className="text-navy-300">{p.param_name}</span>
                <span className="text-green-400 font-bold">{p.value_after}{p.unit ? ` ${p.unit}` : ''}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Punkty kontrolne AM */}
      <Card title={`Punkty kontrolne AM (${checkpoints.filter(c => c.is_active).length})`}>
        <div className="flex flex-wrap gap-2">
          {checkpoints.filter(c => c.is_active).map(c => (
            <span key={c.id} className="text-xs px-2.5 py-1 rounded-full bg-navy-700 text-navy-300">{c.name}</span>
          ))}
        </div>
      </Card>

      {/* Otwarte zgłoszenia */}
      <Card title={`Otwarte zgłoszenia (${openIssues.length})`}>
        {openIssues.length === 0 ? <Empty /> : openIssues.map(i => <IssueRow key={i.id} i={i} onClick={() => navigate(`/tpm/issue/${i.id}`)} />)}
      </Card>

      {/* Historia awarii (zamknięte) */}
      <Card title={`Historia awarii — zamknięte (${closedIssues.length})`}>
        {closedIssues.length === 0 ? <Empty /> : closedIssues.slice(0, 20).map(i => <IssueRow key={i.id} i={i} onClick={() => navigate(`/tpm/issue/${i.id}`)} />)}
      </Card>

      {/* Historia PM */}
      <Card title={`Przeglądy PM (${pmCards.length})`}>
        {pmCards.length === 0 ? <Empty /> : pmCards.slice(0, 15).map(p => (
          <button key={p.id} onClick={() => navigate(`/tpm/pm/${p.id}`)} className="w-full flex items-center justify-between py-2 border-b border-navy-700 last:border-0 text-left hover:bg-navy-700/30 px-2 -mx-2 rounded">
            <span className="font-mono text-sm text-white">{p.card_number}</span>
            <span className="text-xs text-navy-400">{fmtDate(p.actual_date || p.planned_date)} · {PM_STATUS_LABELS[p.status as PmCardStatus]}</span>
          </button>
        ))}
      </Card>

      {/* Historia parametrów */}
      <Card title={`Zmiany parametrów (${params.length})`}>
        {params.length === 0 ? <Empty /> : params.slice(0, 15).map(p => (
          <div key={p.id} className="flex items-center justify-between py-2 border-b border-navy-700 last:border-0 text-sm">
            <div>
              <span className="text-white">{p.param_name}: </span>
              <span className="text-navy-400">{p.value_before ?? '—'} → </span>
              <span className="text-brand font-bold">{p.value_after}{p.unit ? ` ${p.unit}` : ''}</span>
            </div>
            <span className="text-xs text-navy-500">{fmtDate(p.created_at)}</span>
          </div>
        ))}
      </Card>

      {/* Checklisty AM — NOK */}
      <Card title={`Wyniki AM — NOK (${nokAm.length})`}>
        {nokAm.length === 0 ? <Empty /> : nokAm.slice(0, 15).map(a => (
          <div key={a.id} className="py-2 border-b border-navy-700 last:border-0 text-sm">
            <div className="text-white">{a.comment || '—'}</div>
            <div className="text-xs text-navy-500">{fmtDate(a.created_at)}</div>
          </div>
        ))}
      </Card>

      {/* Części krytyczne */}
      {parts.length > 0 && (
        <Card title={`Części krytyczne (${parts.length})`}>
          {parts.map(p => (
            <div key={p.id} className="flex justify-between py-1.5 border-b border-navy-700 last:border-0 text-sm">
              <span className="text-white">{p.name}</span>
              <span className="text-navy-400">{p.current_stock} {p.unit} · {p.status}</span>
            </div>
          ))}
        </Card>
      )}

      {/* Media */}
      {media.length > 0 && (
        <Card title={`Zdjęcia i filmy (${media.length})`}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {media.slice(0, 12).map(m => (
              <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-navy-700">
                {m.media_type === 'video'
                  ? <div className="aspect-video bg-navy-900 flex items-center justify-center text-navy-400 text-xs">🎬</div>
                  : <img src={m.url} alt="" className="aspect-video object-cover w-full" />}
              </a>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5">
      <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-3">{title}</div>
      {children}
    </div>
  )
}
function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="mb-2">
      <div className="text-xs text-navy-500">{label}</div>
      <div className="text-sm text-white whitespace-pre-wrap">{value || '—'}</div>
    </div>
  )
}
function Empty() { return <p className="text-navy-500 text-sm">Brak wpisów.</p> }

function IssueRow({ i, onClick }: { i: TpmIssue; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center justify-between py-2 border-b border-navy-700 last:border-0 text-left hover:bg-navy-700/30 px-2 -mx-2 rounded">
      <div className="min-w-0">
        <span className="font-mono text-sm text-white">{i.issue_number}</span>
        <span className="text-xs text-navy-400 ml-2">{ISSUE_CATEGORY_LABELS[i.category] ?? i.category}</span>
        <div className="text-xs text-navy-500 truncate">{i.symptom}</div>
      </div>
      <span className="text-xs px-2 py-0.5 rounded-full bg-navy-700 text-navy-300 shrink-0">{ISSUE_STATUS_LABELS[i.status as IssueStatus]}</span>
    </button>
  )
}
