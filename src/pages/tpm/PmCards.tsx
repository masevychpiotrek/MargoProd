import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { PM_STATUS_LABELS } from '@/types/tpm'
import type { TpmPmCard, TpmStation, TpmMachine, PmCardStatus } from '@/types/tpm'

async function fetchCards() {
  const { data } = await supabase
    .from('tpm_pm_cards')
    .select('*, machine:tpm_machines(*), station:tpm_stations(*), performer:profiles!tpm_pm_cards_performer_id_fkey(id, full_name)')
    .order('planned_date', { ascending: false })
    .limit(300)
  return data as TpmPmCard[] ?? []
}
async function fetchStations() {
  const { data } = await supabase.from('tpm_stations').select('*, machine:tpm_machines(*)').eq('is_active', true).order('sort_order')
  return data as TpmStation[] ?? []
}
async function fetchMachines() {
  const { data } = await supabase.from('tpm_machines').select('*').eq('is_active', true).order('sort_order')
  return data as TpmMachine[] ?? []
}

const STATUS_COLOR: Record<string, string> = {
  planned: 'bg-blue-500/15 text-blue-300', todo: 'bg-blue-500/15 text-blue-300',
  in_progress: 'bg-amber-500/15 text-amber-300', done: 'bg-green-500/15 text-green-300',
  done_late: 'bg-orange-500/15 text-orange-300', not_done: 'bg-red-500/15 text-red-300',
  needs_action: 'bg-red-500/15 text-red-300', awaiting_approval: 'bg-purple-500/15 text-purple-300',
  approved: 'bg-green-600/20 text-green-300'
}

export default function TpmPmCards() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<string>('open')
  const [msg, setMsg] = useState('')
  const canManage = ['specialist', 'manager', 'admin'].includes(profile?.role ?? '')

  const { data: cards = [], isLoading } = useQuery({ queryKey: ['tpm_pm_cards'], queryFn: fetchCards, refetchInterval: 60000 })
  const { data: stations = [] } = useQuery({ queryKey: ['tpm_stations_pm'], queryFn: fetchStations })
  const { data: machines = [] } = useQuery({ queryKey: ['tpm_machines'], queryFn: fetchMachines })

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 4000) }

  // Generowanie harmonogramu: tworzy karty dla stacji, które wymagają PM
  const genMut = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      let created = 0
      for (const st of stations.filter(s => s.is_critical)) {
        // czy istnieje otwarta karta dla stacji?
        const openCard = cards.find(c => c.station_id === st.id && ['planned', 'todo', 'in_progress', 'awaiting_approval'].includes(c.status))
        if (openCard) continue
        // ostatnia zatwierdzona/wykonana
        const lastDone = cards
          .filter(c => c.station_id === st.id && ['done', 'done_late', 'approved'].includes(c.status) && c.actual_date)
          .sort((a, b) => (b.actual_date! > a.actual_date! ? 1 : -1))[0]
        let due = true
        if (lastDone?.actual_date) {
          const nextDue = new Date(lastDone.actual_date)
          nextDue.setDate(nextDue.getDate() + st.pm_frequency_days)
          due = nextDue <= new Date()
        }
        if (!due) continue
        const { error } = await supabase.from('tpm_pm_cards').insert({
          machine_id: st.machine_id, station_id: st.id, planned_date: today, status: 'todo'
        })
        if (!error) created++
      }
      return created
    },
    onSuccess: (n) => { qc.invalidateQueries({ queryKey: ['tpm_pm_cards'] }); flash(n > 0 ? `Utworzono ${n} kart PM` : 'Brak stacji wymagających PM') },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })

  const filtered = cards.filter(c => {
    if (filter === 'all') return true
    if (filter === 'open') return ['planned', 'todo', 'in_progress', 'needs_action', 'awaiting_approval'].includes(c.status)
    if (filter === 'overdue') return ['planned', 'todo'].includes(c.status) && new Date(c.planned_date) < new Date(new Date().toDateString())
    return c.status === filter
  })

  const stats = {
    open: cards.filter(c => ['planned', 'todo', 'in_progress'].includes(c.status)).length,
    overdue: cards.filter(c => ['planned', 'todo'].includes(c.status) && new Date(c.planned_date) < new Date(new Date().toDateString())).length,
    awaiting: cards.filter(c => c.status === 'awaiting_approval').length,
    doneThisMonth: cards.filter(c => ['done', 'done_late', 'approved'].includes(c.status) && c.actual_date && new Date(c.actual_date).getMonth() === new Date().getMonth()).length
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Karty PM — przeglądy prewencyjne</h1>
          <p className="text-navy-400 text-sm">IS PRO · stacje krytyczne</p>
        </div>
        {canManage && (
          <button onClick={() => genMut.mutate()} disabled={genMut.isPending} className="btn-primary px-4 py-2">
            {genMut.isPending ? 'Generowanie...' : 'Generuj harmonogram PM'}
          </button>
        )}
      </div>

      {msg && <div className="rounded-xl border border-brand/30 bg-brand/10 px-4 py-2 text-sm text-brand">{msg}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Otwarte PM" value={stats.open} />
        <Stat label="Po terminie" value={stats.overdue} color={stats.overdue ? 'text-red-400' : 'text-white'} />
        <Stat label="Do zatwierdzenia" value={stats.awaiting} color={stats.awaiting ? 'text-purple-400' : 'text-white'} />
        <Stat label="Wykonane (mies.)" value={stats.doneThisMonth} color="text-green-400" />
      </div>

      <div className="flex gap-2 flex-wrap">
        {[['open', 'Otwarte'], ['overdue', 'Po terminie'], ['awaiting_approval', 'Do zatwierdzenia'], ['approved', 'Zatwierdzone'], ['all', 'Wszystkie']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold border ${filter === k ? 'border-brand bg-brand/10 text-brand' : 'border-navy-600 text-navy-400 hover:border-navy-500'}`}>
            {l}
          </button>
        ))}
      </div>

      {isLoading ? <div className="text-navy-400">Ładowanie...</div> : (
        <div className="space-y-2">
          {filtered.length === 0 && <div className="text-center py-12 text-navy-500">Brak kart PM.</div>}
          {filtered.map(c => {
            const overdue = ['planned', 'todo'].includes(c.status) && new Date(c.planned_date) < new Date(new Date().toDateString())
            return (
              <button key={c.id} onClick={() => navigate(`/tpm/pm/${c.id}`)}
                className={`w-full rounded-xl border p-4 text-left transition-all hover:border-navy-500 ${overdue ? 'border-red-500/40 bg-red-500/5' : 'border-navy-700 bg-navy-800'}`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-mono text-sm text-white">{c.card_number ?? '—'}</div>
                    <div className="text-xs text-navy-400 mt-0.5">
                      {c.machine?.code} · {c.station?.station_number} · plan: {new Date(c.planned_date).toLocaleDateString('pl')}
                      {c.performer && ` · ${(c.performer as { full_name: string }).full_name}`}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[c.status]}`}>{PM_STATUS_LABELS[c.status as PmCardStatus]}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Ręczne utworzenie */}
      {canManage && <ManualCreate machines={machines} stations={stations} onCreated={() => { qc.invalidateQueries({ queryKey: ['tpm_pm_cards'] }); flash('Karta PM utworzona') }} />}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-800 p-4">
      <div className="text-xs text-navy-400 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ?? 'text-white'}`}>{value}</div>
    </div>
  )
}

