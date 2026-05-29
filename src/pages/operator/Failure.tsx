import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useShiftStore } from '@/stores/shiftStore'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import type { Machine, DowntimeCategory } from '@/types/database'

// ─── Stałe ───────────────────────────────────────────────────────────────────

const CATEGORIES: { value: DowntimeCategory; label: string }[] = [
  { value: 'mechanical_failure', label: 'Awaria mechaniczna' },
  { value: 'electrical_failure', label: 'Awaria elektryczna' },
  { value: 'quality_control',    label: 'Problem jakościowy' },
  { value: 'material_shortage',  label: 'Brak materiału' },
  { value: 'process_issue',      label: 'Problem procesu' },
  { value: 'logistics_issue',    label: 'Problem logistyczny' },
  { value: 'other',              label: 'Inne' },
]

type Severity = 'low' | 'medium' | 'high' | 'critical'

const SEVERITIES: {
  value: Severity; label: string; desc: string
  activeCls: string; dotCls: string
}[] = [
  { value: 'low',      label: 'Niska',    desc: 'Maszyna działa',
    activeCls: 'bg-green-500/15 text-green-400 border-green-500/40',
    dotCls: 'bg-green-400' },
  { value: 'medium',   label: 'Średnia',  desc: 'Wymaga uwagi',
    activeCls: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
    dotCls: 'bg-amber-400' },
  { value: 'high',     label: 'Wysoka',   desc: 'Ograniczona praca',
    activeCls: 'bg-orange-500/15 text-orange-400 border-orange-500/40',
    dotCls: 'bg-orange-400' },
  { value: 'critical', label: 'Krytyczna', desc: 'Maszyna stoi',
    activeCls: 'bg-red-500/15 text-red-400 border-red-500/40',
    dotCls: 'bg-red-400' },
]

// ─── Teams webhook ────────────────────────────────────────────────────────────

async function sendTeamsNotification(params: {
  machine: string; category: string; severity: Severity
  station: string; description: string; reporter: string
  photoUrls: string[]
}) {
  const url = import.meta.env.VITE_TEAMS_WEBHOOK_URL
  if (!url) return
  const sevEmoji = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' }[params.severity]
  const sevLabel = { low: 'Niska', medium: 'Średnia', high: 'Wysoka', critical: 'Krytyczna' }[params.severity]
  const now = new Date().toLocaleString('pl-PL')

  const payload = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: { low: '1D9E75', medium: 'EF9F27', high: 'F0997B', critical: 'E24B4A' }[params.severity],
    summary: `${sevEmoji} Awaria — ${params.machine}`,
    sections: [{
      activityTitle: `${sevEmoji} **Awaria — ${params.machine}**`,
      activitySubtitle: `Zgłoszono przez **${params.reporter}** · ${now}`,
      facts: [
        { name: 'Kategoria', value: params.category },
        { name: 'Stacja', value: params.station || '—' },
        { name: 'Pilność', value: `${sevEmoji} ${sevLabel}` },
        { name: 'Opis', value: params.description },
      ],
      ...(params.photoUrls.length > 0 ? {
        images: params.photoUrls.slice(0, 2).map(url => ({ image: url }))
      } : {}),
      markdown: true
    }]
  }

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  } catch { /* Teams jest niekrytyczny */ }
}

// ─── Komponent ────────────────────────────────────────────────────────────────

async function sendTeamsAdaptiveNotification(params: {
  machine: string; category: string; severity: Severity
  station: string; description: string; reporter: string
  photoUrls: string[]
}) {
  const url = import.meta.env.VITE_TEAMS_WEBHOOK_URL
  if (!url) return

  const sevLabel = { low: 'Niska', medium: 'Srednia', high: 'Wysoka', critical: 'Krytyczna' }[params.severity]
  const sevColor = { low: 'good', medium: 'warning', high: 'attention', critical: 'attention' }[params.severity]
  const now = new Date().toLocaleString('pl-PL')

  const payload = {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: `Awaria - ${params.machine}`,
            weight: 'Bolder',
            size: 'Large',
            color: sevColor,
            wrap: true
          },
          {
            type: 'FactSet',
            facts: [
              { title: 'Zglosil', value: params.reporter },
              { title: 'Czas', value: now },
              { title: 'Kategoria', value: params.category },
              { title: 'Stacja', value: params.station || '-' },
              { title: 'Pilnosc', value: sevLabel }
            ]
          },
          {
            type: 'TextBlock',
            text: params.description,
            wrap: true
          },
          ...(params.photoUrls.length > 0 ? [{
            type: 'TextBlock',
            text: `Zdjecia: ${params.photoUrls.join(' ')}`,
            wrap: true,
            size: 'Small',
            color: 'Accent'
          }] : [])
        ]
      }
    }]
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      console.warn('Teams notification failed', response.status, await response.text())
      await sendTeamsNotification(params)
    }
  } catch (error) {
    console.warn('Teams notification failed', error)
    await sendTeamsNotification(params)
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  if (typeof error === 'string' && error.trim()) return error
  return 'Blad zglaszania awarii'
}

