import { useEffect, useState } from 'react'
import { Chart, BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Title } from 'chart.js'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { SHIFT_STAT_MODULES, shiftStatModuleLabel } from '@/components/operator/ShiftStatPhotosCard'
import { problemCategoryLabel, type ReportIssueType } from '@/lib/issueReports'
import type { Machine, ShiftStatPhoto, ShiftStatReading, ShiftType } from '@/types/database'

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Title)

const SHIFT_TYPES: ShiftType[] = ['I', 'II', 'III']

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

type ExportLang = 'pl' | 'en'

type ExportColumnKey =
  | 'date' | 'shift' | 'machine' | 'module' | 'operator' | 'capturedAt'
  | 'ocrStatus' | 'metricLabel' | 'value' | 'numericValue' | 'stationKey' | 'confirmed'

const EXPORT_COLUMN_DEFS: Record<ExportColumnKey, { label: string; labelEn: string; width: number }> = {
  date: { label: 'Data', labelEn: 'Date', width: 13 },
  shift: { label: 'Zmiana', labelEn: 'Shift', width: 9 },
  machine: { label: 'Automat', labelEn: 'Machine', width: 20 },
  module: { label: 'Moduł', labelEn: 'Module', width: 22 },
  operator: { label: 'Operator', labelEn: 'Operator', width: 20 },
  capturedAt: { label: 'Godzina zdjęcia', labelEn: 'Photo time', width: 16 },
  ocrStatus: { label: 'Status OCR', labelEn: 'OCR status', width: 12 },
  metricLabel: { label: 'Etykieta odczytu', labelEn: 'Reading label', width: 24 },
  value: { label: 'Wartość', labelEn: 'Value', width: 16 },
  numericValue: { label: 'Wartość liczbowa', labelEn: 'Numeric value', width: 16 },
  stationKey: { label: 'Stacja', labelEn: 'Station', width: 14 },
  confirmed: { label: 'Potwierdzone', labelEn: 'Confirmed', width: 14 }
}

const DEFAULT_EXPORT_COLUMNS: ExportColumnKey[] = [
  'date', 'shift', 'machine', 'module', 'operator', 'capturedAt', 'ocrStatus', 'metricLabel', 'value', 'numericValue'
]
const DEFAULT_EXPORT_COLUMN_SET = new Set<ExportColumnKey>(DEFAULT_EXPORT_COLUMNS)
const ALL_EXPORT_COLUMNS: ExportColumnKey[] = [...DEFAULT_EXPORT_COLUMNS, 'stationKey', 'confirmed']

const OCR_STATUS_LABELS: Record<ExportLang, Record<'done' | 'failed' | 'pending', string>> = {
  pl: { done: 'Odczytane', failed: 'Błąd odczytu', pending: 'W trakcie' },
  en: { done: 'Read', failed: 'Read error', pending: 'Pending' }
}

// "Zestaw"/"Komora" to nazwy modulow uzywane wewnetrznie (patrz SHIFT_STAT_MODULES) -
// producent/A1TEC zna je jako "Infusion Set"/"Drip Chamber", stad osobne etykiety EN.
function moduleLabelFor(key: string | null | undefined, lang: ExportLang): string {
  if (!key) return '—'
  if (lang === 'en') {
    if (key === 'zestaw') return 'Infusion Set'
    if (key === 'komora') return 'Drip Chamber'
    return key
  }
  return shiftStatModuleLabel(key) ?? key
}

