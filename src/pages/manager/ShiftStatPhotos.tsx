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

type ExportColumnKey =
  | 'date' | 'shift' | 'machine' | 'module' | 'operator' | 'capturedAt'
  | 'ocrStatus' | 'metricLabel' | 'value' | 'numericValue' | 'stationKey' | 'confirmed'

const EXPORT_COLUMN_DEFS: Record<ExportColumnKey, { label: string; width: number }> = {
  date: { label: 'Data', width: 13 },
  shift: { label: 'Zmiana', width: 9 },
  machine: { label: 'Automat', width: 20 },
  module: { label: 'Moduł', width: 22 },
  operator: { label: 'Operator', width: 20 },
  capturedAt: { label: 'Godzina zdjęcia', width: 16 },
  ocrStatus: { label: 'Status OCR', width: 12 },
  metricLabel: { label: 'Etykieta odczytu', width: 24 },
  value: { label: 'Wartość', width: 16 },
  numericValue: { label: 'Wartość liczbowa', width: 16 },
  stationKey: { label: 'Stacja', width: 14 },
  confirmed: { label: 'Potwierdzone', width: 14 }
}

const DEFAULT_EXPORT_COLUMNS: ExportColumnKey[] = [
  'date', 'shift', 'machine', 'module', 'operator', 'capturedAt', 'ocrStatus', 'metricLabel', 'value', 'numericValue'
]
const DEFAULT_EXPORT_COLUMN_SET = new Set<ExportColumnKey>(DEFAULT_EXPORT_COLUMNS)
const ALL_EXPORT_COLUMNS: ExportColumnKey[] = [...DEFAULT_EXPORT_COLUMNS, 'stationKey', 'confirmed']

