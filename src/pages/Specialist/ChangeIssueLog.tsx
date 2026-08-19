// Transparentność Zmian i Problemów - rejestr zmian (change_log) i rejestr
// problemów (issue_log), wspólny komponent reużywany pod 3 trasami
// (/operator/changes, /specialist/changes, /manager/changes) - zachowanie
// (co widać, co wolno zapisać) zależy od profile.role, tak samo jak
// SpecialistDashboard jest dziś reużywany pod /specialist i /manager/failures.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useShiftStore } from '@/stores/shiftStore'
import { cn } from '@/lib/utils'
import {
  CHANGE_TYPES, ISSUE_LOG_PRIORITIES, ISSUE_LOG_STATUSES, ISSUE_LOG_STATUS_CFG,
  changeTypeLabel, issueLogPriorityLabel, issueLogStatusLabel
} from '@/lib/changeIssueLog'
import { exportChangeIssueLogXlsx, exportChangeLogCsv, exportIssueLogCsv, printChangeIssueLogSummary } from '@/lib/changeIssueLogExport'
import type { ChangeLogEntry, ChangeLogType, IssueLogEntry, IssueLogPriority, IssueLogStatus, Machine } from '@/types/database'

function one<T>(v: T | T[] | null | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : v ?? undefined
}

function machineName(entry: { machine?: { name: string } | { name: string }[] | null }): string {
  return one(entry.machine)?.name ?? '—'
}

function personName(person: { full_name: string } | { full_name: string }[] | null | undefined): string {
  return one(person)?.full_name ?? '—'
}

function fmt(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('pl-PL')
}

type EntryKind = 'change' | 'issue'
type TimelineItem = { kind: EntryKind; created_at: string; entry: ChangeLogEntry | IssueLogEntry }

async function fetchMachines(): Promise<Machine[]> {
  const { data } = await supabase.from('machines').select('*').is('deleted_at', null).order('name')
  return (data ?? []) as Machine[]
}

const CHANGE_LOG_SELECT = '*, machine:machines(name), user:profiles!user_id(full_name), approver:profiles!approved_by(full_name)'
const ISSUE_LOG_SELECT = '*, machine:machines(name), reporter:profiles!reported_by(full_name), assignee:profiles!assigned_to(full_name)'

