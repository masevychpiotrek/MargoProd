import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useSyringeSession } from '@/hooks/useSyringeSession'
import { useSyringeCommand } from '@/hooks/useSyringeCommand'
import { invalidateSyringe } from '@/lib/syringeApi'
import SyringeSessionState from '@/components/shared/SyringeSessionState'
import { useAuthStore } from '@/stores/authStore'
import { useClock } from '@/hooks/useClock'
import type { SaDowntimeEvent, SaDowntimeCategory } from '@/types/database'

async function fetchActiveDowntime(sessionId: string) {
  const { data, error } = await supabase
    .from('sa_downtime_events')
    .select('*, category:sa_downtime_categories(*)')
    .eq('session_id', sessionId)
    .is('ended_at', null)
    .maybeSingle()
  if (error) throw error
  if (error) throw error
  return data as (SaDowntimeEvent & { category?: SaDowntimeCategory }) | null
}

async function fetchDowntimeCategories() {
  const { data, error } = await supabase
    .from('sa_downtime_categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
  if (error) throw error
  if (error) throw error
  return data as SaDowntimeCategory[] ?? []
}

function formatDuration(startedAt: string, nowMs: number = Date.now()) {
  const diff = Math.floor((nowMs - new Date(startedAt).getTime()) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  return `${h > 0 ? `${h}h ` : ''}${m}m ${s}s`
}

const TYPE_LABELS: Record<string, string> = {
  planned: 'Planowane',
  unplanned: 'Nieplanowane',
  quality: 'Jakość',
  logistics: 'Logistyka'
}

export default function SyringeDowntimeEntry() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const command = useSyringeCommand()
  const { now } = useClock()

  // Start downtime
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [description, setDescription] = useState('')

  // End downtime
  const [actionsTaken, setActionsTaken] = useState('')
  const [maintenanceNeeded, setMaintenanceNeeded] = useState(false)
  const [fullyResolved, setFullyResolved] = useState<boolean | null>(null)
  const [nextCategoryId, setNextCategoryId] = useState('')
  const [nextDescription, setNextDescription] = useState('')
  const [endErrors, setEndErrors] = useState<string[]>([])
  const [startErrors, setStartErrors] = useState<string[]>([])

  const { data: session, isLoading, error: sessionError, refetch: refetchSession } = useSyringeSession()

  const { data: activeDowntime, error: downtimeError } = useQuery({
    queryKey: ['sa_active_downtime', session?.id],
    queryFn: () => fetchActiveDowntime(session!.id),
    enabled: !!session?.id,
    refetchInterval: 5000
  })

  const { data: categories = [], error: categoriesError } = useQuery({
    queryKey: ['sa_downtime_categories'],
    queryFn: fetchDowntimeCategories
  })

  const grouped = categories.reduce<Record<string, SaDowntimeCategory[]>>((acc, cat) => {
    const key = cat.category_type
    if (!acc[key]) acc[key] = []
    acc[key].push(cat)
    return acc
  }, {})
  const waitMaintenanceCategory = categories.find(cat => cat.code === 'WAIT_MAINT')
  const maintenanceRepairCategory = categories.find(cat => cat.code === 'MAINT_REPAIR')

  function pickStartCategory(category: SaDowntimeCategory, text?: string) {
    setSelectedCategoryId(category.id)
    setDescription(text ?? '')
    setStartErrors([])
  }

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!session || !profile) throw new Error('Brak aktywnej sesji.')
      const errs: string[] = []
      if (!selectedCategoryId) errs.push('Wybierz przyczynę przestoju.')
      if (errs.length > 0) { setStartErrors(errs); throw new Error('Walidacja') }

      await command('downtime_start', { session_id: session.id, category_id: selectedCategoryId, description })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa_active_downtime'] })
      void invalidateSyringe(qc)
      setSelectedCategoryId('')
      setDescription('')
    },
    onError: (e: Error) => {
      if (e.message !== 'Walidacja') setStartErrors([e.message])
    }
  })

  const endMutation = useMutation({
    mutationFn: async () => {
      if (!activeDowntime || !session) throw new Error('Brak aktywnego przestoju.')
      const errs: string[] = []
      if (fullyResolved === null) errs.push('Określ, czy problem został całkowicie usunięty.')
      if (errs.length > 0) { setEndErrors(errs); throw new Error('Walidacja') }

      await command('downtime_end', { session_id: session.id, event_id: activeDowntime.id,
        actions_taken: actionsTaken, maintenance_needed: maintenanceNeeded, fully_resolved: fullyResolved })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa_active_downtime'] })
      void invalidateSyringe(qc)
      navigate('/syringe')
    },
    onError: (e: Error) => {
      if (e.message !== 'Walidacja') setEndErrors([e.message])
    }
  })

  const switchMutation = useMutation({
    mutationFn: async () => {
      if (!activeDowntime || !session) throw new Error('Brak aktywnego przestoju.')
      const errs: string[] = []
      if (!nextCategoryId) errs.push('Wybierz kolejny etap przestoju.')
      if (errs.length > 0) { setEndErrors(errs); throw new Error('Walidacja') }

      const currentName = activeDowntime.category?.name ?? 'aktywny przestój'
      const nextCategory = categories.find(cat => cat.id === nextCategoryId)
      const nextText = nextDescription.trim()
        || (nextCategory?.code === 'MAINT_REPAIR'
          ? 'UR rozpoczął naprawę przy maszynie.'
          : `Kolejny etap po: ${currentName}.`)

      await command('downtime_end', {
        session_id: session.id,
        event_id: activeDowntime.id,
        actions_taken: actionsTaken.trim() || `Zakończono etap: ${currentName}.`,
        maintenance_needed: true,
        fully_resolved: false
      })
      await command('downtime_start', {
        session_id: session.id,
        category_id: nextCategoryId,
        description: nextText
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa_active_downtime'] })
      void invalidateSyringe(qc)
      setActionsTaken('')
      setMaintenanceNeeded(false)
      setFullyResolved(null)
      setNextCategoryId('')
      setNextDescription('')
    },
    onError: (e: Error) => {
      if (e.message !== 'Walidacja') setEndErrors([e.message])
    }
  })

  const loadError = downtimeError || categoriesError
  if (loadError) return <div role="alert" className="p-5 text-red-400">
    Nie udało się odczytać danych: {loadError.message}
    <button className="btn-secondary ml-2" onClick={() => window.location.reload()}>Ponów odczyt</button>
  </div>

  if (!session || sessionError) {
    return <SyringeSessionState loading={isLoading} error={sessionError} retry={refetchSession} />
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5 py-2">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/syringe')} className="text-navy-400 hover:text-white">←</button>
        <div>
          <h1 className="text-xl font-bold text-white">Przestoje</h1>
          <p className="text-navy-400 text-sm">{session.machine?.name}</p>
        </div>
      </div>

      {/* Aktywny przestój */}
      {activeDowntime ? (
        <div className="space-y-4">
          <div className="rounded-2xl border-2 border-red-500/40 bg-red-500/10 p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-red-400 animate-pulse" />
              <div className="font-bold text-red-300 text-lg">Aktywny przestój</div>
            </div>
            <div>
              <div className="text-sm text-navy-400">Przyczyna</div>
              <div className="text-white font-medium">{activeDowntime.category?.name ?? '—'}</div>
            </div>
            {activeDowntime.description && (
              <div>
                <div className="text-sm text-navy-400">Opis</div>
                <div className="text-white text-sm">{activeDowntime.description}</div>
              </div>
            )}
            <div>
              <div className="text-sm text-navy-400">Czas trwania</div>
              <div className="text-white font-bold text-xl">{formatDuration(activeDowntime.started_at, now.getTime())}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Zakończ przestój</div>

            {endErrors.length > 0 && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 space-y-1">
                {endErrors.map((e, i) => <p key={i} className="text-sm text-red-300">• {e}</p>)}
              </div>
            )}

            <div>
              <label className="text-sm text-navy-400 mb-2 block">Podjęte działania</label>
              <textarea
                value={actionsTaken}
                onChange={e => setActionsTaken(e.target.value)}
                rows={3}
                placeholder="Opisz, co zostało zrobione w celu usunięcia problemu..."
                className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-brand resize-none"
              />
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={maintenanceNeeded}
                onChange={e => setMaintenanceNeeded(e.target.checked)}
                className="w-5 h-5 rounded accent-brand"
              />
              <span className="text-sm text-navy-300">Potrzebna pomoc utrzymania ruchu</span>
            </label>

            <div>
              <div className="text-sm text-navy-400 mb-2">Czy problem został całkowicie usunięty? *</div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setFullyResolved(true)}
                  className={`rounded-xl border-2 py-3 font-bold transition-all ${
                    fullyResolved === true
                      ? 'border-green-500 bg-green-500/15 text-green-300'
                      : 'border-navy-600 text-navy-300 hover:border-navy-500'
                  }`}
                >
                  Tak, usunięto
                </button>
                <button
                  onClick={() => setFullyResolved(false)}
                  className={`rounded-xl border-2 py-3 font-bold transition-all ${
                    fullyResolved === false
                      ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                      : 'border-navy-600 text-navy-300 hover:border-navy-500'
                  }`}
                >
                  Nie, częściowo
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 space-y-3">
              <div>
                <div className="text-sm font-bold text-blue-200">Przełącz na kolejny etap postoju</div>
                <p className="text-xs text-navy-400 mt-1">
                  Użyj tego, gdy kończy się samo oczekiwanie, ale postój dalej trwa, np. UR zaczyna naprawę.
                </p>
              </div>
              {activeDowntime.category?.code === 'WAIT_MAINT' && maintenanceRepairCategory && (
                <button
                  type="button"
                  onClick={() => {
                    setNextCategoryId(maintenanceRepairCategory.id)
                    setNextDescription('UR rozpoczął naprawę przy maszynie.')
                    setEndErrors([])
                  }}
                  className="w-full rounded-xl border-2 border-blue-500/60 bg-blue-500/15 px-4 py-3 text-left text-sm font-bold text-blue-100 hover:border-blue-400"
                >
                  UR jest przy maszynie, rozpocznij etap naprawy
                </button>
              )}
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wider text-navy-400">Kolejny etap</span>
                <select
                  value={nextCategoryId}
                  onChange={e => setNextCategoryId(e.target.value)}
                  className="input mt-1"
                >
                  <option value="">Wybierz kolejny przestój...</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </label>
              <textarea
                value={nextDescription}
                onChange={e => setNextDescription(e.target.value)}
                rows={2}
                placeholder="Opis kolejnego etapu, np. UR diagnozuje podajnik, wymiana czujnika..."
                className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-brand resize-none"
              />
              <button
                type="button"
                onClick={() => { setEndErrors([]); switchMutation.mutate() }}
                disabled={switchMutation.isPending || endMutation.isPending || !nextCategoryId}
                className="w-full py-3 rounded-xl bg-blue-600 text-white font-bold text-sm disabled:opacity-40 hover:bg-blue-500 transition-all"
              >
                {switchMutation.isPending ? 'Przełączanie...' : 'Zakończ ten etap i rozpocznij kolejny'}
              </button>
            </div>

            <button
              onClick={() => { setEndErrors([]); endMutation.mutate() }}
              disabled={endMutation.isPending || switchMutation.isPending}
              className="w-full py-4 rounded-2xl bg-green-600 text-white font-bold text-lg disabled:opacity-40 hover:bg-green-500 transition-all"
            >
              {endMutation.isPending ? 'Kończenie...' : 'Zakończ przestój'}
            </button>
          </div>
        </div>
      ) : (
        /* Formularz nowego przestoju */
        <div className="space-y-4">
          {startErrors.length > 0 && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-1">
              {startErrors.map((e, i) => <p key={i} className="text-sm text-red-300">• {e}</p>)}
            </div>
          )}

          {(waitMaintenanceCategory || maintenanceRepairCategory) && (
            <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-5 space-y-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-blue-200">Szybkie etapy UR</div>
                <p className="text-xs text-navy-400 mt-1">
                  Najpierw zapisujesz czas oczekiwania, później osobno czas naprawy.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {waitMaintenanceCategory && (
                  <button
                    type="button"
                    onClick={() => pickStartCategory(waitMaintenanceCategory, 'Oczekiwanie na przyjazd UR.')}
                    className={`rounded-xl border-2 px-4 py-3 text-left text-sm font-bold transition-all ${
                      selectedCategoryId === waitMaintenanceCategory.id
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-blue-500/40 text-blue-100 hover:border-blue-400'
                    }`}
                  >
                    Czekam na UR
                  </button>
                )}
                {maintenanceRepairCategory && (
                  <button
                    type="button"
                    onClick={() => pickStartCategory(maintenanceRepairCategory, 'UR rozpoczął naprawę przy maszynie.')}
                    className={`rounded-xl border-2 px-4 py-3 text-left text-sm font-bold transition-all ${
                      selectedCategoryId === maintenanceRepairCategory.id
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-blue-500/40 text-blue-100 hover:border-blue-400'
                    }`}
                  >
                    UR naprawia
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Przyczyna przestoju *</div>

            {Object.entries(grouped).map(([type, cats]) => (
              <div key={type} className="space-y-2">
                <div className="text-xs text-navy-500 uppercase tracking-wider">{TYPE_LABELS[type] ?? type}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {cats.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => { setSelectedCategoryId(cat.id); setStartErrors([]) }}
                      className={`rounded-xl border-2 px-4 py-3 text-sm text-left font-medium transition-all ${
                        selectedCategoryId === cat.id
                          ? 'border-brand bg-brand/10 text-brand'
                          : 'border-navy-600 text-navy-300 hover:border-navy-500 hover:text-white'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Opis problemu (opcjonalne)</div>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="Krótki opis sytuacji..."
              className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-brand resize-none"
            />
          </div>

          <button
            onClick={() => { setStartErrors([]); startMutation.mutate() }}
            disabled={startMutation.isPending || !selectedCategoryId}
            className="w-full py-4 rounded-2xl bg-red-600 text-white font-bold text-lg disabled:opacity-40 hover:bg-red-500 transition-all"
          >
            {startMutation.isPending ? 'Rejestrowanie...' : 'Rozpocznij przestój'}
          </button>
        </div>
      )}
    </div>
  )
}