function exportColumnValue(key: ExportColumnKey, photo: PhotoRow, reading: ShiftStatReading | null): string | number {
  switch (key) {
    case 'date': return photo.shift_date ?? ''
    case 'shift': return photo.shift_type ?? ''
    case 'machine': return one(photo.machine)?.name ?? '—'
    case 'module': return shiftStatModuleLabel(photo.module_key) ?? '—'
    case 'operator': return one(photo.operator)?.full_name ?? '—'
    case 'capturedAt': return new Date(photo.captured_at).toLocaleString('pl-PL')
    case 'ocrStatus': return photo.ocr_status === 'done' ? 'Odczytane' : photo.ocr_status === 'failed' ? 'Błąd odczytu' : 'W trakcie'
    case 'metricLabel': return reading?.metric_label ?? '—'
    case 'value': return reading ? (reading.corrected_value ?? reading.metric_value) : ''
    case 'numericValue': return reading?.numeric_value ?? ''
    case 'stationKey': return reading?.station_key ?? ''
    case 'confirmed': return reading ? (reading.confirmed ? 'Tak' : 'Nie') : ''
    default: return ''
  }
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

  // Zaznaczenie konkretnych zdjec do eksportu/pobrania - pusty zbior oznacza
  // "wszystkie aktualnie widoczne po filtrze" (dotychczasowe zachowanie).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Konfiguracja kolumn eksportu do Excela - kolejnosc pelnej listy + zbior wlaczonych.
  const [showColumnConfig, setShowColumnConfig] = useState(false)
  const [columnOrder, setColumnOrder] = useState<ExportColumnKey[]>(ALL_EXPORT_COLUMNS)
  const [enabledColumns, setEnabledColumns] = useState<Set<ExportColumnKey>>(new Set(DEFAULT_EXPORT_COLUMN_SET))
  const toggleColumn = (key: ExportColumnKey) => {
    setEnabledColumns(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  const moveColumn = (key: ExportColumnKey, direction: -1 | 1) => {
    setColumnOrder(prev => {
      const index = prev.indexOf(key)
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = prev.slice()
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

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
  const handleExportExcel = async (list: PhotoRow[], columns: ExportColumnKey[]) => {
    if (list.length === 0 || columns.length === 0) return
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

      ws.mergeCells(1, 1, 1, columns.length)
      const title = ws.getCell(1, 1)
      title.value = 'Odczyty statystyk zmianowych'
      title.font = { name: 'Arial', bold: true, size: 13, color: { argb: GOLD } }
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
      title.alignment = { horizontal: 'center', vertical: 'middle' }
      ws.getRow(1).height = 26

      const headerRow = 3
      columns.forEach((key, ci) => {
        const def = EXPORT_COLUMN_DEFS[key]
        const cell = ws.getCell(headerRow, ci + 1)
        cell.value = def.label
        cell.font = { name: 'Arial', bold: true, color: { argb: GOLD }, size: 9 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
        ws.getColumn(ci + 1).width = def.width
      })

      let row = headerRow + 1
      list
        .slice()
        .sort((a, b) => (b.captured_at ?? '').localeCompare(a.captured_at ?? ''))
        .forEach(photo => {
          const photoReadings = readingsByPhoto.get(photo.id) ?? []
          const values = photoReadings.length ? photoReadings : [null]
          values.forEach(reading => {
            columns.forEach((key, ci) => {
              const cell = ws.getCell(row, ci + 1)
              cell.value = exportColumnValue(key, photo, reading)
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

  // Pusty wybor = dzialaj na wszystkim co widoczne po filtrze (jak dotychczas);
  // zaznaczenie konkretnych zdjec zawezalo dzialanie tylko do nich.
  const exportTargets = selectedIds.size > 0 ? filtered.filter(p => selectedIds.has(p.id)) : filtered
  const activeColumns = columnOrder.filter(key => enabledColumns.has(key))

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
          onClick={() => setSelectedIds(selectedIds.size > 0 ? new Set() : new Set(filtered.map(p => p.id)))}
          className="shrink-0 rounded-xl border border-navy-600 bg-navy-900 px-4 py-2 text-sm font-bold text-navy-200 hover:border-brand/40 hover:text-brand transition-all"
        >
          {selectedIds.size > 0 ? `✕ Wyczyść zaznaczenie (${selectedIds.size})` : '☑ Zaznacz wszystkie widoczne'}
        </button>
        <button
          onClick={() => setShowColumnConfig(v => !v)}
          className="shrink-0 rounded-xl border border-navy-600 bg-navy-900 px-4 py-2 text-sm font-bold text-navy-200 hover:border-brand/40 hover:text-brand transition-all"
        >
          ⚙ Kolumny eksportu ({activeColumns.length})
        </button>
        <button
          onClick={() => handleDownloadAll(exportTargets)}
          disabled={downloadingAll || exportTargets.length === 0}
          className="shrink-0 rounded-xl border border-navy-600 bg-navy-900 px-4 py-2 text-sm font-bold text-navy-200 hover:border-brand/40 hover:text-brand transition-all disabled:opacity-40"
        >
          {downloadingAll
            ? `⤓ Pobieranie ${downloadAllProgress.done}/${downloadAllProgress.total}...`
            : `⤓ Pobierz ${selectedIds.size > 0 ? 'zaznaczone' : 'wszystkie'} (${exportTargets.length})`}
        </button>
        <button
          onClick={() => handleExportExcel(exportTargets, activeColumns)}
          disabled={exportingExcel || exportTargets.length === 0 || activeColumns.length === 0}
          className="shrink-0 rounded-xl border border-navy-600 bg-navy-900 px-4 py-2 text-sm font-bold text-navy-200 hover:border-brand/40 hover:text-brand transition-all disabled:opacity-40"
        >
          {exportingExcel ? '⏳ Generowanie...' : `📊 Eksportuj do Excela (${exportTargets.length})`}
        </button>
      </div>

      {showColumnConfig && (
        <div className="card space-y-2">
          <div className="card-title text-sm">Kolumny w pliku Excel</div>
          <div className="card-sub mb-2">Zaznacz kolumny do uwzględnienia i ustaw ich kolejność strzałkami</div>
          <div className="space-y-1">
            {columnOrder.map((key, index) => (
              <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-navy-700 bg-navy-900 px-3 py-2">
                <label className="flex items-center gap-2 text-sm text-navy-200">
                  <input type="checkbox" checked={enabledColumns.has(key)} onChange={() => toggleColumn(key)} />
                  {EXPORT_COLUMN_DEFS[key].label}
                </label>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => moveColumn(key, -1)}
                    disabled={index === 0}
                    className="rounded-md border border-navy-700 px-2 py-1 text-xs text-navy-300 hover:border-brand/40 hover:text-brand disabled:opacity-30"
                  >↑</button>
                  <button
                    onClick={() => moveColumn(key, 1)}
                    disabled={index === columnOrder.length - 1}
                    className="rounded-md border border-navy-700 px-2 py-1 text-xs text-navy-300 hover:border-brand/40 hover:text-brand disabled:opacity-30"
                  >↓</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
            <div key={photo.id} className="card relative p-3 hover:border-brand/40 transition-all">
              <label
                className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-navy-600 bg-navy-900/90"
                onClick={e => e.stopPropagation()}
              >
                <input type="checkbox" checked={selectedIds.has(photo.id)} onChange={() => toggleSelected(photo.id)} />
              </label>
              <button onClick={() => openDetail(photo)} className="block w-full text-left">
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
            </div>
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
