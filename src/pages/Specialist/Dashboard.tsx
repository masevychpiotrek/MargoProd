import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import type { FailureReport, FailureStatus, FailureSeverity } from '@/types/database'

// ─── Stałe ───────────────────────────────────────────────────────────────────

const SEV_CFG: Record<FailureSeverity, { label: string; cls: string; dot: string }> = {
  low:      { label: 'Niska',     cls: 'bg-green-500/15 text-green-400 border-green-500/30',   dot: 'bg-green-400' },
  medium:   { label: 'Średnia',   cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30',   dot: 'bg-amber-400' },
  high:     { label: 'Wysoka',    cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30', dot: 'bg-orange-400' },
  critical: { label: 'Krytyczna', cls: 'bg-red-500/15 text-red-400 border-red-500/30',         dot: 'bg-red-400 animate-pulse' },
}

const STATUS_CFG: Record<FailureStatus, { label: string; cls: string }> = {
  new:          { label: 'Nowe',       cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  acknowledged: { label: 'Przyjęto',   cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  in_progress:  { label: 'W trakcie',  cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  resolved:     { label: 'Rozwiązano', cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
}

const CAT_LABELS: Record<string, string> = {
  mechanical_failure: 'Awaria mechaniczna',
  electrical_failure: 'Awaria elektryczna',
  quality_control:    'Problem jakościowy',
  material_shortage:  'Brak materiału',
  process_issue:      'Problem procesu',
  logistics_issue:    'Problem logistyczny',
  other:              'Inne',
}

type FilterStatus = 'all' | FailureStatus
type ExpandedReport = { id: string; notes: string; saving: boolean }

// ─── Komponent ────────────────────────────────────────────────────────────────

export default function SpecialistDashboard() {
  const { profile } = useAuthStore()
  const [reports, setReports] = useState<FailureReport[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [editNotes, setEditNotes] = useState<Record<string, ExpandedReport>>({})
  const [photoModal, setPhotoModal] = useState<string | null>(null)
  const [newCount, setNewCount] = useState(0)
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    const { data, error } = await supabase
      .from('failure_reports')
      .select(`
        *,
        machine:machines!machine_id(id, name, code),
        reporter:profiles!reporter_id(id, full_name),
        assignee:profiles!assigned_to(id, full_name)
      `)
      .order('created_at', { ascending: false })
      .limit(100)

    if (seq !== loadSeq.current) return
    if (!error && data) {
      setReports(data as FailureReport[])
      setNewCount((data as FailureReport[]).filter(r => r.status === 'new').length)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Realtime — nasłuchuj na zmiany w failure_reports
  useEffect(() => {
    const channel = supabase
      .channel('specialist-failures')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'failure_reports'
      }, () => load())
      .subscribe()

    const onFocus = () => load()
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)

    return () => {
      supabase.removeChannel(channel)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  // Oznacz powiadomienia jako przeczytane
  useEffect(() => {
    if (!profile?.id) return
    supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', profile.id)
      .eq('type', 'failure_report')
      .eq('is_read', false)
      .then(() => {})
  }, [profile?.id])

  async function updateStatus(id: string, status: FailureStatus) {
    const updates: Partial<FailureReport> = { status }
    if (status === 'acknowledged') updates.acknowledged_at = new Date().toISOString()
    if (status === 'resolved')     updates.resolved_at    = new Date().toISOString()

    await supabase.from('failure_reports').update(updates).eq('id', id)
    // Optimistic update
    setReports(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r))
    if (status === 'new') setNewCount(c => c + 1)
    if (status === 'resolved') setNewCount(c => Math.max(0, c - 1))
  }

  async function saveNotes(id: string) {
    const entry = editNotes[id]
    if (!entry) return
    setEditNotes(prev => ({ ...prev, [id]: { ...prev[id], saving: true } }))
    await supabase.from('failure_reports').update({ resolution_notes: entry.notes }).eq('id', id)
    setReports(prev => prev.map(r => r.id === id ? { ...r, resolution_notes: entry.notes } : r))
    setEditNotes(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  function startEditNotes(r: FailureReport) {
    setEditNotes(prev => ({ ...prev, [r.id]: { id: r.id, notes: r.resolution_notes ?? '', saving: false } }))
  }

  const filtered = filter === 'all' ? reports : reports.filter(r => r.status === filter)

  const counts = {
    all:          reports.length,
    new:          reports.filter(r => r.status === 'new').length,
    acknowledged: reports.filter(r => r.status === 'acknowledged').length,
    in_progress:  reports.filter(r => r.status === 'in_progress').length,
    resolved:     reports.filter(r => r.status === 'resolved').length,
  }

  // ─── UI ────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Photo modal */}
      {photoModal && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setPhotoModal(null)}
        >
          <img src={photoModal} className="max-w-full max-h-full rounded-xl object-contain" alt="Zdjęcie awarii" />
          <button
            className="absolute top-4 right-4 text-white text-2xl w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center"
            onClick={() => setPhotoModal(null)}
            aria-label="Zamknij"
          >✕</button>
        </div>
      )}

      <div className="space-y-5">

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              Zgłoszenia awarii
              {newCount > 0 && (
                <span className="text-sm font-semibold bg-red-500/20 text-red-400 border border-red-500/30 px-2.5 py-0.5 rounded-full">
                  {newCount} nowych
                </span>
              )}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <p className="text-navy-400 text-sm">Aktualizacje na żywo · Realtime</p>
            </div>
          </div>
          <button
            onClick={load}
            className="btn-secondary text-xs py-2 px-3"
          >
            {loading ? 'Ładuję...' : 'Odśwież'}
          </button>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { key: 'all',          label: 'Wszystkie',  color: 'text-white' },
            { key: 'new',          label: 'Nowe',       color: 'text-red-400' },
            { key: 'acknowledged', label: 'Przyjęte',   color: 'text-amber-400' },
            { key: 'in_progress',  label: 'W trakcie',  color: 'text-blue-400' },
            { key: 'resolved',     label: 'Rozwiązane', color: 'text-green-400' },
          ].map(item => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key as FilterStatus)}
              className={cn(
                'kpi-card text-left transition-all',
                filter === item.key && 'ring-1 ring-brand/50'
              )}
            >
              <div className="kpi-label">{item.label}</div>
              <div className={cn('kpi-value text-2xl', item.color)}>
                {loading ? '...' : counts[item.key as keyof typeof counts]}
              </div>
            </button>
          ))}
        </div>

        {/* Lista */}
        <div className="space-y-3">
          {!loading && filtered.length === 0 && (
            <div className="card text-center py-12 text-navy-500">
              <svg width="32" height="32" viewBox="0 0 22 22" fill="none" className="mx-auto mb-3 opacity-30">
                <circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M7 11l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Brak zgłoszeń
              {filter !== 'all' && ` w kategorii "${STATUS_CFG[filter as FailureStatus]?.label}"`}
            </div>
          )}

          {filtered.map(r => {
            const sev = SEV_CFG[r.severity] ?? SEV_CFG.medium
            const st  = STATUS_CFG[r.status] ?? STATUS_CFG.new
            const isOpen = expanded[r.id]
            const editEntry = editNotes[r.id]
            const machineName = (r.machine as { name?: string } | undefined)?.name ?? '—'
            const reporterName = (r.reporter as { full_name?: string } | undefined)?.full_name ?? '—'
            const createdAt = new Date(r.created_at)
            const timeStr = createdAt.toLocaleString('pl-PL', {
              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
            })
            const isNew = r.status === 'new'

            return (
              <div
                key={r.id}
                className={cn(
                  'card transition-all',
                  isNew && 'border-red-500/30 bg-red-500/3'
                )}
              >
                {/* Górny pasek */}
                <div className="flex flex-wrap items-start gap-3 justify-between">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className={cn('w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0', sev.dot)} />
                    <div className="min-w-0">
                      <div className="text-white font-semibold text-sm">{machineName}</div>
                      <div className="text-navy-400 text-xs mt-0.5">
                        {CAT_LABELS[r.category] ?? r.category}
                        {r.station && <span className="text-navy-500"> · {r.station}</span>}
                      </div>
                      <div className="text-navy-500 text-xs mt-0.5">
                        {reporterName} · {timeStr}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full border', sev.cls)}>
                      {sev.label}
                    </span>
                    <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full border', st.cls)}>
                      {st.label}
                    </span>
                    <button
                      onClick={() => setExpanded(prev => ({ ...prev, [r.id]: !prev[r.id] }))}
                      className="text-navy-400 hover:text-white transition-colors p-1"
                      aria-label={isOpen ? 'Zwiń' : 'Rozwiń'}
                    >
                      <svg
                        width="16" height="16" viewBox="0 0 16 16" fill="none"
                        className={cn('transition-transform', isOpen && 'rotate-180')}
                      >
                        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Opis (zawsze widoczny) */}
                <p className="text-navy-200 text-sm mt-3 leading-relaxed">{r.description}</p>

                {/* Zdjęcia — miniaturki */}
                {r.photo_urls && r.photo_urls.length > 0 && (
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {r.photo_urls.map((url, i) => (
                      <button
                        key={i}
                        onClick={() => setPhotoModal(url)}
                        className="relative group"
                        aria-label={`Powiększ zdjęcie ${i + 1}`}
                      >
                        <img
                          src={url}
                          className="w-16 h-16 object-cover rounded-lg border border-navy-600 hover:border-navy-400 transition-colors"
                          alt={`Zdjęcie ${i + 1}`}
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg transition-colors flex items-center justify-center">
                          <svg className="opacity-0 group-hover:opacity-100 transition-opacity" width="16" height="16" viewBox="0 0 22 22" fill="none">
                            <path d="M15 3h4v4M9 13L19 3M7 19H3v-4M13 9L3 19" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                          </svg>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Rozwinięty widok */}
                {isOpen && (
                  <div className="mt-4 pt-4 border-t border-navy-700 space-y-4">

                    {/* Zmiana statusu */}
                    <div>
                      <div className="text-xs font-bold text-navy-400 uppercase tracking-wider mb-2">
                        Zmień status
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(Object.entries(STATUS_CFG) as [FailureStatus, typeof STATUS_CFG[FailureStatus]][]).map(([s, cfg]) => (
                          <button
                            key={s}
                            onClick={() => updateStatus(r.id, s)}
                            className={cn(
                              'text-xs font-medium px-3 py-1.5 rounded-full border transition-all',
                              r.status === s
                                ? cfg.cls
                                : 'bg-navy-700 text-navy-400 border-navy-600 hover:bg-navy-600'
                            )}
                          >
                            {cfg.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Notatki reakcji */}
                    <div>
                      <div className="text-xs font-bold text-navy-400 uppercase tracking-wider mb-2">
                        Notatki reakcji
                      </div>
                      {editEntry ? (
                        <div className="space-y-2">
                          <textarea
                            className="input resize-none min-h-[80px] text-sm"
                            value={editEntry.notes}
                            onChange={e => setEditNotes(prev => ({
                              ...prev, [r.id]: { ...prev[r.id], notes: e.target.value }
                            }))}
                            placeholder="Co zostało zrobione? Jak rozwiązano problem?"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveNotes(r.id)}
                              disabled={editEntry.saving}
                              className="btn-primary text-xs py-2 px-4"
                            >
                              {editEntry.saving ? 'Zapisuję...' : 'Zapisz'}
                            </button>
                            <button
                              onClick={() => setEditNotes(prev => { const n = { ...prev }; delete n[r.id]; return n })}
                              className="btn-secondary text-xs py-2 px-4"
                            >
                              Anuluj
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="rounded-xl bg-navy-900 border border-navy-700 px-3 py-2.5 min-h-[48px] cursor-pointer hover:border-navy-600 transition-colors"
                          onClick={() => startEditNotes(r)}
                        >
                          {r.resolution_notes ? (
                            <p className="text-sm text-navy-200 leading-relaxed">{r.resolution_notes}</p>
                          ) : (
                            <p className="text-sm text-navy-500 italic">Kliknij aby dodać notatki...</p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Znaczniki czasu */}
                    <div className="grid grid-cols-2 gap-3 text-xs text-navy-500">
                      <div>
                        <span className="text-navy-600">Zgłoszono:</span>{' '}
                        {new Date(r.created_at).toLocaleString('pl-PL')}
                      </div>
                      {r.acknowledged_at && (
                        <div>
                          <span className="text-navy-600">Przyjęto:</span>{' '}
                          {new Date(r.acknowledged_at).toLocaleString('pl-PL')}
                        </div>
                      )}
                      {r.resolved_at && (
                        <div>
                          <span className="text-navy-600">Rozwiązano:</span>{' '}
                          {new Date(r.resolved_at).toLocaleString('pl-PL')}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
