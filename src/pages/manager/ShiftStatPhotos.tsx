import { useEffect, useState } from 'react'
import { Chart, BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Title } from 'chart.js'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { SHIFT_STAT_MODULES, shiftStatModuleLabel } from '@/components/operator/ShiftStatPhotosCard'
import { problemCategoryLabel, stationLabel, type ReportIssueType } from '@/lib/issueReports'
import type { IssueStationAllocation, Machine, ShiftStatPhoto, ShiftStatReading, ShiftType } from '@/types/database'

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

const OCR_STATUS_LABELS: Record<ExportLang, Record<'done' | 'failed' | 'pending', string>> = {
  pl: { done: 'Odczytane', failed: 'Błąd odczytu', pending: 'W trakcie' },
  en: { done: 'Read', failed: 'Read error', pending: 'Pending' }
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

// EN dla ogolnych przyczyn (GENERAL_CATEGORIES w issueReports.ts) - stacje numeryczne
// ("Stacja 15") tlumaczymy mechanicznie, bo to tylko numer.
const GENERAL_CATEGORY_EN: Record<string, string> = {
  gc_brak_obsady: 'No operator',
  gc_brak_materialu: 'Material shortage',
  gc_przezbrojenie: 'Changeover',
  gc_oczekiwanie_ur: 'Waiting for maintenance',
  gc_oczekiwanie_decyzje: 'Waiting for decision',
  gc_oczekiwanie_jakosc: 'Waiting for quality',
  gc_oczekiwanie_technolog: 'Waiting for process engineer',
  gc_testy_proby: 'Tests / trials',
  gc_czyszczenie: 'Machine cleaning',
  gc_planowany_postoj: 'Planned downtime',
  gc_inny: 'Other reason / needs clarification'
}

function stationLabelFor(value: string | null | undefined, lang: ExportLang): string {
  if (!value) return '—'
  if (lang === 'pl') return stationLabel(value)
  if (value.startsWith('st_')) return `Station ${value.slice(3)}`
  return GENERAL_CATEGORY_EN[value] ?? stationLabel(value)
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

type ShiftProblemInfo = {
  runtimeMin: number
  alarmMin: number
  downtimeMin: number
  goodCount: number
  rejectCount: number
  topStations: string[]
  text: string
}

// Jedno, wspolne zrodlo danych per zmiana dla arkusza Shift Summary / Podsumowanie
// zmiany - laczy czas pracy/alarmy/przestoje (WYLACZNIE z podsumowania zmiany, ten sam
// autorytatywny zapis co reszta raportow w apce), produkcje/odrzut (suma z wpisow
// godzinowych) i stacje generujace najwieksze straty (wazone udzialem % z wielostacyjnych
// zgloszen). Opis "co sie dzialo" - WYLACZNIE to, co operatorzy juz wpisali, bez AI.
function stationWeight(allocations: IssueStationAllocation[] | null | undefined, single: string | null | undefined): { station: string; weight: number }[] {
  if (allocations && allocations.length) {
    return allocations
      .filter(a => a.station)
      .map(a => ({ station: a.station, weight: Math.max(0, Math.min(100, Number(a.pct) || 0)) / 100 }))
  }
  return single ? [{ station: single, weight: 1 }] : []
}

async function fetchShiftProblems(shiftIds: string[]) {
  const uniqueIds = [...new Set(shiftIds)]
  const result = new Map<string, ShiftProblemInfo>()
  if (!uniqueIds.length) return result

  const [{ data: shiftsData }, { data: reportsData }] = await Promise.all([
    supabase.from('shifts').select('id, summary_runtime_min, summary_alarm_min, summary_downtime_min, summary_notes').in('id', uniqueIds),
    supabase
      .from('hourly_reports')
      .select('shift_id, hour_block, hour_start, downtime_reason, downtime_station, downtime_stations, reject_reason, reject_station, reject_stations, notes, good_count, reject_count')
      .in('shift_id', uniqueIds)
      .is('deleted_at', null)
      .order('hour_start')
  ])

  const shiftInfoById = new Map((shiftsData ?? []).map(s => [s.id, s]))

  const segmentsByShift = new Map<string, { hourStart: number; text: string }[]>()
  const countsByShift = new Map<string, { good: number; reject: number }>()
  const stationWeightsByShift = new Map<string, Map<string, number>>()

  const bumpStation = (shiftId: string, station: string, weight: number) => {
    const map = stationWeightsByShift.get(shiftId) ?? new Map<string, number>()
    map.set(station, (map.get(station) ?? 0) + weight)
    stationWeightsByShift.set(shiftId, map)
  }

  ;(reportsData ?? []).forEach(r => {
    const segs = segmentsByShift.get(r.shift_id) ?? []
    if (r.downtime_reason?.trim()) {
      segs.push({ hourStart: r.hour_start, text: `${r.hour_block} [Downtime]: ${r.downtime_reason.trim()}` })
      stationWeight(r.downtime_stations, r.downtime_station).forEach(({ station, weight }) => bumpStation(r.shift_id, station, weight))
    }
    if (r.reject_reason?.trim()) {
      segs.push({ hourStart: r.hour_start, text: `${r.hour_block} [Reject]: ${r.reject_reason.trim()}` })
      stationWeight(r.reject_stations, r.reject_station).forEach(({ station, weight }) => bumpStation(r.shift_id, station, weight))
    }
    if (r.notes?.trim()) segs.push({ hourStart: r.hour_start, text: `${r.hour_block} [Note]: ${r.notes.trim()}` })
    segmentsByShift.set(r.shift_id, segs)

    const counts = countsByShift.get(r.shift_id) ?? { good: 0, reject: 0 }
    counts.good += Number(r.good_count) || 0
    counts.reject += Number(r.reject_count) || 0
    countsByShift.set(r.shift_id, counts)
  })

  uniqueIds.forEach(shiftId => {
    const shiftInfo = shiftInfoById.get(shiftId)
    const segs = (segmentsByShift.get(shiftId) ?? []).sort((a, b) => a.hourStart - b.hourStart).map(s => s.text)
    if (shiftInfo?.summary_notes?.trim()) segs.push(`Shift-end note: ${shiftInfo.summary_notes.trim()}`)
    const counts = countsByShift.get(shiftId) ?? { good: 0, reject: 0 }
    const topStations = [...(stationWeightsByShift.get(shiftId) ?? new Map<string, number>()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([station]) => station)

    result.set(shiftId, {
      runtimeMin: shiftInfo?.summary_runtime_min ?? 0,
      alarmMin: shiftInfo?.summary_alarm_min ?? 0,
      downtimeMin: shiftInfo?.summary_downtime_min ?? 0,
      goodCount: counts.good,
      rejectCount: counts.reject,
      topStations,
      text: segs.join(' | ')
    })
  })

  return result
}

// Tlumaczenie tresci "Problem summary" na potrzeby arkusza EN - to jedyne miejsce w
// eksporcie, gdzie surowy tekst operatora trafia na arkusz jezykowy inny niz polski,
// wiec bez tego arkusz EN bylby bezuzyteczny dla odbiorcy nie znajacego polskiego.
// Nie krytyczne dla reszty eksportu - w razie bledu arkusz EN spada na oryginalny tekst.
async function translateShiftSummaries(items: { id: string; text: string }[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (!items.length) return result
  try {
    const { data, error } = await supabase.functions.invoke('translate-shift-summaries', { body: { items } })
    if (error) return result
    const translations = (data?.translations ?? []) as { id: string; text: string }[]
    translations.forEach(t => result.set(t.id, t.text))
  } catch {
    // brak tlumaczenia nie blokuje eksportu
  }
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
  const handleExportExcel = async (list: PhotoRow[]) => {
    if (list.length === 0) return
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

      const translationItems = [...descriptionByShift.entries()]
        .filter(([, info]) => info.text)
        .map(([shiftId, info]) => ({ id: shiftId, text: info.text }))
      const translatedTextByShift = await translateShiftSummaries(translationItems)

      const wb = new ExcelJS.Workbook()
      wb.creator = 'MargoLine MES'
      wb.created = new Date()

      // Odczyty ulozone POZIOMO: kazda zmiana/zdjecie to osobna kolumna, kazdy odczytany
      // parametr to osobny wiersz - zeby porownanie zmiany do zmiany bylo jednym rzutem
      // oka w prawo, zamiast przewijania dlugiej pionowej listy. Kolumny chronologicznie
      // od najstarszej po lewej do najnowszej po prawej.
      const MODULE_COMPARISON_LABELS: Record<ExportLang, { rowLabels: string[]; noData: string }> = {
        en: { rowLabels: ['Date', 'Shift', 'Machine', 'Operator', 'Photo time', 'OCR status'], noData: 'No readings for this range.' },
        pl: { rowLabels: ['Data', 'Zmiana', 'Automat', 'Operator', 'Godzina zdjęcia', 'Status OCR'], noData: 'Brak odczytów w tym zakresie.' }
      }
      const THIN_BORDER = {
        top: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } }
      }

      const buildModuleComparisonSheet = (sheetName: string, titleText: string, modulePhotos: PhotoRow[], lang: ExportLang) => {
        const ws = wb.addWorksheet(sheetName)
        const labels = MODULE_COMPARISON_LABELS[lang]
        const sortedPhotos = modulePhotos.slice().sort((a, b) => (a.captured_at ?? '').localeCompare(b.captured_at ?? ''))

        ws.mergeCells(1, 1, 1, Math.max(sortedPhotos.length + 1, 2))
        const title = ws.getCell(1, 1)
        title.value = titleText
        title.font = { name: 'Arial', bold: true, size: 13, color: { argb: GOLD } }
        title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
        title.alignment = { horizontal: 'center', vertical: 'middle' }
        ws.getRow(1).height = 26

        if (!sortedPhotos.length) {
          const cell = ws.getCell(3, 1)
          cell.value = labels.noData
          cell.font = { name: 'Arial', italic: true, size: 9, color: { argb: 'FF6B7280' } }
          return
        }

        const firstDataCol = 2
        const metaHeaderRow = 3
        const metricsStartRow = metaHeaderRow + labels.rowLabels.length + 1

        ws.getColumn(1).width = 26
        sortedPhotos.forEach((_, ci) => { ws.getColumn(firstDataCol + ci).width = 18 })

        labels.rowLabels.forEach((label, ri) => {
          const cell = ws.getCell(metaHeaderRow + ri, 1)
          cell.value = label
          cell.font = { name: 'Arial', bold: true, color: { argb: GOLD }, size: 9 }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
          cell.alignment = { vertical: 'middle' }
        })

        const readingMapByPhoto = new Map<string, Map<string, ShiftStatReading>>()
        sortedPhotos.forEach(photo => {
          const map = new Map<string, ShiftStatReading>()
          ;(readingsByPhoto.get(photo.id) ?? []).forEach(r => map.set(r.metric_label, r))
          readingMapByPhoto.set(photo.id, map)
        })

        sortedPhotos.forEach((photo, ci) => {
          const col = firstDataCol + ci
          const metaValues = [
            photo.shift_date ?? '',
            photo.shift_type ?? '',
            one(photo.machine)?.name ?? '—',
            one(photo.operator)?.full_name ?? '—',
            new Date(photo.captured_at).toLocaleString(lang === 'en' ? 'en-GB' : 'pl-PL'),
            OCR_STATUS_LABELS[lang][photo.ocr_status]
          ]
          metaValues.forEach((value, ri) => {
            const cell = ws.getCell(metaHeaderRow + ri, col)
            cell.value = value
            cell.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FFE5E9F2' } }
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF24345A' } }
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
          })
        })

        // Kolejnosc wierszy odczytow = kolejnosc na ekranie PLC (najnizszy sort_order
        // sposrod wszystkich zdjec, w ktorych dana etykieta wystapila).
        const metricOrder = new Map<string, number>()
        sortedPhotos.forEach(photo => {
          (readingsByPhoto.get(photo.id) ?? []).forEach(r => {
            const current = metricOrder.get(r.metric_label)
            if (current === undefined || r.sort_order < current) metricOrder.set(r.metric_label, r.sort_order)
          })
        })
        const metricLabels = [...metricOrder.keys()].sort((a, b) => metricOrder.get(a)! - metricOrder.get(b)!)

        metricLabels.forEach((label, ri) => {
          const row = metricsStartRow + ri
          const stripeColor = ri % 2 === 0 ? 'FFF3F4F6' : 'FFFFFFFF'

          const labelCell = ws.getCell(row, 1)
          labelCell.value = label
          labelCell.font = { name: 'Arial', bold: true, size: 9 }
          labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stripeColor } }
          labelCell.alignment = { vertical: 'middle' }
          labelCell.border = THIN_BORDER

          sortedPhotos.forEach((photo, ci) => {
            const col = firstDataCol + ci
            const reading = readingMapByPhoto.get(photo.id)?.get(label)
            const cell = ws.getCell(row, col)
            cell.value = reading ? (reading.corrected_value ?? reading.metric_value) : ''
            cell.font = { name: 'Arial', size: 9 }
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stripeColor } }
            cell.alignment = { horizontal: 'right', vertical: 'middle' }
            cell.border = THIN_BORDER
          })
        })

        // Zamrozenie pierwszej kolumny (nazwy odczytow) i wierszy metadanych - przy
        // przewijaniu w prawo/w dol etykiety i naglowek zmiany zostaja widoczne.
        ws.views = [{ state: 'frozen', xSplit: 1, ySplit: metricsStartRow - 1 }]
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

      // Uklad wg oceny odbiorcy raportu: jedna zmiana = jeden wiersz, osobne pola dla
      // czasu pracy / alarmow / przestojow (zamiast jednego zbiorczego pola), odrzut
      // policzalny obok produkcji, stacja generujaca najwieksze straty widoczna wprost,
      // a dluzsze alarmy/przestoje wyrozniamy na czerwono - zeby dalo sie od razu
      // wskazac, ktore zmiany wymagaja uwagi.
      const LONG_TIME_THRESHOLD_MIN = 120
      const SHIFT_SUMMARY_LABELS: Record<ExportLang, { title: string; columns: string[]; noIssues: string; noStation: string }> = {
        en: {
          title: 'Shift Summary - runtime, alarms, downtime, rejects',
          columns: ['Date', 'Shift', 'Machine', 'Production', 'Reject %', 'Runtime', 'Alarms', 'Downtime', 'Loss-generating station', 'Cause description'],
          noIssues: 'No issues reported',
          noStation: '—'
        },
        pl: {
          title: 'Podsumowanie zmiany - czas pracy, alarmy, przestoje, odrzuty',
          columns: ['Data', 'Zmiana', 'Automat', 'Produkcja', 'Odrzut %', 'Czas pracy', 'Alarmy', 'Przestoje', 'Stacja generująca straty', 'Opis przyczyny'],
          noIssues: 'Brak zgłoszonych problemów',
          noStation: '—'
        }
      }

      const buildShiftSummarySheet = (sheetName: string, lang: ExportLang) => {
        const labels = SHIFT_SUMMARY_LABELS[lang]
        const summaryWs = wb.addWorksheet(sheetName)
        summaryWs.mergeCells(1, 1, 1, labels.columns.length)
        const summaryTitle = summaryWs.getCell(1, 1)
        summaryTitle.value = labels.title
        summaryTitle.font = { name: 'Arial', bold: true, size: 13, color: { argb: GOLD } }
        summaryTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
        summaryTitle.alignment = { horizontal: 'center', vertical: 'middle' }
        summaryWs.getRow(1).height = 26

        const summaryHeaderRow = 3
        const summaryColumnWidths = [13, 9, 20, 13, 11, 12, 11, 12, 22, 80]
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
            const rejectPct = problem && (problem.goodCount + problem.rejectCount) > 0
              ? Math.round((problem.rejectCount / (problem.goodCount + problem.rejectCount)) * 1000) / 10
              : 0
            return {
              date: first.shift_date ?? '',
              shiftType: first.shift_type ?? '',
              machineName: one(first.machine)?.name ?? '—',
              goodCount: problem?.goodCount ?? 0,
              rejectPct,
              runtimeMin: problem?.runtimeMin ?? 0,
              alarmMin: problem?.alarmMin ?? 0,
              downtimeMin: problem?.downtimeMin ?? 0,
              stationLabel: problem?.topStations.length ? problem.topStations.map(s => stationLabelFor(s, lang)).join(', ') : labels.noStation,
              problemSummary: (lang === 'en' ? translatedTextByShift.get(shiftId) : undefined) || problem?.text || labels.noIssues
            }
          })
          .sort((a, b) => a.date.localeCompare(b.date) || a.machineName.localeCompare(b.machineName) || a.shiftType.localeCompare(b.shiftType))

        let summaryRow = summaryHeaderRow + 1
        summaryRows.forEach(r => {
          const cells: (string | number)[] = [
            r.date, r.shiftType, r.machineName,
            Math.round(r.goodCount).toLocaleString(lang === 'en' ? 'en-GB' : 'pl-PL'),
            `${r.rejectPct}%`,
            formatMinutes(r.runtimeMin),
            formatMinutes(r.alarmMin),
            formatMinutes(r.downtimeMin),
            r.stationLabel,
            r.problemSummary
          ]
          cells.forEach((value, ci) => {
            const cell = summaryWs.getCell(summaryRow, ci + 1)
            cell.value = value
            const isLongAlarmOrDowntime = (ci === 6 && r.alarmMin > LONG_TIME_THRESHOLD_MIN) || (ci === 7 && r.downtimeMin > LONG_TIME_THRESHOLD_MIN)
            cell.font = isLongAlarmOrDowntime
              ? { name: 'Arial', size: 9, bold: true, color: { argb: 'FFDC2626' } }
              : { name: 'Arial', size: 9 }
            cell.alignment = { wrapText: ci === 9, vertical: 'top' }
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

      buildModuleComparisonSheet('Zestaw', 'Statystyki zmianowe - Zestaw', zestawPhotos, 'pl')
      buildModuleComparisonSheet('Komora', 'Statystyki zmianowe - Komora kroplowa', komoraPhotos, 'pl')
      buildModuleComparisonSheet('Infusion Set', 'Shift statistics - Infusion Set', zestawPhotos, 'en')
      buildModuleComparisonSheet('Drip Chamber', 'Shift statistics - Drip Chamber', komoraPhotos, 'en')

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
          onClick={() => handleDownloadAll(exportTargets)}
          disabled={downloadingAll || exportTargets.length === 0}
          className="shrink-0 rounded-xl border border-navy-600 bg-navy-900 px-4 py-2 text-sm font-bold text-navy-200 hover:border-brand/40 hover:text-brand transition-all disabled:opacity-40"
        >
          {downloadingAll
            ? `⤓ Pobieranie ${downloadAllProgress.done}/${downloadAllProgress.total}...`
            : `⤓ Pobierz ${selectedIds.size > 0 ? 'zaznaczone' : 'wszystkie'} (${exportTargets.length})`}
        </button>
        <button
          onClick={() => handleExportExcel(exportTargets)}
          disabled={exportingExcel || exportTargets.length === 0}
          className="shrink-0 rounded-xl border border-navy-600 bg-navy-900 px-4 py-2 text-sm font-bold text-navy-200 hover:border-brand/40 hover:text-brand transition-all disabled:opacity-40"
        >
          {exportingExcel ? '⏳ Generowanie...' : `📊 Eksportuj do Excela (${exportTargets.length})`}
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
