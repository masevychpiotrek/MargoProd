import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { cn, efficiencyColor, formatLocalDateISO } from '@/lib/utils'
import type { FailureReport, FailureSeverity, FailureStatus, HourlyReport, Machine, Profile, ShiftType } from '@/types/database'

const SEV_CFG: Record<FailureSeverity, { label: string; cls: string; dot: string; rank: number }> = {
  low: { label: 'Niska', cls: 'bg-green-500/15 text-green-400 border-green-500/30', dot: 'bg-green-400', rank: 1 },
  medium: { label: 'Srednia', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', dot: 'bg-amber-400', rank: 2 },
  high: { label: 'Wysoka', cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30', dot: 'bg-orange-400', rank: 3 },
  critical: { label: 'Krytyczna', cls: 'bg-red-500/15 text-red-400 border-red-500/30', dot: 'bg-red-400 animate-pulse', rank: 4 },
}

const STATUS_CFG: Record<FailureStatus, { label: string; cls: string }> = {
  new: { label: 'Nowe', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  acknowledged: { label: 'Przyjeto', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  in_progress: { label: 'W trakcie', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  unresolved: { label: 'Nierozwiazane', cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  resolved: { label: 'Rozwiazano', cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
}

const CAT_LABELS: Record<string, string> = {
  mechanical_failure: 'Awaria mechaniczna',
  electrical_failure: 'Awaria elektryczna',
  quality_control: 'Problem jakosciowy',
  material_shortage: 'Brak materialu',
  process_issue: 'Problem procesu',
  logistics_issue: 'Problem logistyczny',
  changeover: 'Przezbrojenie',
  cleaning: 'Czyszczenie',
  no_operator: 'Brak operatora',
  other: 'Inne',
}

type FilterStatus = 'all' | FailureStatus
type ViewMode = 'awarie' | 'zadania' | 'produkcja' | 'tpm' | 'historia'
type ExpandedReport = { id: string; notes: string; saving: boolean }
type FailureRow = FailureReport & {
  machine?: Pick<Machine, 'id' | 'name' | 'code'> | null
  reporter?: Pick<Profile, 'id' | 'full_name'> | null
  assignee?: Pick<Profile, 'id' | 'full_name'> | null
}
type ProductionIssue = HourlyReport & {
  reject_reason?: string | null
  machine?: Pick<Machine, 'id' | 'name' | 'code' | 'target_per_hour'> | null
  operator?: Pick<Profile, 'id' | 'full_name'> | null
  shift?: { shift_type: ShiftType; shift_date: string } | null
}

function ageMinutes(date: string) {
  return Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000))
}

function minutesLabel(value: number) {
  if (value < 60) return `${value} min`
  const h = Math.floor(value / 60)
  const m = value % 60
  return m ? `${h}h ${m}min` : `${h}h`
}

function rejectPct(report: Pick<HourlyReport, 'good_count' | 'reject_count'>) {
  const total = report.good_count + report.reject_count
  return total > 0 ? Math.round(report.reject_count / total * 100) : 0
}

function issueTone(issue: ProductionIssue) {
  const reject = rejectPct(issue)
  if (reject > 10 || issue.efficiency_pct < 60) return 'red'
  if (reject > 5 || issue.efficiency_pct < 80) return 'amber'
  return 'green'
}

function toneClasses(tone: string) {
  if (tone === 'red') return 'border-red-500/35 bg-red-500/5'
  if (tone === 'amber') return 'border-amber-500/35 bg-amber-500/5'
  return 'border-green-500/30 bg-green-500/5'
}

export default function SpecialistDashboard() {
  const { profile } = useAuthStore()
  const readOnly = profile?.role === 'manager' || profile?.role === 'viewer'
  const canSeeAllHistory = profile?.role === 'manager' || profile?.role === 'admin' || profile?.role === 'viewer'
  const [reports, setReports] = useState<FailureRow[]>([])
  const [issues, setIssues] = useState<ProductionIssue[]>([])
  const [machines, setMachines] = useState<Machine[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [view, setView] = useState<ViewMode>('awarie')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [editNotes, setEditNotes] = useState<Record<string, ExpandedReport>>({})
  const [photoModal, setPhotoModal] = useState<string | null>(null)
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    const today = formatLocalDateISO()
    const [failureRes, issueRes, machineRes] = await Promise.all([
      supabase
        .from('failure_reports')
        .select(`
          *,
          machine:machines!machine_id(id, name, code),
          reporter:profiles!reporter_id(id, full_name),
          assignee:profiles!assigned_to(id, full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('hourly_reports')
        .select(`
          *,
          machine:machines!machine_id(id, name, code, target_per_hour),
          operator:profiles!operator_id(id, full_name),
          shift:shifts!shift_id(shift_type, shift_date)
        `)
        .eq('report_date', today)
        .is('deleted_at', null)
        .order('submitted_at', { ascending: false })
        .limit(150),
      supabase.from('machines').select('*').eq('is_active', true).order('code')
    ])

    if (seq !== loadSeq.current) return
    if (!failureRes.error) setReports((failureRes.data ?? []) as FailureRow[])
    if (!issueRes.error) {
      const rows = ((issueRes.data ?? []) as ProductionIssue[]).filter(r =>
        r.efficiency_pct < 80 || rejectPct(r) > 5 || r.downtime_reason || r.reject_reason
      )
      setIssues(rows)
    }
    if (!machineRes.error) setMachines((machineRes.data ?? []) as Machine[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const channel = supabase
      .channel('specialist-control-room')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'failure_reports' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_reports' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'machines' }, load)
      .subscribe()

    const onFocus = () => load()
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    const fallback = window.setInterval(load, 60000)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)

    return () => {
      window.clearInterval(fallback)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
      supabase.removeChannel(channel)
    }
  }, [load])

  useEffect(() => {
    if (!profile?.id || readOnly) return
    supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', profile.id)
      .eq('type', 'failure_report')
      .eq('is_read', false)
      .then(() => undefined)
  }, [profile?.id, readOnly])

  async function updateStatus(id: string, status: FailureStatus) {
    if (readOnly) return
    const updates: Partial<FailureReport> = { status }
    if (status === 'acknowledged') {
      updates.acknowledged_at = new Date().toISOString()
      updates.assigned_to = profile?.id ?? null
      updates.resolved_at = null
    }
    if (status === 'in_progress' && profile?.id) {
      updates.assigned_to = profile.id
      updates.resolved_at = null
    }
    if (status === 'unresolved') {
      updates.resolved_at = null
      if (profile?.id) updates.assigned_to = profile.id
    }
    if (status === 'resolved') {
      updates.resolved_at = new Date().toISOString()
      if (profile?.role === 'specialist' && profile.id) updates.assigned_to = profile.id
    }

    await supabase.from('failure_reports').update(updates).eq('id', id)
    setReports(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r))
  }

  async function saveNotes(id: string) {
    if (readOnly) return
    const entry = editNotes[id]
    if (!entry) return
    setEditNotes(prev => ({ ...prev, [id]: { ...prev[id], saving: true } }))
    await supabase.from('failure_reports').update({ resolution_notes: entry.notes }).eq('id', id)
    setReports(prev => prev.map(r => r.id === id ? { ...r, resolution_notes: entry.notes } : r))
    setEditNotes(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  function startEditNotes(r: FailureRow) {
    if (readOnly) return
    setEditNotes(prev => ({ ...prev, [r.id]: { id: r.id, notes: r.resolution_notes ?? '', saving: false } }))
  }

  const openReports = useMemo(() =>
    reports.filter(r => r.status !== 'resolved'),
    [reports]
  )

  const urgentQueue = useMemo(() =>
    [...openReports]
      .sort((a, b) => SEV_CFG[b.severity].rank - SEV_CFG[a.severity].rank || new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(0, 6),
    [openReports]
  )

  const myTasks = useMemo(() =>
    openReports.filter(r => r.assigned_to === profile?.id),
    [openReports, profile?.id]
  )

  const historyReports = useMemo(() => {
    const resolved = reports.filter(r => r.status === 'resolved')
    if (canSeeAllHistory) return resolved
    return resolved.filter(r => r.assigned_to === profile?.id)
  }, [canSeeAllHistory, profile?.id, reports])

  const filteredOpenReports = useMemo(() => {
    const q = search.trim().toLowerCase()
    return openReports.filter(r => {
      if (filter !== 'all' && filter !== 'resolved' && r.status !== filter) return false
      if (!q) return true
      return [
        r.machine?.name,
        r.machine?.code,
        r.reporter?.full_name,
        r.station,
        CAT_LABELS[r.category],
        r.description,
        r.resolution_notes
      ].some(value => value?.toLowerCase().includes(q))
    })
  }, [filter, openReports, search])

  const filteredHistoryReports = useMemo(() => {
    const q = search.trim().toLowerCase()
    return historyReports.filter(r => {
      if (!q) return true
      return [
        r.machine?.name,
        r.machine?.code,
        r.reporter?.full_name,
        r.assignee?.full_name,
        r.station,
        CAT_LABELS[r.category],
        r.description,
        r.resolution_notes
      ].some(value => value?.toLowerCase().includes(q))
    })
  }, [historyReports, search])

  const counts = {
    all: reports.length,
    new: reports.filter(r => r.status === 'new').length,
    acknowledged: reports.filter(r => r.status === 'acknowledged').length,
    in_progress: reports.filter(r => r.status === 'in_progress').length,
    unresolved: reports.filter(r => r.status === 'unresolved').length,
    resolved: historyReports.length,
    critical: openReports.filter(r => r.severity === 'critical').length,
  }

  const machineTpm = useMemo(() => machines.map(machine => {
    const machineFailures = reports.filter(r => r.machine_id === machine.id && r.status !== 'resolved')
    const machineIssues = issues.filter(i => i.machine_id === machine.id)
    const rejectIssues = machineIssues.filter(i => rejectPct(i) > 5).length
    const lowEffIssues = machineIssues.filter(i => i.efficiency_pct < 80).length
    const critical = machineFailures.filter(f => f.severity === 'critical' || f.severity === 'high').length
    const score = critical * 3 + rejectIssues * 2 + lowEffIssues + machineFailures.length
    return { machine, machineFailures, machineIssues, rejectIssues, lowEffIssues, critical, score }
  }).sort((a, b) => b.score - a.score), [issues, machines, reports])

  return (
    <>
      {photoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setPhotoModal(null)}>
          <img src={photoModal} className="max-h-full max-w-full rounded-xl object-contain" alt="Zdjecie awarii" />
          <button className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-2xl text-white hover:bg-white/30" onClick={() => setPhotoModal(null)}>
            x
          </button>
        </div>
      )}

      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Centrum specjalisty</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-navy-400">
              <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
              Aktualizacje na zywo: awarie, niska wydajnosc, duzy odrzut
            </div>
          </div>
          <button onClick={load} className="btn-secondary px-4 py-2 text-sm">
            {loading ? 'Laduje...' : 'Odswiez'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {[
            { label: 'Nowe awarie', value: counts.new, tone: 'text-red-400' },
            { label: 'Krytyczne', value: counts.critical, tone: 'text-red-400' },
            { label: 'W trakcie', value: counts.in_progress, tone: 'text-blue-400' },
            { label: 'Otwarte lacznie', value: openReports.length, tone: 'text-amber-400' },
            { label: 'Problemy prod.', value: issues.length, tone: 'text-cyan-300' },
            { label: 'Nierozwiazane', value: counts.unresolved, tone: 'text-orange-400' },
          ].map(kpi => (
            <div key={kpi.label} className="kpi-card">
              <div className="kpi-label">{kpi.label}</div>
              <div className={cn('kpi-value text-2xl', kpi.tone)}>{loading ? '...' : kpi.value}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 border-b border-navy-700 pb-2">
          {[
            ['awarie', `Awarie (${openReports.length})`],
            ...readOnly ? [] : [['zadania', `Moje zadania (${myTasks.length})`]],
            ['produkcja', `Produkcja (${issues.length})`],
            ['tpm', 'TPM / obszary'],
            ['historia', `Historia (${historyReports.length})`],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key as ViewMode)}
              className={cn('rounded-xl px-4 py-2 text-sm font-bold transition-all', view === key ? 'bg-brand text-navy-950' : 'bg-navy-800 text-navy-300 hover:bg-navy-700')}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'awarie' && (
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="card xl:col-span-2">
              <div className="card-header">
                <div>
                  <div className="card-title">Otwarte awarie</div>
                  <div className="card-sub">Kolejka reakcji: najpierw krytyczne i najstarsze</div>
                </div>
              </div>
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2">
                  {(['all', 'new', 'acknowledged', 'in_progress', 'unresolved'] as FilterStatus[]).map(status => (
                    <button
                      key={status}
                      onClick={() => setFilter(status)}
                      className={cn('rounded-xl border px-3 py-2 text-xs font-bold transition-all', filter === status ? 'border-brand bg-brand/15 text-brand' : 'border-navy-600 bg-navy-900 text-navy-300 hover:border-navy-500')}
                    >
                      {status === 'all' ? `Wszystkie (${openReports.length})` : `${STATUS_CFG[status].label} (${counts[status]})`}
                    </button>
                  ))}
                </div>
                <input value={search} onChange={e => setSearch(e.target.value)} className="input max-w-sm" placeholder="Szukaj: maszyna, stacja, opis..." />
              </div>
              <div className="space-y-3">
                {filteredOpenReports.length === 0 && <div className="py-8 text-center text-navy-500">Brak otwartych awarii</div>}
                {filteredOpenReports.map(r => (
                  <FailureCard
                    key={r.id}
                    report={r}
                    expanded={!!expanded[r.id]}
                    editEntry={editNotes[r.id]}
                    onToggle={() => setExpanded(prev => ({ ...prev, [r.id]: !prev[r.id] }))}
                    onStatus={updateStatus}
                    onPhoto={setPhotoModal}
                    readOnly={readOnly}
                    onStartNotes={startEditNotes}
                    onSaveNotes={saveNotes}
                    onNotesChange={(id, notes) => setEditNotes(prev => ({ ...prev, [id]: { ...prev[id], notes } }))}
                    onCancelNotes={id => setEditNotes(prev => { const n = { ...prev }; delete n[id]; return n })}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="card">
                <div className="card-title">Najpilniejsze</div>
                <div className="card-sub mb-3">Krytyczne i wysokie priorytety</div>
                <div className="space-y-2">
                  {urgentQueue.map(r => <FailureCard key={r.id} report={r} compact onStatus={updateStatus} onPhoto={setPhotoModal} readOnly={readOnly} />)}
                  {urgentQueue.length === 0 && <div className="py-6 text-center text-sm text-navy-500">Brak pilnych awarii</div>}
                </div>
              </div>

              <div className="card">
                <div className="card-title">Szybkie sygnaly produkcji</div>
                <div className="card-sub mb-3">Niski wynik i odrzut z dzisiejszych wpisow</div>
                <div className="space-y-2">
                  {issues.slice(0, 5).map(issue => <ProductionIssueRow key={issue.id} issue={issue} />)}
                  {issues.length === 0 && <div className="py-6 text-center text-sm text-navy-500">Brak ostrzezen produkcyjnych</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {view === 'zadania' && (
          <div className="space-y-4">
            <div className="card">
              <div className="card-title">Moje zadania</div>
              <div className="card-sub">Awarie przypisane do Ciebie albo przyjete przez Ciebie</div>
            </div>
            {myTasks.length === 0 && <div className="card py-10 text-center text-navy-500">Nie masz teraz przypisanych zadan</div>}
            {myTasks.map(r => (
              <FailureCard
                key={r.id}
                report={r}
                expanded={!!expanded[r.id]}
                editEntry={editNotes[r.id]}
                onToggle={() => setExpanded(prev => ({ ...prev, [r.id]: !prev[r.id] }))}
                onStatus={updateStatus}
                onPhoto={setPhotoModal}
                readOnly={readOnly}
                onStartNotes={startEditNotes}
                onSaveNotes={saveNotes}
                onNotesChange={(id, notes) => setEditNotes(prev => ({ ...prev, [id]: { ...prev[id], notes } }))}
                onCancelNotes={id => setEditNotes(prev => { const n = { ...prev }; delete n[id]; return n })}
              />
            ))}
          </div>
        )}

        {view === 'historia' && (
          <div className="space-y-4">
            <div className="card">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="card-title">Historia awarii</div>
                  <div className="card-sub">
                    {canSeeAllHistory ? 'Wszystkie zamkniete zgloszenia i notatki reakcji' : 'Tylko Twoje zamkniete zgloszenia i notatki reakcji'}
                  </div>
                </div>
                <input value={search} onChange={e => setSearch(e.target.value)} className="input max-w-sm" placeholder="Szukaj: maszyna, stacja, opis..." />
              </div>
            </div>

            <div className="space-y-3">
              {!loading && filteredHistoryReports.length === 0 && <div className="card py-10 text-center text-navy-500">Brak historii w tym widoku</div>}
              {filteredHistoryReports.map(r => (
                <FailureCard
                  key={r.id}
                  report={r}
                  expanded={!!expanded[r.id]}
                  editEntry={editNotes[r.id]}
                  onToggle={() => setExpanded(prev => ({ ...prev, [r.id]: !prev[r.id] }))}
                  onStatus={updateStatus}
                  onPhoto={setPhotoModal}
                  readOnly={readOnly}
                  onStartNotes={startEditNotes}
                  onSaveNotes={saveNotes}
                  onNotesChange={(id, notes) => setEditNotes(prev => ({ ...prev, [id]: { ...prev[id], notes } }))}
                  onCancelNotes={id => setEditNotes(prev => { const n = { ...prev }; delete n[id]; return n })}
                />
              ))}
            </div>
          </div>
        )}

        {view === 'produkcja' && (
          <div className="grid gap-3 xl:grid-cols-2">
            {issues.map(issue => <ProductionIssueCard key={issue.id} issue={issue} />)}
            {issues.length === 0 && <div className="card py-10 text-center text-navy-500 xl:col-span-2">Brak niskiej wydajnosci i duzego odrzutu dzisiaj</div>}
          </div>
        )}

        {view === 'tpm' && (
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {machineTpm.map(row => <TpmCard key={row.machine.id} row={row} />)}
          </div>
        )}
      </div>
    </>
  )
}

function FailureCard(props: {
  report: FailureRow
  compact?: boolean
  readOnly?: boolean
  expanded?: boolean
  editEntry?: ExpandedReport
  onToggle?: () => void
  onStatus: (id: string, status: FailureStatus) => void
  onPhoto: (url: string) => void
  onStartNotes?: (report: FailureRow) => void
  onSaveNotes?: (id: string) => void
  onNotesChange?: (id: string, notes: string) => void
  onCancelNotes?: (id: string) => void
}) {
  const { report: r } = props
  const sev = SEV_CFG[r.severity] ?? SEV_CFG.medium
  const st = STATUS_CFG[r.status] ?? STATUS_CFG.new
  const age = ageMinutes(r.created_at)
  const machineName = r.machine?.name ?? '-'
  const isAuto = !!r.auto_generated
  const reporterName = isAuto ? 'System MargoLine' : (r.reporter?.full_name ?? '-')
  const assigneeName = r.assignee?.full_name ?? ''

  return (
    <div className={cn('rounded-xl border border-navy-700 bg-navy-800 p-4', r.status === 'new' && 'border-red-500/30 bg-red-500/5')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('h-2.5 w-2.5 rounded-full', sev.dot)} />
            <div className="font-bold text-white">{machineName}</div>
            {isAuto && <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-xs font-bold text-cyan-300">SYSTEM</span>}
            <span className={cn('rounded-full border px-2 py-0.5 text-xs font-bold', sev.cls)}>{sev.label}</span>
            <span className={cn('rounded-full border px-2 py-0.5 text-xs font-bold', st.cls)}>{st.label}</span>
          </div>
          <div className="mt-1 text-xs text-navy-400">
            {CAT_LABELS[r.category] ?? r.category} {r.station ? `- ${r.station}` : ''} - {minutesLabel(age)} temu
          </div>
          <p className={cn('mt-3 text-sm leading-relaxed text-navy-100', props.compact && 'line-clamp-2')}>{r.description}</p>
          {isAuto && r.auto_metrics && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Metric label="Dobre" value={Number(r.auto_metrics.good_count ?? 0).toLocaleString('pl-PL')} />
              <Metric label="Odrzut" value={`${Number(r.auto_metrics.reject_pct ?? 0).toLocaleString('pl-PL')}%`} tone={Number(r.auto_metrics.reject_pct ?? 0) > 5 ? 'text-red-300' : 'text-white'} />
              <Metric label="Prog odrzutu" value={`${Number(r.auto_metrics.reject_limit_pct ?? 5).toLocaleString('pl-PL')}%`} />
              <Metric label="Niskie wyniki" value={String(r.auto_metrics.low_output_count ?? 0)} tone={Number(r.auto_metrics.low_output_count ?? 0) >= 2 ? 'text-amber-300' : 'text-white'} />
            </div>
          )}
          <div className="mt-2 text-xs text-navy-500">
            Zglosil: {reporterName}{assigneeName ? ` - prowadzi: ${assigneeName}` : ''}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {!props.readOnly && (
            <>
          {r.status === 'new' && <button onClick={() => props.onStatus(r.id, 'acknowledged')} className="btn-primary px-3 py-2 text-xs">Przyjmij</button>}
          {r.status !== 'resolved' && <button onClick={() => props.onStatus(r.id, 'in_progress')} className="btn-secondary px-3 py-2 text-xs">W trakcie</button>}
          {r.status !== 'resolved' && <button onClick={() => props.onStatus(r.id, 'unresolved')} className="rounded-xl bg-orange-500 px-3 py-2 text-xs font-bold text-white hover:bg-orange-400">Nierozwiazane</button>}
          {r.status !== 'resolved' && <button onClick={() => props.onStatus(r.id, 'resolved')} className="rounded-xl bg-green-500 px-3 py-2 text-xs font-bold text-white hover:bg-green-400">Zamknij</button>}
            </>
          )}
          {props.onToggle && <button onClick={props.onToggle} className="btn-secondary px-3 py-2 text-xs">{props.expanded ? 'Mniej' : 'Szczegoly'}</button>}
        </div>
      </div>

      {!!r.photo_urls?.length && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.photo_urls.slice(0, props.compact ? 2 : 3).map((url, index) => (
            <button key={url} onClick={() => props.onPhoto(url)}>
              <img src={url} className="h-16 w-16 rounded-lg border border-navy-600 object-cover hover:border-brand" alt={`Zdjecie ${index + 1}`} />
            </button>
          ))}
        </div>
      )}

      {props.expanded && (
        <div className="mt-4 space-y-4 border-t border-navy-700 pt-4">
          {!props.readOnly && (
            <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-navy-400">Status</div>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(STATUS_CFG) as [FailureStatus, typeof STATUS_CFG[FailureStatus]][]).map(([status, cfg]) => (
                <button
                  key={status}
                  onClick={() => props.onStatus(r.id, status)}
                  className={cn('rounded-full border px-3 py-1.5 text-xs font-bold', r.status === status ? cfg.cls : 'border-navy-600 bg-navy-900 text-navy-300 hover:border-navy-500')}
                >
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>
          )}

          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-navy-400">Notatki reakcji</div>
            {props.readOnly ? (
              <div className="rounded-xl border border-navy-700 bg-navy-900 px-3 py-3 text-sm text-navy-200">
                {r.resolution_notes || 'Brak notatki reakcji technika.'}
              </div>
            ) : props.editEntry ? (
              <div className="space-y-2">
                <textarea
                  className="input min-h-[90px] resize-none text-sm"
                  value={props.editEntry.notes}
                  onChange={e => props.onNotesChange?.(r.id, e.target.value)}
                  placeholder="Co zostalo zrobione, co sprawdzono, co wymaga TPM?"
                />
                <div className="flex gap-2">
                  <button onClick={() => props.onSaveNotes?.(r.id)} disabled={props.editEntry.saving} className="btn-primary px-4 py-2 text-xs">
                    {props.editEntry.saving ? 'Zapisuje...' : 'Zapisz'}
                  </button>
                  <button onClick={() => props.onCancelNotes?.(r.id)} className="btn-secondary px-4 py-2 text-xs">Anuluj</button>
                </div>
              </div>
            ) : (
              <button onClick={() => props.onStartNotes?.(r)} className="w-full rounded-xl border border-navy-700 bg-navy-900 px-3 py-3 text-left text-sm text-navy-200 hover:border-navy-500">
                {r.resolution_notes || 'Kliknij, aby dodac notatke reakcji albo TPM...'}
              </button>
            )}
          </div>

          <div className="grid gap-2 text-xs text-navy-500 sm:grid-cols-3">
            <div>Zgloszono: {new Date(r.created_at).toLocaleString('pl-PL')}</div>
            <div>Przyjeto: {r.acknowledged_at ? new Date(r.acknowledged_at).toLocaleString('pl-PL') : '-'}</div>
            <div>Zamknieto: {r.resolved_at ? new Date(r.resolved_at).toLocaleString('pl-PL') : '-'}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function ProductionIssueRow({ issue }: { issue: ProductionIssue }) {
  const tone = issueTone(issue)
  const reject = rejectPct(issue)
  return (
    <div className={cn('rounded-xl border p-3', toneClasses(tone))}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-bold text-white">{issue.machine?.name ?? '-'}</div>
          <div className="text-xs text-navy-400">{issue.hour_block} - {issue.operator?.full_name ?? '-'}</div>
        </div>
        <div className="text-right">
          <div className={cn('font-mono text-lg font-bold', efficiencyColor(issue.efficiency_pct))}>{issue.efficiency_pct}%</div>
          <div className={cn('text-xs font-bold', reject > 5 ? 'text-red-300' : 'text-navy-400')}>{reject}% odrz.</div>
        </div>
      </div>
    </div>
  )
}

function ProductionIssueCard({ issue }: { issue: ProductionIssue }) {
  const reject = rejectPct(issue)
  const tone = issueTone(issue)
  return (
    <div className={cn('card border-2', toneClasses(tone))}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-white">{issue.machine?.name ?? '-'}</div>
          <div className="text-sm text-navy-400">{issue.report_date} - {issue.hour_block} - zmiana {issue.shift?.shift_type ?? '-'}</div>
          <div className="mt-1 text-xs text-navy-500">Operator: {issue.operator?.full_name ?? '-'}</div>
        </div>
        <div className="text-right">
          <div className={cn('font-mono text-2xl font-bold', efficiencyColor(issue.efficiency_pct))}>{issue.efficiency_pct}%</div>
          <div className={cn('text-sm font-bold', reject > 5 ? 'text-red-300' : 'text-navy-300')}>{reject}% odrzutu</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Metric label="Dobre" value={issue.good_count.toLocaleString('pl-PL')} />
        <Metric label="Odrzut" value={issue.reject_count.toLocaleString('pl-PL')} tone={reject > 5 ? 'text-red-300' : 'text-white'} />
        <Metric label="Norma" value={issue.target.toLocaleString('pl-PL')} />
      </div>
      {(issue.downtime_reason || issue.reject_reason || issue.notes) && (
        <div className="mt-4 rounded-xl bg-navy-900 p-3 text-sm text-navy-200">
          {issue.downtime_reason && <div><span className="text-navy-500">Wynik:</span> {issue.downtime_reason}</div>}
          {issue.reject_reason && <div><span className="text-navy-500">Odrzut:</span> {issue.reject_reason}</div>}
          {issue.notes && <div><span className="text-navy-500">Uwagi:</span> {issue.notes}</div>}
        </div>
      )}
    </div>
  )
}

function TpmCard({ row }: { row: ReturnType<typeof useTpmShape> }) {
  const level = row.score >= 6 ? 'Pilna kontrola' : row.score >= 3 ? 'Do obserwacji' : 'Stabilnie'
  return (
    <div className={cn('card border-2', row.score >= 6 ? 'border-red-500/35' : row.score >= 3 ? 'border-amber-500/35' : 'border-green-500/25')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-white">{row.machine.name}</div>
          <div className="text-sm text-navy-400">{row.machine.code}</div>
        </div>
        <span className={cn('rounded-full border px-2.5 py-1 text-xs font-bold', row.score >= 6 ? 'border-red-500/30 bg-red-500/10 text-red-300' : row.score >= 3 ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-green-500/30 bg-green-500/10 text-green-300')}>
          {level}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Metric label="Awarie" value={row.machineFailures.length} tone={row.machineFailures.length ? 'text-red-300' : 'text-white'} />
        <Metric label="Odrzut" value={row.rejectIssues} tone={row.rejectIssues ? 'text-amber-300' : 'text-white'} />
        <Metric label="Wydajnosc" value={row.lowEffIssues} tone={row.lowEffIssues ? 'text-amber-300' : 'text-white'} />
      </div>
      <div className="mt-4 rounded-xl bg-navy-900 p-3 text-sm text-navy-300">
        {row.score >= 6
          ? 'Zalecenie: sprawdzic przyczyne powtarzalna, zapisac reakcje i zaplanowac TPM.'
          : row.score >= 3
            ? 'Zalecenie: obserwowac trend i potwierdzic stan przy najblizszym obchodzie.'
            : 'Brak sygnalow wymagajacych natychmiastowej reakcji.'}
      </div>
    </div>
  )
}

function Metric({ label, value, tone = 'text-white' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-xl bg-navy-900 p-3 text-center">
      <div className="text-xs text-navy-500">{label}</div>
      <div className={cn('mt-1 font-mono text-lg font-bold', tone)}>{value}</div>
    </div>
  )
}

function useTpmShape() {
  return {
    machine: {} as Machine,
    machineFailures: [] as FailureRow[],
    machineIssues: [] as ProductionIssue[],
    rejectIssues: 0,
    lowEffIssues: 0,
    critical: 0,
    score: 0
  }
}
