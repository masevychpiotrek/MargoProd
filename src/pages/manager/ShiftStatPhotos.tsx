import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { shiftStatModuleLabel } from '@/components/operator/ShiftStatPhotosCard'
import type { ShiftStatPhoto, ShiftStatReading } from '@/types/database'

type PhotoRow = ShiftStatPhoto & {
  machine?: { name: string } | { name: string }[] | null
  operator?: { full_name: string } | { full_name: string }[] | null
}

function one<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined
}

async function fetchPhotos() {
  const { data } = await supabase
    .from('shift_stat_photos')
    .select('*, machine:machines(name), operator:profiles!operator_id(full_name)')
    .order('captured_at', { ascending: false })
    .limit(150)
  return (data ?? []) as PhotoRow[]
}

async function fetchReadings(photoId: string) {
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

export default function ManagerShiftStatPhotos() {
  const [photos, setPhotos] = useState<PhotoRow[]>([])
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [selected, setSelected] = useState<PhotoRow | null>(null)
  const [readings, setReadings] = useState<ShiftStatReading[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const list = await fetchPhotos()
    setPhotos(list)
    const urls: Record<string, string> = {}
    await Promise.all(list.map(async p => {
      const url = await getSignedUrl(p.photo_path)
      if (url) urls[p.id] = url
    }))
    setSignedUrls(urls)
    setLoading(false)
  }

  const openDetail = async (photo: PhotoRow) => {
    setSelected(photo)
    setDetailLoading(true)
    setReadings(await fetchReadings(photo.id))
    setDetailLoading(false)
  }

  // Pobiera zdjecie przez fetch->blob (bezposredni <a download> nie wymusza
  // pobrania dla adresow cross-origin) i zapisuje pod czytelna nazwa:
  // 2026-07-21_Zmiana-I_IS-PRO-1_08-57.jpg
  const [downloading, setDownloading] = useState(false)
  const handleDownload = async (photo: PhotoRow) => {
    const url = signedUrls[photo.id]
    if (!url) return
    setDownloading(true)
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const captured = new Date(photo.captured_at)
      const hh = String(captured.getHours()).padStart(2, '0')
      const mm = String(captured.getMinutes()).padStart(2, '0')
      const machineName = (one(photo.machine)?.name ?? 'automat').replace(/[^\w-]+/g, '-')
      const fileName = `${photo.shift_date ?? 'brak-daty'}_Zmiana-${photo.shift_type ?? '-'}_${machineName}_${hh}-${mm}.jpg`
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } finally {
      setDownloading(false)
    }
  }

  const filtered = photos.filter(p => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (one(p.machine)?.name ?? '').toLowerCase().includes(q) ||
      (one(p.operator)?.full_name ?? '').toLowerCase().includes(q) ||
      (p.shift_date ?? '').includes(q)
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Zdjęcia statystyk zmianowych</h1>
        <p className="text-navy-400 mt-1">{photos.length} zdjęć</p>
      </div>

      <input
        value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Szukaj po automacie, operatorze, dacie (RRRR-MM-DD)..."
        className="input w-full max-w-md"
      />

      {loading ? (
        <div className="text-center py-8 text-navy-500">Ładowanie...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-navy-500">Brak zdjęć</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map(photo => (
            <button key={photo.id} onClick={() => openDetail(photo)}
              className="card p-3 text-left hover:border-brand/40 transition-all">
              {signedUrls[photo.id] && (
                <img src={signedUrls[photo.id]} alt="Miniatura" className="w-full h-32 object-cover rounded-lg border border-navy-700 mb-2" />
              )}
              <div className="text-xs font-bold text-white">{one(photo.machine)?.name ?? '—'}</div>
              {shiftStatModuleLabel(photo.module_key) && (
                <div className="text-xs text-brand">{shiftStatModuleLabel(photo.module_key)}</div>
              )}
              <div className="text-xs text-navy-400">Zmiana {photo.shift_type} · {photo.shift_date}</div>
              <div className="text-xs text-navy-500 mt-1">{one(photo.operator)?.full_name ?? '—'}</div>
              <span className={cn(
                'inline-block mt-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border',
                photo.ocr_status === 'done' ? 'border-green-500/30 bg-green-500/10 text-green-400'
                  : photo.ocr_status === 'failed' ? 'border-red-500/30 bg-red-500/10 text-red-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              )}>
                {photo.ocr_status === 'done' ? 'Odczytane' : photo.ocr_status === 'failed' ? 'Błąd odczytu' : 'W trakcie'}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.9)', backdropFilter: 'blur(8px)' }}>
          <div className="bg-navy-800 border border-navy-600 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">{one(selected.machine)?.name ?? '—'}</h2>
                {shiftStatModuleLabel(selected.module_key) && (
                  <p className="text-brand text-sm font-semibold">{shiftStatModuleLabel(selected.module_key)}</p>
                )}
                <p className="text-navy-400 text-sm">
                  Zmiana {selected.shift_type} · {selected.shift_date} · {one(selected.operator)?.full_name ?? '—'}
                </p>
                <p className="text-navy-500 text-xs mt-0.5">{new Date(selected.captured_at).toLocaleString('pl-PL')}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleDownload(selected)}
                  disabled={downloading || !signedUrls[selected.id]}
                  className="rounded-xl border border-navy-600 bg-navy-900 px-3 py-1.5 text-xs font-bold text-navy-200 hover:border-brand/40 hover:text-brand transition-all disabled:opacity-40"
                >
                  {downloading ? 'Pobieranie...' : '⤓ Pobierz zdjęcie'}
                </button>
                <button onClick={() => setSelected(null)} className="text-navy-400 hover:text-white text-xl leading-none">✕</button>
              </div>
            </div>

            {signedUrls[selected.id] && (
              <img src={signedUrls[selected.id]} alt="Zdjęcie ekranu" className="w-full rounded-xl border border-navy-700 mb-4" />
            )}

            {detailLoading ? (
              <div className="text-center py-8 text-navy-500">Ładowanie...</div>
            ) : readings.length === 0 ? (
              <div className="text-center py-4 text-sm text-navy-500">Brak odczytanych danych</div>
            ) : (
              <div className="space-y-1">
                {readings.map(r => (
                  <div key={r.id} className="flex items-center justify-between gap-3 text-sm border-b border-navy-800 py-1.5">
                    <span className="text-navy-300">{r.metric_label}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-white">{r.corrected_value ?? r.metric_value}</span>
                      {r.confirmed
                        ? <span className="text-[10px] font-bold text-green-400">✓ potwierdzone</span>
                        : <span className="text-[10px] font-bold text-amber-400">niepotwierdzone</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