export default function ChangeIssueLog() {
  const { profile } = useAuthStore()
  const { activeMachine } = useShiftStore()
  const role = profile?.role

  // Uprawnienia po stronie UI - RLS w bazie jest ostatecznym strażnikiem, to
  // tylko pokazuje/ukrywa akcje, których dana rola i tak nie mogłaby wykonać.
  const canWriteChanges = role === 'specialist' || role === 'manager' || role === 'admin'
  const canWriteIssues = !!role // operator/specialist/manager/admin - wszyscy zalogowani
  const canManageIssues = role === 'specialist' || role === 'manager' || role === 'admin'
  const canApprove = role === 'manager' || role === 'admin'
  const isReadOnly = role === 'viewer'

  const [machines, setMachines] = useState<Machine[]>([])
  const [changes, setChanges] = useState<ChangeLogEntry[]>([])
  const [issues, setIssues] = useState<IssueLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const [tab, setTab] = useState<'list' | 'timeline' | 'top'>('list')
  const [typeFilter, setTypeFilter] = useState<'all' | EntryKind>('all')
  const [machineFilter, setMachineFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | IssueLogStatus>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [timelineMachineId, setTimelineMachineId] = useState('')

  const [selectedChange, setSelectedChange] = useState<ChangeLogEntry | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<IssueLogEntry | null>(null)
  const [resolutionNote, setResolutionNote] = useState('')
  const [saving, setSaving] = useState(false)

  const [showForm, setShowForm] = useState<EntryKind | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  useEffect(() => { fetchMachines().then(list => {
    setMachines(list)
    setTimelineMachineId(prev => prev || list[0]?.id || '')
  }) }, [])

  const load = async () => {
    setLoading(true)
    let changeQuery = supabase.from('change_log').select(CHANGE_LOG_SELECT).order('created_at', { ascending: false }).limit(300)
    let issueQuery = supabase.from('issue_log').select(ISSUE_LOG_SELECT).order('created_at', { ascending: false }).limit(300)
    if (machineFilter) { changeQuery = changeQuery.eq('machine_id', machineFilter); issueQuery = issueQuery.eq('machine_id', machineFilter) }
    if (dateFrom) { changeQuery = changeQuery.gte('created_at', dateFrom); issueQuery = issueQuery.gte('created_at', dateFrom) }
    if (dateTo) { changeQuery = changeQuery.lte('created_at', `${dateTo}T23:59:59`); issueQuery = issueQuery.lte('created_at', `${dateTo}T23:59:59`) }
    if (statusFilter !== 'all') issueQuery = issueQuery.eq('status', statusFilter)

    const [{ data: changeData }, { data: issueData }] = await Promise.all([changeQuery, issueQuery])
    setChanges((changeData ?? []) as ChangeLogEntry[])
    setIssues((issueData ?? []) as IssueLogEntry[])
    setLoading(false)
  }

  useEffect(() => { load() }, [machineFilter, statusFilter, dateFrom, dateTo])

  // ─── Top problemy: liczba zgłoszeń i łączny czas otwarcia per automat ──────
  const topProblems = useMemo(() => {
    const byMachine = new Map<string, { name: string; count: number; openMs: number }>()
    issues.forEach(i => {
      const name = machineName(i)
      const entry = byMachine.get(i.machine_id) ?? { name, count: 0, openMs: 0 }
      entry.count += 1
      const end = i.closed_at ? new Date(i.closed_at).getTime() : Date.now()
      entry.openMs += end - new Date(i.created_at).getTime()
      byMachine.set(i.machine_id, entry)
    })
    return [...byMachine.values()].sort((a, b) => b.count - a.count).slice(0, 10)
  }, [issues])

  // ─── Oś czasu jednej maszyny: zmiany + problemy scalone chronologicznie ────
  const timelineItems: TimelineItem[] = useMemo(() => {
    if (!timelineMachineId) return []
    const c: TimelineItem[] = changes.filter(e => e.machine_id === timelineMachineId).map(e => ({ kind: 'change', created_at: e.created_at, entry: e }))
    const i: TimelineItem[] = issues.filter(e => e.machine_id === timelineMachineId).map(e => ({ kind: 'issue', created_at: e.created_at, entry: e }))
    return [...c, ...i].sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [changes, issues, timelineMachineId])

  const listChanges = typeFilter === 'issue' ? [] : changes
  const listIssues = typeFilter === 'change' ? [] : issues

  // ─── Zapis statusu/rozwiązania problemu ─────────────────────────────────────
  const updateIssueStatus = async (row: IssueLogEntry, status: IssueLogStatus) => {
    setSaving(true)
    const closed_at = status === 'closed' ? new Date().toISOString() : null
    const { error } = await supabase.from('issue_log').update({
      status, closed_at, resolution: resolutionNote.trim() || row.resolution || null
    }).eq('id', row.id)
    if (!error) {
      const patch = { status, closed_at, resolution: resolutionNote.trim() || row.resolution || null }
      setIssues(prev => prev.map(r => r.id === row.id ? { ...r, ...patch } : r))
      setSelectedIssue(prev => prev && prev.id === row.id ? { ...prev, ...patch } : prev)
    }
    setSaving(false)
  }

  const approveChange = async (row: ChangeLogEntry) => {
    if (!profile) return
    setSaving(true)
    const { error } = await supabase.from('change_log').update({ approved_by: profile.id }).eq('id', row.id)
    if (!error) {
      setChanges(prev => prev.map(r => r.id === row.id ? { ...r, approved_by: profile.id, approver: profile } : r))
      setSelectedChange(prev => prev && prev.id === row.id ? { ...prev, approved_by: profile.id, approver: profile } : prev)
    }
    setSaving(false)
  }

  // ─── Eksport ────────────────────────────────────────────────────────────────
  const rangeLabel = `${dateFrom || 'początek'}_${dateTo || 'dziś'}`.replace(/\s/g, '')
  const runExport = async (fn: () => void | Promise<void>) => {
    setExporting(true); setExportError('')
    try { await fn() } catch (e) { setExportError(e instanceof Error ? e.message : 'Nie udało się przygotować eksportu.') }
    finally { setExporting(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Transparentność Zmian i Problemów</h1>
          <p className="text-navy-400 mt-1">{changes.length} zmian · {issues.length} problemów w wybranym zakresie</p>
        </div>
        {!isReadOnly && (
          <div className="flex flex-wrap gap-2">
            {canWriteChanges && (
              <button onClick={() => setShowForm('change')} className="rounded-xl border border-navy-600 bg-navy-900 px-4 py-2 text-sm font-bold text-navy-200 hover:border-brand/40 hover:text-brand transition-all">
                + Zmiana
              </button>
            )}
            {canWriteIssues && (
              <button onClick={() => setShowForm('issue')} className="btn-primary px-4 py-2 text-sm">+ Problem</button>
            )}
          </div>
        )}
      </div>

      {/* Zakładki */}
      <div className="flex gap-2 border-b border-navy-700">
        {([['list', 'Lista'], ['timeline', 'Oś czasu'], ['top', 'Top problemy']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn('px-4 py-2 text-sm font-bold border-b-2 -mb-px transition-all',
              tab === key ? 'border-brand text-brand' : 'border-transparent text-navy-400 hover:text-navy-200')}>
            {label}
          </button>
        ))}
      </div>

      {/* Filtry */}
      <div className="flex flex-wrap gap-3">
        <select value={machineFilter} onChange={e => setMachineFilter(e.target.value)} className="input max-w-xs">
          <option value="">Wszystkie automaty</option>
          {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {tab === 'list' && (
          <>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as 'all' | EntryKind)} className="input max-w-xs">
              <option value="all">Zmiany i problemy</option>
              <option value="change">Tylko zmiany</option>
              <option value="issue">Tylko problemy</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | IssueLogStatus)} className="input max-w-xs">
              <option value="all">Wszystkie statusy</option>
              {ISSUE_LOG_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </>
        )}
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input max-w-[160px]" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input max-w-[160px]" />
      </div>

      {/* Eksport */}
      <div className="flex flex-wrap gap-2">
        <button disabled={exporting} onClick={() => runExport(() => exportChangeIssueLogXlsx(changes, issues, rangeLabel))}
          className="rounded-xl border border-navy-600 bg-navy-900 px-3 py-2 text-xs font-bold text-navy-200 hover:border-brand/40 hover:text-brand transition-all disabled:opacity-40">
          📊 XLSX
        </button>
        <button disabled={exporting} onClick={() => runExport(() => exportChangeLogCsv(changes, rangeLabel))}
          className="rounded-xl border border-navy-600 bg-navy-900 px-3 py-2 text-xs font-bold text-navy-200 hover:border-brand/40 hover:text-brand transition-all disabled:opacity-40">
          CSV (zmiany)
        </button>
        <button disabled={exporting} onClick={() => runExport(() => exportIssueLogCsv(issues, rangeLabel))}
          className="rounded-xl border border-navy-600 bg-navy-900 px-3 py-2 text-xs font-bold text-navy-200 hover:border-brand/40 hover:text-brand transition-all disabled:opacity-40">
          CSV (problemy)
        </button>
        <button disabled={exporting} onClick={() => runExport(() => printChangeIssueLogSummary(changes, issues, rangeLabel))}
          className="rounded-xl border border-navy-600 bg-navy-900 px-3 py-2 text-xs font-bold text-navy-200 hover:border-brand/40 hover:text-brand transition-all disabled:opacity-40">
          🖨️ PDF
        </button>
      </div>
      {exportError && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300">{exportError}</div>}

      {loading ? (
        <div className="text-center py-8 text-navy-500">Ładowanie...</div>
      ) : tab === 'list' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {listChanges.map(c => (
            <button key={`c-${c.id}`} onClick={() => setSelectedChange(c)} className="card p-3 text-left hover:border-brand/40 transition-all">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-bold text-white">🔧 {changeTypeLabel(c.change_type)}</div>
                {c.approved_by && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border border-green-500/30 bg-green-500/10 text-green-400">Zatwierdzono</span>}
              </div>
              <div className="text-xs text-navy-400 mt-0.5">{machineName(c)}{c.station ? ` · ${c.station}` : ''}</div>
              <div className="text-xs text-navy-500 mt-1 line-clamp-2">{c.reason}</div>
              <div className="text-xs text-navy-600 mt-1">{personName(c.user)} · {fmt(c.created_at)}</div>
            </button>
          ))}
          {listIssues.map(i => (
            <button key={`i-${i.id}`} onClick={() => setSelectedIssue(i)} className="card p-3 text-left hover:border-brand/40 transition-all">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-bold text-white">⚠️ {issueLogPriorityLabel(i.priority)}</div>
                <span className={cn('shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border', ISSUE_LOG_STATUS_CFG[i.status].cls)}>
                  {issueLogStatusLabel(i.status)}
                </span>
              </div>
              <div className="text-xs text-navy-400 mt-0.5">{machineName(i)}{i.station ? ` · ${i.station}` : ''}</div>
              <div className="text-xs text-navy-500 mt-1 line-clamp-2">{i.description}</div>
              <div className="text-xs text-navy-600 mt-1">{personName(i.reporter)} · {fmt(i.created_at)}</div>
            </button>
          ))}
          {listChanges.length === 0 && listIssues.length === 0 && (
            <div className="col-span-full text-center py-8 text-navy-500">Brak wpisów w wybranym zakresie</div>
          )}
        </div>
      ) : tab === 'timeline' ? (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Oś czasu</div>
            <select value={timelineMachineId} onChange={e => setTimelineMachineId(e.target.value)} className="input max-w-xs">
              {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="space-y-2 max-h-[32rem] overflow-y-auto">
            {timelineItems.map(item => (
              <div key={`${item.kind}-${item.entry.id}`} className="text-sm border-l-2 border-navy-600 pl-3 py-1">
                {item.kind === 'change' ? (
                  <>
                    <div className="text-navy-300">
                      <span className="text-white font-medium">🔧 {changeTypeLabel((item.entry as ChangeLogEntry).change_type)}</span>
                      {' · '}{personName((item.entry as ChangeLogEntry).user)}
                    </div>
                    <div className="text-xs text-navy-400">{(item.entry as ChangeLogEntry).reason}</div>
                  </>
                ) : (
                  <>
                    <div className="text-navy-300">
                      <span className="text-white font-medium">⚠️ {issueLogStatusLabel((item.entry as IssueLogEntry).status)}</span>
                      {' · '}{personName((item.entry as IssueLogEntry).reporter)}
                    </div>
                    <div className="text-xs text-navy-400">{(item.entry as IssueLogEntry).description}</div>
                  </>
                )}
                <div className="text-xs text-navy-600">{fmt(item.created_at)}</div>
              </div>
            ))}
            {timelineItems.length === 0 && <div className="text-navy-500 text-sm">Brak wpisów dla tego automatu.</div>}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {topProblems.map(p => (
            <div key={p.name} className="kpi-card">
              <div className="kpi-label">{p.name}</div>
              <div className="kpi-value text-red-400">{p.count}</div>
              <div className="text-xs text-navy-500 mt-1">Łączny czas otwarcia: {Math.round(p.openMs / 3_600_000)} h</div>
            </div>
          ))}
          {topProblems.length === 0 && <div className="col-span-full text-center py-8 text-navy-500">Brak problemów w wybranym zakresie</div>}
        </div>
      )}

      {/* Modal szczegółów - zmiana */}
      {selectedChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.9)', backdropFilter: 'blur(8px)' }}>
          <div className="bg-navy-800 border border-navy-600 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">🔧 {changeTypeLabel(selectedChange.change_type)}</h2>
                <p className="text-navy-500 text-xs mt-0.5">{machineName(selectedChange)}{selectedChange.station ? ` · ${selectedChange.station}` : ''} · {fmt(selectedChange.created_at)}</p>
              </div>
              <button onClick={() => setSelectedChange(null)} className="text-navy-400 hover:text-white text-xl leading-none">✕</button>
            </div>
            <div className="space-y-3 text-sm">
              <div><span className="text-navy-500">Wprowadził: </span><span className="text-white">{personName(selectedChange.user)}</span></div>
              {(selectedChange.value_before || selectedChange.value_after) && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-navy-900 border border-navy-700 p-3"><div className="text-navy-500 text-xs">Przed</div><div className="text-white">{selectedChange.value_before || '—'}</div></div>
                  <div className="rounded-xl bg-navy-900 border border-navy-700 p-3"><div className="text-navy-500 text-xs">Po</div><div className="text-white">{selectedChange.value_after || '—'}</div></div>
                </div>
              )}
              <div className="rounded-xl bg-navy-900 border border-navy-700 p-3"><div className="text-navy-500 text-xs">Powód</div><div className="text-white whitespace-pre-wrap">{selectedChange.reason}</div></div>
              {selectedChange.attachment_url && (
                <a href={selectedChange.attachment_url} target="_blank" rel="noreferrer" className="text-brand text-xs underline">Załącznik ↗</a>
              )}
              <div className="pt-2">
                {selectedChange.approved_by ? (
                  <div className="text-green-400 text-sm font-semibold">✓ Zatwierdzone przez {personName(selectedChange.approver)}</div>
                ) : canApprove ? (
                  <button disabled={saving} onClick={() => approveChange(selectedChange)} className="btn-primary w-full py-2 text-sm disabled:opacity-50">Zatwierdź zmianę</button>
                ) : (
                  <div className="text-navy-500 text-sm">Oczekuje na zatwierdzenie kierownika/mistrza</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal szczegółów - problem */}
      {selectedIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.9)', backdropFilter: 'blur(8px)' }}>
          <div className="bg-navy-800 border border-navy-600 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">⚠️ {issueLogPriorityLabel(selectedIssue.priority)}</h2>
                <p className="text-navy-500 text-xs mt-0.5">{machineName(selectedIssue)}{selectedIssue.station ? ` · ${selectedIssue.station}` : ''} · {fmt(selectedIssue.created_at)}</p>
              </div>
              <button onClick={() => { setSelectedIssue(null); setResolutionNote('') }} className="text-navy-400 hover:text-white text-xl leading-none">✕</button>
            </div>
            <div className="space-y-3 text-sm">
              <div><span className="text-navy-500">Zgłosił: </span><span className="text-white">{personName(selectedIssue.reporter)}</span></div>
              <div className="rounded-xl bg-navy-900 border border-navy-700 p-3"><div className="text-navy-500 text-xs">Opis</div><div className="text-white whitespace-pre-wrap">{selectedIssue.description}</div></div>
              {selectedIssue.resolution && (
                <div className="rounded-xl bg-navy-900 border border-navy-700 p-3"><div className="text-navy-500 text-xs">Rozwiązanie</div><div className="text-white whitespace-pre-wrap">{selectedIssue.resolution}</div></div>
              )}

              {canManageIssues ? (
                <div className="space-y-3">
                  <div>
                    <label className="label">Notatka / rozwiązanie (opcjonalnie)</label>
                    <input value={resolutionNote} onChange={e => setResolutionNote(e.target.value)} placeholder="Np. wymieniono czujnik na stacji 12..." className="input mt-1" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ISSUE_LOG_STATUSES.map(s => (
                      <button key={s.value} disabled={saving || selectedIssue.status === s.value} onClick={() => updateIssueStatus(selectedIssue, s.value)}
                        className={cn('rounded-xl border px-3 py-2 text-xs font-bold transition-all disabled:opacity-40', ISSUE_LOG_STATUS_CFG[s.value].cls)}>
                        {selectedIssue.status === s.value ? `✓ ${s.label}` : `Ustaw: ${s.label}`}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-navy-400">Status: <span className="text-white font-semibold">{issueLogStatusLabel(selectedIssue.status)}</span></div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Formularz dodawania */}
      {showForm && (
        <AddEntryForm
          kind={showForm}
          machines={machines}
          defaultMachineId={activeMachine?.id}
          onClose={() => setShowForm(null)}
          onSaved={() => { setShowForm(null); load() }}
        />
      )}
    </div>
  )
}

// ─── Formularz dodawania (zmiana lub problem) ────────────────────────────────

function AddEntryForm({ kind, machines, defaultMachineId, onClose, onSaved }: {
  kind: EntryKind
  machines: Machine[]
  defaultMachineId?: string
  onClose: () => void
  onSaved: () => void
}) {
  const { profile } = useAuthStore()
  const [machineId, setMachineId] = useState(defaultMachineId ?? machines[0]?.id ?? '')
  const [station, setStation] = useState('')
  const [changeType, setChangeType] = useState<ChangeLogType>('parameter')
  const [valueBefore, setValueBefore] = useState('')
  const [valueAfter, setValueAfter] = useState('')
  const [reason, setReason] = useState('')
  const [attachmentUrl, setAttachmentUrl] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<IssueLogPriority>('medium')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!profile) return
    if (!machineId) { setError('Wybierz automat.'); return }
    if (kind === 'change' && reason.trim().length < 5) { setError('Opisz powód zmiany (min. kilka słów).'); return }
    if (kind === 'issue' && description.trim().length < 5) { setError('Opisz problem (min. kilka słów).'); return }
    setError(''); setSaving(true)
    try {
      if (kind === 'change') {
        const { error: insErr } = await supabase.from('change_log').insert({
          machine_id: machineId, station: station.trim() || null, user_id: profile.id,
          change_type: changeType, value_before: valueBefore.trim() || null, value_after: valueAfter.trim() || null,
          reason: reason.trim(), attachment_url: attachmentUrl.trim() || null
        })
        if (insErr) throw new Error(insErr.message)
      } else {
        const { error: insErr } = await supabase.from('issue_log').insert({
          machine_id: machineId, station: station.trim() || null, reported_by: profile.id,
          description: description.trim(), priority
        })
        if (insErr) throw new Error(insErr.message)
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać wpisu.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.9)', backdropFilter: 'blur(8px)' }}>
      <div className="bg-navy-800 border border-navy-600 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-bold text-white">{kind === 'change' ? '🔧 Nowa zmiana' : '⚠️ Nowy problem'}</h2>
          <button onClick={onClose} className="text-navy-400 hover:text-white text-xl leading-none">✕</button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Automat *</label>
              <select value={machineId} onChange={e => setMachineId(e.target.value)} className="input mt-1">
                {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Stacja (opcjonalnie)</label>
              <input value={station} onChange={e => setStation(e.target.value)} placeholder="Np. St.24" className="input mt-1" />
            </div>
          </div>

          {kind === 'change' ? (
            <>
              <div>
                <label className="label">Typ zmiany *</label>
                <select value={changeType} onChange={e => setChangeType(e.target.value as ChangeLogType)} className="input mt-1">
                  {CHANGE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Wartość przed</label>
                  <input value={valueBefore} onChange={e => setValueBefore(e.target.value)} className="input mt-1" />
                </div>
                <div>
                  <label className="label">Wartość po</label>
                  <input value={valueAfter} onChange={e => setValueAfter(e.target.value)} className="input mt-1" />
                </div>
              </div>
              <div>
                <label className="label">Powód *</label>
                <textarea value={reason} onChange={e => { setReason(e.target.value); setError('') }} rows={3}
                  placeholder="Np. regulacja czujnika po powtarzających się fałszywych odrzutach..." className="input mt-1 resize-none" />
              </div>
              <div>
                <label className="label">Załącznik - link (opcjonalnie)</label>
                <input value={attachmentUrl} onChange={e => setAttachmentUrl(e.target.value)} placeholder="https://..." className="input mt-1" />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="label">Priorytet *</label>
                <select value={priority} onChange={e => setPriority(e.target.value as IssueLogPriority)} className="input mt-1">
                  {ISSUE_LOG_PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Opis problemu *</label>
                <textarea value={description} onChange={e => { setDescription(e.target.value); setError('') }} rows={4}
                  placeholder="Np. automat zatrzymuje się co kilka minut na stacji 12, prawdopodobnie czujnik..." className="input mt-1 resize-none" />
              </div>
            </>
          )}

          {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300">{error}</div>}

          <button onClick={handleSubmit} disabled={saving} className="btn-primary w-full py-3 text-base disabled:opacity-50">
            {saving ? 'Zapisywanie...' : kind === 'change' ? 'Zapisz zmianę' : 'Zgłoś problem'}
          </button>
        </div>
      </div>
    </div>
  )
}
