import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useShiftStore } from '@/stores/shiftStore'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import { compressImage, SCREEN_PHOTO_OPTIONS } from '@/lib/imageCompression'
import type { ShiftStatPhoto, ShiftStatReading } from '@/types/database'

const MAX_PHOTOS = 6

export async function fetchPhotos(shiftId: string) {
  const { data } = await supabase
    .from('shift_stat_photos')
    .select('*')
    .eq('shift_id', shiftId)
    .order('captured_at', { ascending: false })
  return (data ?? []) as ShiftStatPhoto[]
}

export async function fetchReadings(photoId: string) {
  const { data } = await supabase
    .from('shift_stat_readings')
    .select('*')
    .eq('photo_id', photoId)
    .order('sort_order')
  return (data ?? []) as ShiftStatReading[]
}

async function getSignedUrl(path: string) {
  const { data } = await supabase.storage.from('shift-stats-photos').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

// Karta na stronie aktywnej zmiany - operator moze w dowolnym momencie zrobic
// zdjecie ekranu "Shift Statistics" automatu (PLC), a AI probuje odczytac z niego
// wszystkie pary etykieta/wartosc. Celowo NIE jest to czesc modala zakonczenia
// zmiany (showEndWarning) - to duzy, juz zlozony formularz, a to jest opcjonalna,
// eksperymentalna funkcja ktora nie powinna blokowac ani komplikowac zamkniecia zmiany.
export default function ShiftStatPhotosCard() {
  const { activeShift, activeMachine } = useShiftStore()
  const { profile } = useAuthStore()

  const [photos, setPhotos] = useState<ShiftStatPhoto[]>([])
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [readingsByPhoto, setReadingsByPhoto] = useState<Record<string, ShiftStatReading[]>>({})
  const [expandedPhoto, setExpandedPhoto] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [savingReading, setSavingReading] = useState<string | null>(null)
  const [deletingPhoto, setDeletingPhoto] = useState<string | null>(null)

  const load = async () => {
    if (!activeShift) return
    const list = await fetchPhotos(activeShift.id)
    setPhotos(list)
    const urls: Record<string, string> = {}
    await Promise.all(list.map(async p => {
      const url = await getSignedUrl(p.photo_path)
      if (url) urls[p.id] = url
    }))
    setSignedUrls(urls)
  }

  useEffect(() => { load() }, [activeShift?.id])

  const runExtraction = async (photoId: string) => {
    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, ocr_status: 'pending' } : p))
    try {
      const { data, error: fnError } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
        'extract-shift-stats', { body: { photoId } }
      )
      if (fnError || data?.error) {
        console.error('extract-shift-stats error:', fnError, data)
        let detail = data?.error || fnError?.message || ''
        // Bledy SDK (np. FunctionsHttpError) czesto nie maja czytelnego .message -
        // prawdziwa tresc odpowiedzi jest w .context (obiekt Response). Bez tego
        // operator widzialby tylko ogolnikowy, bezuzyteczny komunikat.
        if (!detail) {
          const ctx = (fnError as { context?: Response } | undefined)?.context
          if (ctx && typeof ctx.text === 'function') {
            try { detail = await ctx.text() } catch { /* ignore */ }
          }
        }
        setError(detail || `Nie udało się połączyć z AI (${fnError?.name ?? 'nieznany błąd'}). Sprawdź połączenie internetowe i spróbuj ponownie.`)
      }
    } catch (e) {
      console.error('extract-shift-stats exception:', e)
      setError('Błąd połączenia z AI: ' + (e instanceof Error ? e.message : String(e)))
    }
    const [freshPhotos, readings] = await Promise.all([
      fetchPhotos(activeShift!.id),
      fetchReadings(photoId)
    ])
    setPhotos(freshPhotos)
    setReadingsByPhoto(prev => ({ ...prev, [photoId]: readings }))
  }

  const handleUpload = async (files: FileList | null) => {
    if (!files || !files[0] || !activeShift || !activeMachine || !profile) return
    if (photos.length >= MAX_PHOTOS) {
      setError(`Można dodać maksymalnie ${MAX_PHOTOS} zdjęć na zmianę.`)
      return
    }
    setError('')
    setUploading(true)
    try {
      const compressed = await compressImage(files[0], SCREEN_PHOTO_OPTIONS)
      const path = `${activeShift.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
      const { error: uploadError } = await supabase.storage.from('shift-stats-photos').upload(path, compressed, {
        cacheControl: '3600', upsert: false
      })
      if (uploadError) throw uploadError

      const { data: photoRow, error: insertError } = await supabase.from('shift_stat_photos').insert({
        shift_id: activeShift.id,
        machine_id: activeMachine.id,
        operator_id: profile.id,
        shift_type: activeShift.shift_type,
        shift_date: activeShift.shift_date,
        photo_path: path
      }).select('id').single()
      if (insertError) throw insertError

      await load()
      setExpandedPhoto(photoRow.id)
      await runExtraction(photoRow.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się wgrać zdjęcia.')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (photo: ShiftStatPhoto) => {
    if (!window.confirm('Usunac to zdjecie? Nie mozna cofnac tej operacji.')) return
    setDeletingPhoto(photo.id)
    await supabase.storage.from('shift-stats-photos').remove([photo.photo_path])
    const { error: deleteError } = await supabase.from('shift_stat_photos').delete().eq('id', photo.id)
    if (deleteError) {
      setError('Nie udało się usunąć zdjęcia: ' + deleteError.message)
      setDeletingPhoto(null)
      return
    }
    setPhotos(prev => prev.filter(p => p.id !== photo.id))
    setExpandedPhoto(prev => prev === photo.id ? null : prev)
    setDeletingPhoto(null)
  }

  const toggleExpand = async (photoId: string) => {
    if (expandedPhoto === photoId) { setExpandedPhoto(null); return }
    setExpandedPhoto(photoId)
    if (!readingsByPhoto[photoId]) {
      const readings = await fetchReadings(photoId)
      setReadingsByPhoto(prev => ({ ...prev, [photoId]: readings }))
    }
  }

  const handleConfirmReading = async (reading: ShiftStatReading) => {
    const corrected = editValues[reading.id]
    setSavingReading(reading.id)
    const { error: updateError } = await supabase.from('shift_stat_readings').update({
      confirmed: true,
      corrected_value: corrected && corrected !== reading.metric_value ? corrected : null
    }).eq('id', reading.id)
    if (!updateError) {
      setReadingsByPhoto(prev => ({
        ...prev,
        [reading.photo_id]: (prev[reading.photo_id] ?? []).map(r => r.id === reading.id
          ? { ...r, confirmed: true, corrected_value: corrected && corrected !== reading.metric_value ? corrected : null }
          : r)
      }))
    }
    setSavingReading(null)
  }

  if (!activeShift || !activeMachine) return null

  return (
    <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Zdjęcia statystyk zmianowych automatu</div>
          <div className="text-xs text-navy-500 mt-0.5">Sfotografuj ekran „Shift Statistics" automatu — AI spróbuje odczytać dane. Opcjonalne, nie blokuje zakończenia zmiany.</div>
        </div>
        <label className={cn(
          'shrink-0 rounded-xl border border-navy-600 bg-navy-900 px-4 py-2 text-xs font-bold text-navy-200 cursor-pointer hover:border-brand/40 hover:text-brand transition-all',
          (uploading || photos.length >= MAX_PHOTOS) && 'opacity-40 pointer-events-none'
        )}>
          {uploading ? 'Wgrywanie...' : '+ Dodaj zdjęcie'}
          <input type="file" accept="image/*" capture="environment" className="hidden"
            disabled={uploading || photos.length >= MAX_PHOTOS}
            onChange={e => { handleUpload(e.target.files); e.target.value = '' }} />
        </label>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      {photos.length === 0 ? (
        <div className="text-center py-4 text-xs text-navy-500">Brak zdjęć dla tej zmiany</div>
      ) : (
        <div className="space-y-2">
          {photos.map(photo => {
            const readings = readingsByPhoto[photo.id] ?? []
            const confirmedCount = readings.filter(r => r.confirmed).length
            return (
              <div key={photo.id} className="rounded-xl border border-navy-700 bg-navy-900 overflow-hidden">
                <div className="w-full flex items-center gap-3 p-3">
                  <button onClick={() => toggleExpand(photo.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity">
                    {signedUrls[photo.id] && (
                      <img src={signedUrls[photo.id]} alt="Miniatura" className="w-14 h-14 object-cover rounded-lg border border-navy-600 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-navy-300">{new Date(photo.captured_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                      <div className="text-xs mt-0.5">
                        {photo.ocr_status === 'pending' && <span className="text-amber-300">Odczytuję dane z AI...</span>}
                        {photo.ocr_status === 'done' && <span className="text-green-400">{readings.length} pozycji odczytanych · {confirmedCount} potwierdzonych</span>}
                        {photo.ocr_status === 'failed' && <span className="text-red-300">{photo.ocr_error || 'Nie udało się odczytać'}</span>}
                      </div>
                    </div>
                    <span className="text-navy-500 text-xs shrink-0">{expandedPhoto === photo.id ? '▲' : '▼'}</span>
                  </button>
                  <button
                    onClick={() => handleDelete(photo)}
                    disabled={deletingPhoto === photo.id}
                    title="Usuń zdjęcie"
                    className="shrink-0 rounded-lg border border-navy-700 text-navy-400 hover:text-red-300 hover:border-red-500/40 w-7 h-7 flex items-center justify-center text-sm disabled:opacity-40"
                  >
                    {deletingPhoto === photo.id ? '…' : '✕'}
                  </button>
                </div>

                {expandedPhoto === photo.id && (
                  <div className="border-t border-navy-700 p-3 space-y-2">
                    {photo.ocr_status !== 'done' && (
                      <button onClick={() => runExtraction(photo.id)} className="btn-secondary text-xs px-3 py-1.5">
                        {photo.ocr_status === 'pending' ? 'Odczytaj ponownie' : 'Spróbuj ponownie'}
                      </button>
                    )}
                    {readings.map(reading => (
                      <div key={reading.id} className={cn(
                        'flex items-center gap-2 rounded-lg px-3 py-2 text-xs',
                        reading.confirmed ? 'bg-green-500/5 border border-green-500/20' : 'bg-navy-800 border border-navy-700'
                      )}>
                        <span className="text-navy-300 flex-1 min-w-0 truncate">{reading.metric_label}</span>
                        {reading.confirmed ? (
                          <span className="font-mono text-white">{reading.corrected_value ?? reading.metric_value}</span>
                        ) : (
                          <>
                            <input
                              value={editValues[reading.id] ?? reading.metric_value}
                              onChange={e => setEditValues(prev => ({ ...prev, [reading.id]: e.target.value }))}
                              className="w-20 bg-navy-900 border border-navy-600 rounded-lg px-2 py-1 font-mono text-white text-right"
                            />
                            <button
                              onClick={() => handleConfirmReading(reading)}
                              disabled={savingReading === reading.id}
                              className="rounded-lg bg-brand/20 text-brand px-2 py-1 font-bold hover:bg-brand/30 disabled:opacity-40"
                            >
                              ✓
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
