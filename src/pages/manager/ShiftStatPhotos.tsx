import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { shiftStatModuleLabel } from '@/components/operator/ShiftStatPhotosCard'
import type { ShiftStatPhoto, ShiftStatReading } from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JSZipLib = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EJS = any
declare global {
  interface Window {
    JSZip?: JSZipLib
    ExcelJS?: EJS
  }
}

const NAVY = 'FF1A2744'
const GOLD = 'FFC9A84C'

type PhotoRow = ShiftStatPhoto & {
  machine?: { name: string } | { name: string }[] | null
  operator?: { full_name: string } | { full_name: string }[] | null
}

// Wspolna z pojedynczym pobraniem nazwa pliku: 2026-07-21_Zmiana-I_IS-PRO-1_08-57.jpg
function photoFileName(photo: PhotoRow): string {
  const captured = new Date(photo.captured_at)
  const hh = String(captured.getHours()).padStart(2, '0')
  const mm = String(captured.getMinutes()).padStart(2, '0')
  const machineName = (one(photo.machine)?.name ?? 'automat').replace(/[^\w-]+/g, '-')
  const moduleSuffix = photo.module_key ? `_${photo.module_key}` : ''
  return `${photo.shift_date ?? 'brak-daty'}_Zmiana-${photo.shift_type ?? '-'}_${machineName}${moduleSuffix}_${hh}-${mm}.jpg`
}

function loadJSZip(): Promise<JSZipLib> {
  return new Promise((resolve, reject) => {
    if (window.JSZip) { resolve(window.JSZip); return }
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    s.onload = () => resolve(window.JSZip!)
    s.onerror = () => reject(new Error('Nie udało się załadować biblioteki ZIP'))
    document.head.appendChild(s)
  })
}