async function compressImage(file: File) {
  if (!file.type.startsWith('image/') || file.size < 700_000) return file

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, width, height)

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.78))
  bitmap.close()
  if (!blob) return file

  return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
}

export default function OperatorFailure() {
  const { activeShift, activeMachine } = useShiftStore()
  const { profile } = useAuthStore()

  const [machines, setMachines] = useState<Machine[]>([])
  const [machineId, setMachineId] = useState('')
  const [category, setCategory] = useState<DowntimeCategory>('mechanical_failure')
  const [severity, setSeverity] = useState<Severity>('medium')
  const [station, setStation] = useState('')
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('machines').select('*').eq('is_active', true).order('code')
      .then(({ data }) => { if (data) setMachines(data as Machine[]) })
  }, [])

  useEffect(() => {
    if (activeMachine?.id) setMachineId(activeMachine.id)
    else if (machines.length > 0 && !machineId) setMachineId(machines[0].id)
  }, [activeMachine, machines])

  function addPhotos(files: FileList | null) {
    if (!files) return
    const toAdd = Array.from(files).slice(0, 3 - photos.length)
    const next = [...photos, ...toAdd].slice(0, 3)
    setPhotos(next)
    setPreviews(next.map(f => URL.createObjectURL(f)))
  }

  function removePhoto(i: number) {
    const p = photos.filter((_, idx) => idx !== i)
    setPhotos(p)
    setPreviews(p.map(f => URL.createObjectURL(f)))
  }

  async function uploadPhoto(file: File, reportId: string): Promise<string | null> {
    const uploadFile = await compressImage(file)
    const ext = uploadFile.name.split('.').pop() ?? 'jpg'
    const path = `${reportId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
    const { error } = await supabase.storage.from('failure-photos').upload(path, uploadFile, {
      cacheControl: '3600', upsert: false
    })
    if (error) throw new Error(`Nie udalo sie dodac zdjecia: ${error.message}`)
    return supabase.storage.from('failure-photos').getPublicUrl(path).data.publicUrl
  }

  async function handleSubmit() {
    if (!machineId) { setError('Wybierz maszynę.'); return }
    if (!description.trim()) { setError('Wpisz opis awarii.'); return }
    if (!profile?.id) { setError('Brak aktywnego profilu operatora. Zaloguj sie ponownie.'); return }
    setLoading(true); setError('')

    try {
      // 1. Wstaw zgłoszenie
      const { data: report, error: insErr } = await supabase
        .from('failure_reports')
        .insert({
          machine_id:   machineId,
          shift_id:     activeShift?.id ?? null,
          reporter_id:  profile.id,
          category,
          severity,
          status:       'new',
          station:      station.trim() || null,
          description:  description.trim(),
          photo_urls:   [],
        })
        .select()
        .single()

      if (insErr) throw insErr

      // 2. Upload zdjęć
      const photoUrls: string[] = []
      for (const file of photos) {
        const url = await uploadPhoto(file, report.id)
        if (url) photoUrls.push(url)
      }
      if (photoUrls.length > 0) {
        const { error: photoUpdateError } = await supabase
          .from('failure_reports')
          .update({ photo_urls: photoUrls })
          .eq('id', report.id)
        if (photoUpdateError) throw photoUpdateError
      }

      // 3. Powiadomienia in-app dla specjalistów
      const { data: specialists } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'specialist')
        .eq('is_active', true)
        .is('deleted_at', null)

      const machineName = machines.find(m => m.id === machineId)?.name
        ?? activeMachine?.name ?? '—'
      const catLabel = CATEGORIES.find(c => c.value === category)?.label ?? category
      const sevLabel = SEVERITIES.find(s => s.value === severity)?.label ?? severity

      if (specialists && specialists.length > 0) {
        await supabase.from('notifications').insert(
          specialists.map(s => ({
            user_id:    s.id,
            type:       'failure_report',
            title:      `Awaria — ${machineName}`,
            body:       `${catLabel} · ${sevLabel}${station ? ' · ' + station : ''}`,
            machine_id: machineId,
          }))
        )
      }

      // 4. Audit log
      await supabase.from('audit_logs').insert({
        user_id:    profile.id,
        action:     'failure_report_create',
        table_name: 'failure_reports',
        record_id:  report.id,
        new_values: { machine_id: machineId, severity, category },
      })

      // 5. Teams runs in the background so the operator is not blocked by Power Automate latency.
      void sendTeamsAdaptiveNotification({
        machine:     machineName,
        category:    catLabel,
        severity,
        station:     station.trim() || '—',
        description: description.trim(),
        reporter:    profile?.full_name ?? 'Operator',
        photoUrls,
      })

      setSuccess(true)
    } catch (e: any) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setDescription(''); setStation(''); setSeverity('medium')
    setCategory('mechanical_failure'); setPhotos([]); setPreviews([])
    setSuccess(false)
  }

  // ─── Ekran sukcesu ──────────────────────────────────────────────────────────

  if (success) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="card border border-green-500/30 bg-green-500/5 text-center py-12 space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-green-500/15 flex items-center justify-center mx-auto">
            <svg width="32" height="32" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="9" stroke="#4ade80" strokeWidth="1.5"/>
              <path d="M7 11l3 3 5-5" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-green-400">Zgłoszenie wysłane</h2>
            <p className="text-navy-300 text-sm mt-1">
              Specjalista ds. Procesów został powiadomiony.
            </p>
          </div>
          <button className="btn-primary px-8 py-2.5" onClick={resetForm}>
            Zgłoś kolejną awarię
          </button>
        </div>
      </div>
    )
  }

  // ─── Formularz ──────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Zgłoś awarię</h1>
        <p className="mt-1 text-navy-400">
          Specjalista ds. Procesów Produkcyjnych zostanie natychmiast powiadomiony
        </p>
      </div>

      <div className="card space-y-5">

        {/* Maszyna */}
        <div>
          <label className="label">Maszyna</label>
          {activeMachine ? (
            <div className="rounded-xl bg-navy-900 border border-brand/30 px-4 py-3 text-sm flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
              <div>
                <span className="text-white font-medium">{activeMachine.name}</span>
                <span className="text-navy-400 ml-2">— aktywna zmiana</span>
              </div>
            </div>
          ) : (
            <select
              className="input"
              value={machineId}
              onChange={e => setMachineId(e.target.value)}
            >
              <option value="">Wybierz maszynę...</option>
              {machines.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Kategoria */}
        <div>
          <label className="label">Kategoria awarii</label>
          <select
            className="input"
            value={category}
            onChange={e => setCategory(e.target.value as DowntimeCategory)}
          >
            {CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Stacja */}
        <div>
          <label className="label">Stacja / lokalizacja</label>
          <input
            type="text"
            className="input"
            placeholder="np. st.51, transfer, magazyn taśmy..."
            value={station}
            onChange={e => setStation(e.target.value)}
          />
        </div>

        {/* Pilność */}
        <div>
          <label className="label">Pilność</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SEVERITIES.map(s => (
              <button
                key={s.value}
                onClick={() => setSeverity(s.value)}
                className={cn(
                  'py-2.5 px-2 rounded-xl text-sm font-medium border transition-all text-center',
                  severity === s.value
                    ? s.activeCls
                    : 'bg-navy-700 text-navy-300 border-navy-600 hover:bg-navy-600'
                )}
              >
                <div className="flex items-center justify-center gap-1.5">
                  <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', s.dotCls)} />
                  {s.label}
                </div>
                <div className="text-xs opacity-60 mt-0.5">{s.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Opis */}
        <div>
          <label className="label">Opis awarii</label>
          <textarea
            className="input min-h-[100px] resize-none leading-relaxed"
            placeholder="Co się dzieje? Co widzisz / słyszysz? Od kiedy trwa problem?"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>

        {/* Zdjęcia */}
        <div>
          <label className="label">
            Zdjęcia{' '}
            <span className="text-navy-500 normal-case font-normal">
              (opcjonalnie · maks. 3 · do 5 MB)
            </span>
          </label>

          {previews.length > 0 && (
            <div className="flex gap-2 mb-3 flex-wrap">
              {previews.map((src, i) => (
                <div key={i} className="relative group">
                  <img
                    src={src}
                    className="w-20 h-20 object-cover rounded-xl border border-navy-600"
                    alt={`Zdjęcie ${i + 1}`}
                  />
                  <button
                    onClick={() => removePhoto(i)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Usuń zdjęcie"
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          {photos.length < 3 && (
            <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-navy-600 py-6 cursor-pointer hover:border-navy-500 hover:bg-navy-800/40 transition-all">
              <svg width="24" height="24" viewBox="0 0 22 22" fill="none" className="text-navy-400">
                <rect x="2" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                <circle cx="11" cy="12" r="3" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M7 5l1.5-2h5L15 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <span className="text-sm text-navy-400">
                {photos.length === 0 ? 'Dodaj zdjęcie awarii' : 'Dodaj kolejne zdjęcie'}
              </span>
              <input
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                className="hidden"
                onChange={e => addPhotos(e.target.files)}
              />
            </label>
          )}
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || !machineId || !description.trim()}
          className="btn-primary w-full py-3.5 font-bold text-sm disabled:opacity-40"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Wysyłam zgłoszenie...
            </span>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 22 22" fill="none" className="inline mr-2 -mt-0.5">
                <path d="M11 3l9 16H2L11 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M11 8v5M11 16h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              Zgłoś awarię
            </>
          )}
        </button>
      </div>
    </div>
  )
}