function ManualCreate({ machines, stations, onCreated }: { machines: TpmMachine[]; stations: TpmStation[]; onCreated: () => void }) {
  const [show, setShow] = useState(false)
  const [machineId, setMachineId] = useState('')
  const [stationId, setStationId] = useState('')
  const [plannedDate, setPlannedDate] = useState(new Date().toISOString().split('T')[0])
  const stOfMachine = stations.filter(s => s.machine_id === machineId)

  const mut = useMutation({
    mutationFn: async () => {
      if (!machineId || !stationId) throw new Error('Wybierz automat i stację.')
      const { error } = await supabase.from('tpm_pm_cards').insert({ machine_id: machineId, station_id: stationId, planned_date: plannedDate, status: 'todo' })
      if (error) throw error
    },
    onSuccess: () => { setShow(false); setStationId(''); onCreated() }
  })

  if (!show) return <button onClick={() => setShow(true)} className="btn-secondary px-4 py-2">+ Utwórz kartę PM ręcznie</button>
  return (
    <div className="rounded-2xl border border-navy-700 bg-navy-800 p-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
      <select value={machineId} onChange={e => { setMachineId(e.target.value); setStationId('') }} className="input">
        <option value="">Automat...</option>
        {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <select value={stationId} onChange={e => setStationId(e.target.value)} className="input" disabled={!machineId}>
        <option value="">Stacja...</option>
        {stOfMachine.map(s => <option key={s.id} value={s.id}>{s.station_number}</option>)}
      </select>
      <input type="date" value={plannedDate} onChange={e => setPlannedDate(e.target.value)} className="input" />
      <div className="flex gap-2">
        <button onClick={() => mut.mutate()} className="btn-primary px-4 py-2 flex-1">Utwórz</button>
        <button onClick={() => setShow(false)} className="btn-secondary px-3 py-2">Anuluj</button>
      </div>
    </div>
  )
}