function loadExcelJS(): Promise<EJS> {
  return new Promise((resolve, reject) => {
    if (window.ExcelJS) { resolve(window.ExcelJS); return }
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js'
    s.onload = () => resolve(window.ExcelJS!)
    s.onerror = () => reject(new Error('Nie udało się załadować ExcelJS'))
    document.head.appendChild(s)
  })
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

async function fetchReadingsForPhotos(photoIds: string[]) {
  if (!photoIds.length) return [] as ShiftStatReading[]
  const { data } = await supabase
    .from('shift_stat_readings')
    .select('*')
    .in('photo_id', photoIds)
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
  // pobrania dla adresow cross-origin) i zapisuje pod czytelna nazwa.
  const [downloading, setDownloading] = useState(false)
  const handleDownload = async (photo: PhotoRow) => {
    const url = signedUrls[photo.id]
    if (!url) return
    setDownloading(true)
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = photoFileName(photo)
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } finally {
      setDownloading(false)
    }
  }

  // Pobiera WSZYSTKIE aktualnie widoczne (po filtrze) zdjecia jako jeden plik ZIP -
  // zamiast klikac "pobierz" osobno dla kazdego. JSZip ladowany dynamicznie z CDN,
  // tak samo jak ExcelJS w Export.tsx - bez zwiekszania rozmiaru bundla appki.
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [downloadAllProgress, setDownloadAllProgress] = useState({ done: 0, total: 0 })
  const [downloadAllError, setDownloadAllError] = useState('')
  const handleDownloadAll = async (list: PhotoRow[]) => {
    if (list.length === 0) return
    setDownloadingAll(true)
    setDownloadAllError('')
    setDownloadAllProgress({ done: 0, total: list.length })
    try {
      const JSZip = await loadJSZip()
      const zip = new JSZip()
      const usedNames = new Set<string>()
      let done = 0
      for (const photo of list) {
        try {
          const url = signedUrls[photo.id] ?? (await getSignedUrl(photo.photo_path))
          if (url) {
            const blob = await (await fetch(url)).blob()
            let name = photoFileName(photo)
            // Unikniecie nadpisania w ZIP, gdyby dwa zdjecia miec identyczna nazwe
            // (ta sama minuta, maszyna, zmiana, modul).
            if (usedNames.has(name)) {
              name = name.replace(/\.jpg$/, `_${photo.id.slice(0, 6)}.jpg`)
            }
            usedNames.add(name)
            zip.file(name, blob)
          }
        } catch {
          // pojedyncze zdjecie moglo wygasnac/zniknac - pomijamy, reszta leci dalej
        }
        done += 1
        setDownloadAllProgress({ done, total: list.length })
      }
      const content = await zip.generateAsync({ type: 'blob' })
      const objectUrl = URL.createObjectURL(content)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `Statystyki-zmianowe_${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (e) {
      setDownloadAllError(e instanceof Error ? e.message : 'Nie udało się przygotować archiwum ZIP.')
    } finally {
      setDownloadingAll(false)
    }
  }

  // Eksport odczytow (nie samych zdjec) do Excela - jeden wiersz na kazdy odczytany
  // parametr, zeby dane dalo sie dalej filtrowac/analizowac poza aplikacja.
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportError, setExportError] = useState('')
  const handleExportExcel = async (list: PhotoRow[]) => {
    if (list.length === 0) return
    setExportingExcel(true)
    setExportError('')
    try {
      const [ExcelJS, allReadings] = await Promise.all([
        loadExcelJS(),
        fetchReadingsForPhotos(list.map(p => p.id))
      ])
      const readingsByPhoto = new Map<string, ShiftStatReading[]>()
      allReadings.forEach(r => {
        const arr = readingsByPhoto.get(r.photo_id) ?? []
        arr.push(r)
        readingsByPhoto.set(r.photo_id, arr)
      })

      const wb = new ExcelJS.Workbook()
      wb.creator = 'MargoLine MES'
      wb.created = new Date()
      const ws = wb.addWorksheet('Odczyty statystyk zmianowych')

      ws.mergeCells(1, 1, 1, 10)
      const title = ws.getCell(1, 1)
      title.value = 'Odczyty statystyk zmianowych'
      title.font = { name: 'Arial', bold: true, size: 13, color: { argb: GOLD } }
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
      title.alignment = { horizontal: 'center', vertical: 'middle' }
      ws.getRow(1).height = 26

      const headerRow = 3
      const columns = [
        { label: 'Data', width: 13 },
        { label: 'Zmiana', width: 9 },
        { label: 'Automat', width: 20 },
        { label: 'Moduł', width: 22 },
        { label: 'Operator', width: 20 },
        { label: 'Godzina zdjęcia', width: 16 },
        { label: 'Status OCR', width: 12 },
        { label: 'Etykieta odczytu', width: 24 },
        { label: 'Wartość', width: 16 },
        { label: 'Wartość liczbowa', width: 16 }
      ]
      columns.forEach((col, ci) => {
        const cell = ws.getCell(headerRow, ci + 1)
        cell.value = col.label
        cell.font = { name: 'Arial', bold: true, color: { argb: GOLD }, size: 9 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
        ws.getColumn(ci + 1).width = col.width
      })

      let row = headerRow + 1
      list
        .slice()
        .sort((a, b) => (b.captured_at ?? '').localeCompare(a.captured_at ?? ''))
        .forEach(photo => {
          const machineName = one(photo.machine)?.name ?? '—'
          const operatorName = one(photo.operator)?.full_name ?? '—'
          const moduleLabel = shiftStatModuleLabel(photo.module_key) ?? '—'
          const captured = new Date(photo.captured_at)
          const ocrStatusLabel = photo.ocr_status === 'done' ? 'Odczytane' : photo.ocr_status === 'failed' ? 'Błąd odczytu' : 'W trakcie'
          const readings = readingsByPhoto.get(photo.id) ?? []
          const values = readings.length ? readings : [null]
          values.forEach(reading => {
            const cells = [
              photo.shift_date ?? '',
              photo.shift_type ?? '',
              machineName,
              moduleLabel,
              operatorName,
              captured.toLocaleString('pl-PL'),
              ocrStatusLabel,
              reading?.metric_label ?? '—',
              reading ? (reading.corrected_value ?? reading.metric_value) : '',
              reading?.numeric_value ?? ''
            ]
            cells.forEach((value, ci) => {
              const cell = ws.getCell(row, ci + 1)
              cell.value = value
              cell.font = { name: 'Arial', size: 9 }
              cell.border = {
                top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
              }
            })
            row += 1
          })
        })

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Statystyki-zmianowe_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Nie udało się przygotować pliku Excel.')
    } finally {
      setExportingExcel(false)
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

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Szukaj po automacie, operatorze, dacie (RRRR-MM-DD)..."
          className="input w-full max-w-md"
        />
        <button
          onClick={() => handleDownloadAll(filtered)}
          disabled={downloadingAll || filtered.length === 0}
          className="shrink-0 rounded-xl border border-navy-600 bg-navy-900 px-4 py-2 text-sm font-bold text-navy-200 hover:border-brand/40 hover:text-brand transition-all disabled:opacity-40"
        >
          {downloadingAll
            ? `⤓ Pobieranie ${downloadAllProgress.done}/${downloadAllProgress.total}...`
            : `⤓ Pobierz wszystkie (${filtered.length})`}
        </button>
        <button
          onClick={() => handleExportExcel(filtered)}
          disabled={exportingExcel || filtered.length === 0}
          className="shrink-0 rounded-xl border border-navy-600 bg-navy-900 px-4 py-2 text-sm font-bold text-navy-200 hover:border-brand/40 hover:text-brand transition-all disabled:opacity-40"
        >
          {exportingExcel ? '⏳ Generowanie...' : '📊 Eksportuj do Excela'}
        </button>
      </div>

      {downloadAllError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{downloadAllError}</div>
      )}
      {exportError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{exportError}</div>
      )}

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
