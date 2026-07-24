import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import {
  DEFECT_TYPES, COMPLAINT_STATUSES, defectTypeLabel, semiProductLabel,
  complaintStatusLabel, complaintStatusTone, type ComplaintStatus
} from '@/lib/complaints'
import type { InternalComplaint } from '@/types/database'

type Row = InternalComplaint & {
  reporter?: { full_name: string } | { full_name: string }[] | null
  machine?: { name: string } | { name: string }[] | null
}

const TONE_CLASS: Record<string, string> = {
  blue: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  green: 'border-green-500/30 bg-green-500/10 text-green-400',
  red: 'border-red-500/30 bg-red-500/10 text-red-300'
}

function one<T>(v: T | T[] | null | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : v ?? undefined
}

export default function ManagerQualityComplaints() {
  const { profile } = useAuthStore()
  const canManage = profile?.role === 'manager' || profile?.role === 'admin'
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | ComplaintStatus>('all')
  const [defectFilter, setDefectFilter] = useState('all')
  const [selected, setSelected] = useState<Row | null>(null)
  const [note, setNote] = useState('')
  const [savingStatus, setSavingStatus] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('internal_complaints')
      .select('*, reporter:profiles!reporter_id(full_name), machine:machines(name)')
      .order('created_at', { ascending: false })
      .limit(300)
    setRows((data ?? []) as Row[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const changeStatus = async (row: Row, status: ComplaintStatus) => {
    setSavingStatus(true)
    const { error } = await supabase.from('internal_complaints').update({
      status,
      resolution_note: note.trim() || row.resolution_note || null,
      updated_at: new Date().toISOString()
    }).eq('id', row.id)
    if (!error) {
      setRows(prev => prev.map(r => r.id === row.id
        ? { ...r, status, resolution_note: note.trim() || r.resolution_note || null }
        : r))
      setSelected(prev => prev && prev.id === row.id
        ? { ...prev, status, resolution_note: note.trim() || prev.resolution_note || null }
        : prev)
    }
    setSavingStatus(false)
  }

  const filtered = rows.filter(r =>
    (statusFilter === 'all' || r.status === statusFilter) &&
    (defectFilter === 'all' || r.defect_type === defectFilter)
  )

  const counts = COMPLAINT_STATUSES.map(s => ({ ...s, n: rows.filter(r => r.status === s.value).length }))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Reklamacje wewnętrzne</h1>
        <p className="text-navy-400 mt-1">{rows.length} zgłoszeń wad jakościowych półfabrykatów</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {counts.map(s => (
          <button key={s.value} onClick={() => setStatusFilter(statusFilter === s.value ? 'all' : s.value)}
            className={cn('kpi-card text-left transition-all', statusFilter === s.value && 'ring-2 ring-brand/50')}>
            <div className="kpi-label">{s.label}</div>
            <div className={cn('kpi-value', s.tone === 'red' ? 'text-red-400' : s.tone === 'green' ? 'text-green-400' : s.tone === 'amber' ? 'text-amber-400' : 'text-blue-400')}>{s.n}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | ComplaintStatus)} className="input max-w-xs">
          <option value="all">Wszystkie statusy</option>
          {COMPLAINT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={defectFilter} onChange={e => setDefectFilter(e.target.value)} className="input max-w-xs">
          <option value="all">Wszystkie niezgodności</option>
          {DEFECT_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-8 text-navy-500">Ładowanie...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-navy-500">Brak zgłoszeń</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(r => (
            <button key={r.id} onClick={() => { setSelected(r); setNote('') }}
              className="card p-3 text-left hover:border-brand/40 transition-all">
              {r.photo_url && <img src={r.photo_url} alt="Wada" className="w-full h-36 object-cover rounded-lg border border-navy-700 mb-2" />}
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-bold text-white">{defectTypeLabel(r.defect_type)}</div>
                <span className={cn('shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border', TONE_CLASS[complaintStatusTone(r.status)])}>
                  {complaintStatusLabel(r.status)}
                </span>
              </div>
              <div className="text-xs text-navy-400 mt-0.5">{semiProductLabel(r.semi_product)}</div>
              <div className="text-xs text-navy-500 mt-1">Seria {r.batch_number} · {new Date(r.created_at).toLocaleDateString('pl-PL')}</div>
              <div className="text-xs text-navy-500">{one(r.reporter)?.full_name ?? '—'}{one(r.machine)?.name ? ` · ${one(r.machine)?.name}` : ''}</div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.9)', backdropFilter: 'blur(8px)' }}>
          <div className="bg-navy-800 border border-navy-600 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">{defectTypeLabel(selected.defect_type)}</h2>
                <p className="text-navy-400 text-sm">{semiProductLabel(selected.semi_product)} · Seria {selected.batch_number}</p>
                <p className="text-navy-500 text-xs mt-0.5">
                  {new Date(selected.created_at).toLocaleString('pl-PL')} · {one(selected.reporter)?.full_name ?? '—'}
                  {selected.production_date ? ` · prod. ${selected.production_date}` : ''}
                  {one(selected.machine)?.name ? ` · ${one(selected.machine)?.name}` : ''}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-navy-400 hover:text-white text-xl leading-none">✕</button>
            </div>

            {selected.photo_url && (
              <img src={selected.photo_url} alt="Wada" className="w-full rounded-xl border border-navy-700 mb-4" />
            )}
            {selected.description && (
              <div className="rounded-xl bg-navy-900 border border-navy-700 p-3 text-sm text-navy-200 mb-4">{selected.description}</div>
            )}
            {selected.resolution_note && (
              <div className="rounded-xl bg-navy-900 border border-navy-700 p-3 text-sm mb-4">
                <span className="text-navy-400 text-xs">Notatka kierownika: </span>
                <span className="text-navy-200">{selected.resolution_note}</span>
              </div>
            )}

            {canManage ? (
              <div className="space-y-3">
                <div>
                  <label className="label">Notatka (opcjonalnie)</label>
                  <input value={note} onChange={e => setNote(e.target.value)} placeholder="Np. przekazano do UR, partia wstrzymana..." className="input mt-1" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {COMPLAINT_STATUSES.map(s => (
                    <button key={s.value} onClick={() => changeStatus(selected, s.value)} disabled={savingStatus || selected.status === s.value}
                      className={cn('rounded-xl border px-3 py-2 text-xs font-bold transition-all disabled:opacity-40', TONE_CLASS[s.tone])}>
                      {selected.status === s.value ? `✓ ${s.label}` : `Ustaw: ${s.label}`}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-sm text-navy-400">Status: <span className="text-white font-semibold">{complaintStatusLabel(selected.status)}</span></div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