// Angielskie tlumaczenia kategorii problemow - odpowiadaja 1:1 wartosciom w
// DOWNTIME_PROBLEM_CATEGORIES / REJECT_PROBLEM_CATEGORIES (src/lib/issueReports.ts).
// Polskie etykiety bierzemy z problemCategoryLabel(), zeby nie duplikowac tresci -
// tu trzymamy tylko wersje EN, ktorej nigdzie indziej w apce nie ma.
const DOWNTIME_CATEGORY_EN: Record<string, string> = {
  awaria_mechaniczna: 'Mechanical failure',
  awaria_elektryczna_czujnik: 'Electrical failure / sensor',
  problem_pneumatyczny: 'Pneumatic problem',
  problem_z_robotem: 'Robot problem',
  problem_z_kamera: 'Camera / vision problem',
  problem_z_podaniem_komponentu: 'Component feeding problem',
  problem_z_transportem: 'Transport / belt problem',
  problem_ze_zgrzewaniem: 'Welding problem',
  problem_z_cieciem: 'Cutting problem',
  problem_z_nawijaniem_drenu: 'Tube winding problem',
  problem_z_ustawieniami_procesu: 'Process settings problem',
  regulacja: 'Adjustment',
  przezbrojenie: 'Changeover',
  brak_materialu: 'Material shortage',
  brak_obsady: 'No operator',
  oczekiwanie_na_ur: 'Waiting for maintenance',
  oczekiwanie_na_decyzje_jakosc_technolog: 'Waiting for decision / quality / process engineer',
  inna_przyczyna: 'Other reason'
}

const REJECT_CATEGORY_EN: Record<string, string> = {
  odrzut_jakosciowy: 'Quality reject',
  falszywy_odrzut: 'False reject',
  problem_z_kamera: 'Camera problem',
  problem_z_czujnikiem: 'Sensor problem',
  nieprawidlowe_podanie_komponentu: 'Incorrect component feed',
  brak_komponentu: 'Missing component',
  nieprawidlowy_montaz_komponentu: 'Incorrect component assembly',
  problem_ze_zgrzewem: 'Weld problem',
  problem_z_dlugoscia_drenu: 'Tube length problem',
  problem_z_pozycjonowaniem_komponentu: 'Component positioning problem',
  problem_z_filtrem_odpowietrznika: 'Air vent filter problem',
  problem_z_oslonka_igly: 'Needle sheath problem',
  problem_z_komora: 'Drip chamber problem',
  problem_z_luer_lockiem: 'Luer lock problem',
  problem_z_rolka: 'Roller clamp problem',
  uszkodzenie_mechaniczne_wyrobu: 'Product mechanical damage',
  zabrudzenie_cialo_obce: 'Contamination / foreign object',
  problem_materialowy: 'Material problem',
  problem_po_regulacji: 'Problem after adjustment',
  problem_po_przezbrojeniu: 'Problem after changeover',
  inna_przyczyna: 'Other reason'
}

function classificationLabel(type: ReportIssueType, category: string, lang: ExportLang): string {
  if (lang === 'pl') return problemCategoryLabel(type, category)
  const map = type === 'downtime' ? DOWNTIME_CATEGORY_EN : REJECT_CATEGORY_EN
  return map[category] ?? category
}

function exportColumnValue(
  key: ExportColumnKey,
  photo: PhotoRow,
  reading: ShiftStatReading | null,
  lang: ExportLang
): string | number {
  switch (key) {
    case 'date': return photo.shift_date ?? ''
    case 'shift': return photo.shift_type ?? ''
    case 'machine': return one(photo.machine)?.name ?? '—'
    case 'module': return moduleLabelFor(photo.module_key, lang)
    case 'operator': return one(photo.operator)?.full_name ?? '—'
    case 'capturedAt': return new Date(photo.captured_at).toLocaleString(lang === 'en' ? 'en-GB' : 'pl-PL')
    case 'ocrStatus': return OCR_STATUS_LABELS[lang][photo.ocr_status]
    case 'metricLabel': return reading?.metric_label ?? '—'
    case 'value': return reading ? (reading.corrected_value ?? reading.metric_value) : ''
    case 'numericValue': return reading?.numeric_value ?? ''
    case 'stationKey': return reading?.station_key ?? ''
    case 'confirmed': return reading ? (reading.confirmed ? (lang === 'en' ? 'Yes' : 'Tak') : (lang === 'en' ? 'No' : 'Nie')) : ''
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

type PhotoFilters = {
  machineId: string
  moduleKey: string
  shiftType: string
  ocrStatus: string
  dateFrom: string
  dateTo: string
}

async function fetchPhotos(filters: PhotoFilters) {
  let query = supabase
    .from('shift_stat_photos')
    .select('*, machine:machines(name), operator:profiles!operator_id(full_name)')
    .order('captured_at', { ascending: false })
    .limit(300)
  if (filters.machineId) query = query.eq('machine_id', filters.machineId)
  if (filters.moduleKey) query = query.eq('module_key', filters.moduleKey)
  if (filters.shiftType) query = query.eq('shift_type', filters.shiftType)
  if (filters.ocrStatus) query = query.eq('ocr_status', filters.ocrStatus)
  if (filters.dateFrom) query = query.gte('shift_date', filters.dateFrom)
  if (filters.dateTo) query = query.lte('shift_date', filters.dateTo)
  const { data } = await query
  return (data ?? []) as PhotoRow[]
}

async function fetchMachines() {
  const { data } = await supabase.from('machines').select('*').is('deleted_at', null).order('name')
  return (data ?? []) as Machine[]
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

type ShiftProblemInfo = { downtimeMin: number; text: string }

// Jedno, wspolne zrodlo "co sie dzialo" dla calego eksportu (kolumna Opis, arkusz
// Shift Summary) - laczy WYLACZNIE to, co operatorzy juz wpisali (downtime_reason,
// reject_reason, notes co godzine + notatka zamkniecia zmiany), bez AI i bez zmiany
// tresci. Pokazuje sie dla KAZDEJ zmiany, w ktorej padl choc jeden taki wpis.
async function fetchShiftProblems(shiftIds: string[]) {
  const uniqueIds = [...new Set(shiftIds)]
  const result = new Map<string, ShiftProblemInfo>()
  if (!uniqueIds.length) return result

  const [{ data: shiftsData }, { data: reportsData }] = await Promise.all([
    supabase.from('shifts').select('id, summary_downtime_min, summary_notes').in('id', uniqueIds),
    supabase
      .from('hourly_reports')
      .select('shift_id, hour_block, hour_start, downtime_reason, reject_reason, notes')
      .in('shift_id', uniqueIds)
      .is('deleted_at', null)
      .order('hour_start')
  ])

  const shiftInfoById = new Map((shiftsData ?? []).map(s => [s.id, s]))

  const segmentsByShift = new Map<string, { hourStart: number; text: string }[]>()
  ;(reportsData ?? []).forEach(r => {
    const segs = segmentsByShift.get(r.shift_id) ?? []
    if (r.downtime_reason?.trim()) segs.push({ hourStart: r.hour_start, text: `${r.hour_block} [Downtime]: ${r.downtime_reason.trim()}` })
    if (r.reject_reason?.trim()) segs.push({ hourStart: r.hour_start, text: `${r.hour_block} [Reject]: ${r.reject_reason.trim()}` })
    if (r.notes?.trim()) segs.push({ hourStart: r.hour_start, text: `${r.hour_block} [Note]: ${r.notes.trim()}` })
    segmentsByShift.set(r.shift_id, segs)
  })

  uniqueIds.forEach(shiftId => {
    const shiftInfo = shiftInfoById.get(shiftId)
    const segs = (segmentsByShift.get(shiftId) ?? []).sort((a, b) => a.hourStart - b.hourStart).map(s => s.text)
    if (shiftInfo?.summary_notes?.trim()) segs.push(`Shift-end note: ${shiftInfo.summary_notes.trim()}`)
    result.set(shiftId, {
      downtimeMin: shiftInfo?.summary_downtime_min ?? 0,
      text: segs.join(' | ')
    })
  })

  return result
}

function formatMinutes(value: number): string {
  const total = Math.max(0, Math.round(value || 0))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

type MachineHourStat = { hourStart: number; hourBlock: string; avgEfficiency: number; avgGoodCount: number; entries: number }
type MachineClassification = { type: ReportIssueType; category: string; count: number }

// Wydajnosc godzinowa bierzemy z hourly_reports.efficiency_pct/good_count - to jedyne
// realnie godzinowe dane produkcyjne w systemie (odczyty z ekranu PLC sa robione raz na
// zmiane, nie co godzine). Uśredniamy po godzinie-dnia (0-23) w calym eksportowanym
// zakresie dat, zeby wykres mial sens rowniez dla eksportu obejmujacego wiele dni. Przy
// okazji tego samego zapytania liczymy tez wystapienia kazdej kategorii problemu
// (downtime_category / reject_category) per automat - do klasyfikacji obok wykresu.
async function fetchMachineHourlyStats(machineIds: string[], dateFrom: string, dateTo: string) {
  const stats = new Map<string, MachineHourStat[]>()
  const classifications = new Map<string, MachineClassification[]>()
  if (!machineIds.length || !dateFrom || !dateTo) return { stats, classifications }

  const { data } = await supabase
    .from('hourly_reports')
    .select('machine_id, hour_start, hour_block, report_date, efficiency_pct, good_count, downtime_reason, downtime_category, reject_reason, reject_category')
    .in('machine_id', machineIds)
    .gte('report_date', dateFrom)
    .lte('report_date', dateTo)
    .is('deleted_at', null)
    .order('report_date')
    .order('hour_start')

  const byMachine = new Map<string, Map<number, { hourBlock: string; effSum: number; goodSum: number; count: number }>>()
  const classificationCounts = new Map<string, Map<string, number>>()
  const bumpClassification = (machineId: string, type: ReportIssueType, category: string) => {
    const key = `${type}|${category}`
    const machineCounts = classificationCounts.get(machineId) ?? new Map<string, number>()
    machineCounts.set(key, (machineCounts.get(key) ?? 0) + 1)
    classificationCounts.set(machineId, machineCounts)
  }

  ;(data ?? []).forEach(r => {
    const machineMap = byMachine.get(r.machine_id) ?? new Map<number, { hourBlock: string; effSum: number; goodSum: number; count: number }>()
    const hourEntry = machineMap.get(r.hour_start) ?? { hourBlock: r.hour_block, effSum: 0, goodSum: 0, count: 0 }
    hourEntry.effSum += Number(r.efficiency_pct) || 0
    hourEntry.goodSum += Number(r.good_count) || 0
    hourEntry.count += 1
    machineMap.set(r.hour_start, hourEntry)
    byMachine.set(r.machine_id, machineMap)

    if (r.downtime_reason?.trim()) bumpClassification(r.machine_id, 'downtime', r.downtime_category || 'inna_przyczyna')
    if (r.reject_reason?.trim()) bumpClassification(r.machine_id, 'reject', r.reject_category || 'inna_przyczyna')
  })

  classificationCounts.forEach((counts, machineId) => {
    const rows = [...counts.entries()]
      .map(([key, count]) => {
        const [type, category] = key.split('|') as [ReportIssueType, string]
        return { type, category, count }
      })
      .sort((a, b) => b.count - a.count)
    classifications.set(machineId, rows)
  })

  byMachine.forEach((hourMap, machineId) => {
    const machineStats = [...hourMap.entries()]
      .map(([hourStart, e]) => ({
        hourStart,
        hourBlock: e.hourBlock,
        avgEfficiency: Math.round((e.effSum / e.count) * 10) / 10,
        avgGoodCount: Math.round(e.goodSum / e.count),
        entries: e.count
      }))
      .sort((a, b) => a.hourStart - b.hourStart)
    stats.set(machineId, machineStats)
  })

  return { stats, classifications }
}

function sanitizeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31)
}

// Renderuje wykres na oderwanym (nie dolaczonym do DOM) canvasie i zwraca PNG jako
// base64 - Chart.js rysuje synchronicznie przy animation:false, wiec nie trzeba czekac
// na zaden async callback przed odczytaniem obrazu.
const HOURLY_CHART_LABELS: Record<ExportLang, { title: string; pieces: string; efficiency: string; piecesAxis: string; effAxis: string }> = {
  en: { title: 'Hourly performance', pieces: 'Pieces (avg)', efficiency: 'Efficiency %', piecesAxis: 'Pieces', effAxis: 'Efficiency %' },
  pl: { title: 'Wydajność godzinowa', pieces: 'Sztuki (śr.)', efficiency: 'Wydajność %', piecesAxis: 'Sztuki', effAxis: 'Wydajność %' }
}

function renderHourlyPerformanceChart(machineName: string, stats: MachineHourStat[], lang: ExportLang): string {
  const labels = HOURLY_CHART_LABELS[lang]
  const canvas = document.createElement('canvas')
  canvas.width = 900
  canvas.height = 420
  const chart = new Chart(canvas, {
    data: {
      labels: stats.map(s => s.hourBlock),
      datasets: [
        {
          type: 'bar',
          label: labels.pieces,
          data: stats.map(s => s.avgGoodCount),
          backgroundColor: '#93c5fd',
          yAxisID: 'y'
        },
        {
          type: 'line',
          label: labels.efficiency,
          data: stats.map(s => s.avgEfficiency),
          borderColor: '#2563eb',
          backgroundColor: '#2563eb',
          yAxisID: 'y1',
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: { display: true, position: 'bottom' },
        title: { display: true, text: `${machineName} - ${labels.title}`, font: { size: 16 } }
      },
      scales: {
        y: { beginAtZero: true, position: 'left', title: { display: true, text: labels.piecesAxis } },
        y1: { beginAtZero: true, position: 'right', grid: { display: false }, title: { display: true, text: labels.effAxis }, ticks: { callback: value => `${value}%` } }
      }
    }
  })
  const base64 = chart.toBase64Image()
  chart.destroy()
  return base64.replace(/^data:image\/png;base64,/, '')
}

export default function ManagerShiftStatPhotos() {
  const [photos, setPhotos] = useState<PhotoRow[]>([])
  const [machines, setMachines] = useState<Machine[]>([])
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Filtry pobierane wprost z bazy (nie tylko dofiltrowanie tego co juz zaladowane) -
  // dzieki temu wybor automatu/modulu/zakresu dat obejmuje realnie wszystkie pasujace
  // zdjecia, a nie tylko te z ostatnich 300 zaladowanych rekordow.
  const [filterMachineId, setFilterMachineId] = useState('')
  const [filterModule, setFilterModule] = useState('')
  const [filterShift, setFilterShift] = useState('')
  const [filterOcrStatus, setFilterOcrStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

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

  useEffect(() => { fetchMachines().then(setMachines) }, [])
  useEffect(() => { load() }, [filterMachineId, filterModule, filterShift, filterOcrStatus, dateFrom, dateTo])

  const load = async () => {
    setLoading(true)
    const list = await fetchPhotos({
      machineId: filterMachineId,
      moduleKey: filterModule,
      shiftType: filterShift,
      ocrStatus: filterOcrStatus,
      dateFrom,
      dateTo
    })
    setPhotos(list)
    setSelectedIds(new Set())
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
      const shiftIds = list.map(p => p.shift_id).filter((id): id is string => !!id)
      const machineIds = [...new Set(list.map(p => p.machine_id))]
      const shiftDates = list.map(p => p.shift_date).filter((d): d is string => !!d)
      const hourlyDateFrom = shiftDates.length ? shiftDates.reduce((a, b) => (a < b ? a : b)) : ''
      const hourlyDateTo = shiftDates.length ? shiftDates.reduce((a, b) => (a > b ? a : b)) : ''

      const [ExcelJS, allReadings, descriptionByShift, { stats: hourlyStatsByMachine, classifications: hourlyStatsClassifications }] = await Promise.all([
        loadExcelJS(),
        fetchReadingsForPhotos(list.map(p => p.id)),
        fetchShiftProblems(shiftIds),
        fetchMachineHourlyStats(machineIds, hourlyDateFrom, hourlyDateTo)
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

      const buildSheet = (sheetName: string, titleText: string, photos: PhotoRow[], lang: ExportLang) => {
        const ws = wb.addWorksheet(sheetName)

        ws.mergeCells(1, 1, 1, columns.length)
        const title = ws.getCell(1, 1)
        title.value = titleText
        title.font = { name: 'Arial', bold: true, size: 13, color: { argb: GOLD } }
        title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
        title.alignment = { horizontal: 'center', vertical: 'middle' }
        ws.getRow(1).height = 26

        const headerRow = 3
        columns.forEach((key, ci) => {
          const def = EXPORT_COLUMN_DEFS[key]
          const cell = ws.getCell(headerRow, ci + 1)
          cell.value = lang === 'en' ? def.labelEn : def.label
          cell.font = { name: 'Arial', bold: true, color: { argb: GOLD }, size: 9 }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
          ws.getColumn(ci + 1).width = def.width
        })

        let row = headerRow + 1
        photos
          .slice()
          .sort((a, b) => (b.captured_at ?? '').localeCompare(a.captured_at ?? ''))
          .forEach(photo => {
            const photoReadings = readingsByPhoto.get(photo.id) ?? []
            const values = photoReadings.length ? photoReadings : [null]
            values.forEach(reading => {
              columns.forEach((key, ci) => {
                const cell = ws.getCell(row, ci + 1)
                cell.value = exportColumnValue(key, photo, reading, lang)
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
      }

      // Shift Summary - GLOWNY, czytelny przeglad: jeden wiersz na zmiane (nie na odczyt),
      // z tym samym polaczonym opisem "co sie dzialo" co kolumna Opis w arkuszach ponizej.
      // Budowany raz per jezyk (EN i PL na osobnych arkuszach), EN dodawany jako pierwszy
      // arkusz, wiec to on sie pokazuje po otwarciu pliku.
      const photosByShift = new Map<string, PhotoRow[]>()
      list.forEach(photo => {
        if (!photo.shift_id) return
        const arr = photosByShift.get(photo.shift_id) ?? []
        arr.push(photo)
        photosByShift.set(photo.shift_id, arr)
      })

      const SHIFT_SUMMARY_LABELS: Record<ExportLang, { title: string; columns: string[]; noIssues: string }> = {
        en: {
          title: 'Shift Summary - what happened, what was the problem',
          columns: ['Date', 'Shift', 'Machine', 'Downtime', 'Modules', 'Problem summary'],
          noIssues: 'No issues reported'
        },
        pl: {
          title: 'Podsumowanie zmiany - co się działo, co było problemem',
          columns: ['Data', 'Zmiana', 'Automat', 'Postój', 'Moduły', 'Podsumowanie problemu'],
          noIssues: 'Brak zgłoszonych problemów'
        }
      }

      const buildShiftSummarySheet = (sheetName: string, lang: ExportLang) => {
        const labels = SHIFT_SUMMARY_LABELS[lang]
        const summaryWs = wb.addWorksheet(sheetName)
        summaryWs.mergeCells(1, 1, 1, 6)
        const summaryTitle = summaryWs.getCell(1, 1)
        summaryTitle.value = labels.title
        summaryTitle.font = { name: 'Arial', bold: true, size: 13, color: { argb: GOLD } }
        summaryTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
        summaryTitle.alignment = { horizontal: 'center', vertical: 'middle' }
        summaryWs.getRow(1).height = 26

        const summaryHeaderRow = 3
        const summaryColumnWidths = [13, 9, 20, 12, 22, 100]
        labels.columns.forEach((label, ci) => {
          const cell = summaryWs.getCell(summaryHeaderRow, ci + 1)
          cell.value = label
          cell.font = { name: 'Arial', bold: true, color: { argb: GOLD }, size: 9 }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
          summaryWs.getColumn(ci + 1).width = summaryColumnWidths[ci]
        })

        const summaryRows = [...photosByShift.entries()]
          .map(([shiftId, shiftPhotos]) => {
            const first = shiftPhotos[0]
            const problem = descriptionByShift.get(shiftId)
            return {
              date: first.shift_date ?? '',
              shiftType: first.shift_type ?? '',
              machineName: one(first.machine)?.name ?? '—',
              downtimeMin: problem?.downtimeMin ?? 0,
              modules: [...new Set(shiftPhotos.map(p => p.module_key).filter((k): k is string => !!k))]
                .map(k => moduleLabelFor(k, lang)).join(', '),
              problemSummary: problem?.text || labels.noIssues
            }
          })
          .sort((a, b) => a.date.localeCompare(b.date) || a.machineName.localeCompare(b.machineName) || a.shiftType.localeCompare(b.shiftType))

        let summaryRow = summaryHeaderRow + 1
        summaryRows.forEach(r => {
          const cells = [r.date, r.shiftType, r.machineName, formatMinutes(r.downtimeMin), r.modules, r.problemSummary]
          cells.forEach((value, ci) => {
            const cell = summaryWs.getCell(summaryRow, ci + 1)
            cell.value = value
            cell.font = ci === 3 && r.downtimeMin > 120
              ? { name: 'Arial', size: 9, bold: true, color: { argb: 'FFDC2626' } }
              : { name: 'Arial', size: 9 }
            cell.alignment = { wrapText: ci === 5, vertical: 'top' }
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
              bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
              left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
              right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
            }
          })
          summaryRow += 1
        })
      }

      buildShiftSummarySheet('Shift Summary', 'en')
      buildShiftSummarySheet('Podsumowanie zmiany', 'pl')

      const zestawPhotos = list.filter(p => p.module_key === 'zestaw')
      const komoraPhotos = list.filter(p => p.module_key === 'komora')

      buildSheet('Zestaw', 'Statystyki zmianowe - Zestaw', zestawPhotos, 'pl')
      buildSheet('Komora', 'Statystyki zmianowe - Komora kroplowa', komoraPhotos, 'pl')
      buildSheet('Infusion Set', 'Shift statistics - Infusion Set', zestawPhotos, 'en')
      buildSheet('Drip Chamber', 'Shift statistics - Drip Chamber', komoraPhotos, 'en')

      // Wykresy wydajnosci godzinowej - para arkuszy (EN + PL) na kazdy automat obecny
      // w eksporcie. Pod wykresem - klasyfikacja WSZYSTKICH odnotowanych problemow
      // (kategoria z downtime_category/reject_category, nie surowy tekst), posortowana
      // malejaco wg liczby wystapien - zeby od razu bylo widac najczestszy typ problemu.
      const CLASSIFICATION_LABELS: Record<ExportLang, { header: string[]; typeDowntime: string; typeReject: string; empty: string }> = {
        en: { header: ['Type', 'Category', 'Occurrences'], typeDowntime: 'Downtime', typeReject: 'Reject', empty: 'No classified problems recorded for this range.' },
        pl: { header: ['Typ', 'Kategoria', 'Liczba wystąpień'], typeDowntime: 'Postój', typeReject: 'Odrzut', empty: 'Brak sklasyfikowanych problemów w tym zakresie.' }
      }

      machineIds.forEach(machineId => {
        const stats = hourlyStatsByMachine.get(machineId) ?? []
        if (!stats.length) return
        const machineName = machines.find(m => m.id === machineId)?.name
          ?? one(list.find(p => p.machine_id === machineId)?.machine)?.name
          ?? 'Machine'
        const classificationRows = hourlyStatsClassifications.get(machineId) ?? []

        ;(['en', 'pl'] as ExportLang[]).forEach(lang => {
          const labels = CLASSIFICATION_LABELS[lang]
          const sheetSuffix = lang === 'en' ? 'Hourly Performance' : 'Wydajność godzinowa'
          const base64 = renderHourlyPerformanceChart(machineName, stats, lang)
          const imageId = wb.addImage({ base64, extension: 'png' })
          const chartWs = wb.addWorksheet(sanitizeSheetName(`${machineName} - ${sheetSuffix}`))
          chartWs.addImage(imageId, 'A1:L24')

          const tableHeaderRow = 26
          const colWidths = [14, 40, 16]
          labels.header.forEach((label, ci) => {
            const cell = chartWs.getCell(tableHeaderRow, ci + 1)
            cell.value = label
            cell.font = { name: 'Arial', bold: true, color: { argb: GOLD }, size: 9 }
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
            cell.alignment = { horizontal: 'center', vertical: 'middle' }
            chartWs.getColumn(ci + 1).width = colWidths[ci]
          })

          let tableRow = tableHeaderRow + 1
          if (classificationRows.length) {
            classificationRows.forEach(row => {
              const cells = [
                row.type === 'downtime' ? labels.typeDowntime : labels.typeReject,
                classificationLabel(row.type, row.category, lang),
                row.count
              ]
              cells.forEach((value, ci) => {
                const cell = chartWs.getCell(tableRow, ci + 1)
                cell.value = value
                cell.font = { name: 'Arial', size: 9 }
                cell.alignment = { vertical: 'top' }
                cell.border = {
                  top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                  bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                  left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                  right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
                }
              })
              tableRow += 1
            })
          } else {
            const cell = chartWs.getCell(tableRow, 1)
            cell.value = labels.empty
            cell.font = { name: 'Arial', italic: true, size: 9, color: { argb: 'FF6B7280' } }
          }
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

  const filtersActive = filterMachineId || filterModule || filterShift || filterOcrStatus || dateFrom || dateTo
  const clearFilters = () => {
    setFilterMachineId('')
    setFilterModule('')
    setFilterShift('')
    setFilterOcrStatus('')
    setDateFrom('')
    setDateTo('')
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Zdjęcia statystyk zmianowych</h1>
        <p className="text-navy-400 mt-1">{filtered.length} z {photos.length} załadowanych zdjęć</p>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Filtry</div>
          {!!filtersActive && (
            <button onClick={clearFilters} className="text-xs font-bold text-navy-400 hover:text-brand">✕ Wyczyść filtry</button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <label className="label">Automat</label>
            <select value={filterMachineId} onChange={e => setFilterMachineId(e.target.value)} className="input">
              <option value="">Wszystkie automaty</option>
              {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Moduł</label>
            <select value={filterModule} onChange={e => setFilterModule(e.target.value)} className="input">
              <option value="">Wszystkie moduły</option>
              {SHIFT_STAT_MODULES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Zmiana</label>
            <select value={filterShift} onChange={e => setFilterShift(e.target.value)} className="input">
              <option value="">Wszystkie zmiany</option>
              {SHIFT_TYPES.map(s => <option key={s} value={s}>Zmiana {s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Status OCR</label>
            <select value={filterOcrStatus} onChange={e => setFilterOcrStatus(e.target.value)} className="input">
              <option value="">Wszystkie statusy</option>
              <option value="done">Odczytane</option>
              <option value="failed">Błąd odczytu</option>
              <option value="pending">W trakcie</option>
            </select>
          </div>
          <div>
            <label className="label">Data od</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Data do</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Szukaj w załadowanych po automacie, operatorze, dacie..."
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
