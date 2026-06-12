import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn, compareProductionHours, efficiencyColor, getProductionDate } from '@/lib/utils'
import type { HourlyReport, Machine } from '@/types/database'

// ─── Stałe brand ────────────────────────────────────────────────────────────
const NAVY  = 'FF1A2744'
const GOLD  = 'FFC9A84C'
const LIGHT = 'FFEEF2FA'
const WHITE = 'FFFFFFFF'
const RED   = 'FFDC2626'
const AMBER = 'FFD97706'
const GREEN = 'FF16A34A'
const GRAY  = 'FF6B7280'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EJS = any

declare global { interface Window { ExcelJS?: EJS } }

interface ReportData {
  reports:  ExportReport[]
  machines: Machine[]
  dateFrom: string
  dateTo:   string
}

type ExportReport = HourlyReport & {
  operator?: { full_name: string } | { full_name: string }[] | null
}

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value
}

// ─── helpers ────────────────────────────────────────────────────────────────
const effArgb = (pct: number) => pct >= 90 ? GREEN : pct >= 70 ? AMBER : RED

const applyBorder = (cell: EJS) => {
  cell.border = {
    top:    { style: 'thin', color: { argb: 'FFD1D5DB' } },
    bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    left:   { style: 'thin', color: { argb: 'FFD1D5DB' } },
    right:  { style: 'thin', color: { argb: 'FFD1D5DB' } },
  }
}

const boldBorder = (cell: EJS, side: 'top' | 'bottom') =>
  (cell.border = { [side]: { style: 'medium', color: { argb: GOLD } } })

const setHeaderCell = (cell: EJS, value: string) => {
  cell.value     = value
  cell.font      = { name: 'Arial', bold: true, color: { argb: GOLD }, size: 9 }
  cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  boldBorder(cell, 'bottom')
}

// Tytuł + separator + pusta linia — zwraca numer pierwszego wiersza danych
const addSheetHeader = (ws: EJS, title: string, subtitle: string, colCount: number): number => {
  ws.mergeCells(1, 1, 1, colCount)
  const t = ws.getCell(1, 1)
  t.value     = title
  t.font      = { name: 'Arial', bold: true, size: 13, color: { argb: GOLD } }
  t.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  t.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 28

  ws.mergeCells(2, 1, 2, colCount)
  const s = ws.getCell(2, 1)
  s.value     = subtitle
  s.font      = { name: 'Arial', italic: true, size: 9, color: { argb: 'FFAAAAAA' } }
  s.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  s.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(2).height = 14

  ws.mergeCells(3, 1, 3, colCount)
  ws.getCell(3, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } }
  ws.getRow(3).height   = 3

  ws.getRow(4).height = 6
  return 5  // pierwszy wiersz danych/nagłówków
}

// ─── kolumny arkusza maszynowego ────────────────────────────────────────────
const MACHINE_COLS = [
  { label: 'Data',            key: 'date',      width: 13 },
  { label: 'Godzina',         key: 'hour',       width: 12 },
  { label: 'Zmiana',          key: 'shift',      width: 10 },
  { label: 'Operator',        key: 'operator',   width: 20 },
  { label: 'Przyrost',        key: 'good',       width: 11 },
  { label: 'Odrzut',          key: 'reject',     width: 9  },
  { label: 'Łącznie',         key: 'total',      width: 10 },
  { label: 'Cel',             key: 'target',     width: 8  },
  { label: 'Efektywność',     key: 'eff',        width: 13 },
  { label: 'Czas pr. (min)',  key: 'runtime',    width: 14 },
  { label: 'Postój (min)',    key: 'downtime',   width: 13 },
  { label: 'Mikrost. (min)',  key: 'micro',      width: 14 },
  { label: 'Przezbr. (min)',  key: 'changeover', width: 14 },
  { label: 'Awaria (min)',    key: 'failure',    width: 13 },
  { label: 'Przyczyna',       key: 'reason',     width: 24 },
  { label: 'Uwagi',           key: 'notes',      width: 30 },
]

const shiftLabel = (hour: number) => {
  if (hour >= 6  && hour < 14) return 'I'
  if (hour >= 14 && hour < 22) return 'II'
  return 'III'
}

const shiftOrder = (shift: string) => ({ I: 1, II: 2, III: 3 }[shift] ?? 9)

const sortReportsByProductionDay = (reports: ExportReport[]) =>
  [...reports].sort((a, b) =>
    a.report_date.localeCompare(b.report_date) ||
    compareProductionHours(a.hour_start ?? 0, b.hour_start ?? 0) ||
    String(a.machine_id).localeCompare(String(b.machine_id))
  )

// ─── budowanie arkusza dla jednej maszyny ───────────────────────────────────
const buildMachineSheet = (
  wb:       EJS,
  machine:  Machine,
  reports:  ExportReport[],
  dateFrom: string,
  dateTo:   string
) => {
  const ws = wb.addWorksheet(machine.name, {
    views: [{ state: 'frozen', ySplit: 6 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
  })

  MACHINE_COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width })

  const headerRow = addSheetHeader(
    ws,
    `MARGOMED S.A. — ${machine.name} · Raporty godzinowe`,
    `Okres: ${dateFrom} – ${dateTo}   ·   MargoLine beta   ·   From years. For years. Quality.   ·   Wpisów: ${reports.length}`,
    MACHINE_COLS.length
  )

  // Nagłówki kolumn
  MACHINE_COLS.forEach((c, i) => setHeaderCell(ws.getCell(headerRow, i + 1), c.label))
  ws.getRow(headerRow).height = 20

  // Dane
  const dataStart = headerRow + 1
  sortReportsByProductionDay(reports).forEach((r, idx) => {
    const eff = Number(r.efficiency_pct)
    const bg  = idx % 2 === 0 ? WHITE : LIGHT
    const row = ws.getRow(dataStart + idx)

    const vals: (string | number | { formula: string })[] = [
      r.report_date,
      r.hour_block ?? '',
      shiftLabel(r.hour_start ?? 0),
      one(r.operator)?.full_name ?? '—',
      r.good_count,
      r.reject_count || 0,
      r.total_count ?? '',
      r.target,
      eff / 100,
      r.runtime_min,
      r.downtime_min,
      r.micro_stoppage_min,
      r.changeover_min,
      r.failure_min,
      r.downtime_reason ?? '',
      r.notes ?? '',
    ]

    vals.forEach((v, ci) => {
      const cell = row.getCell(ci + 1)
      cell.value = v
      cell.font  = { name: 'Arial', size: 9 }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
      cell.alignment = { vertical: 'middle' }
      applyBorder(cell)

      if (ci === 0)  { cell.numFmt = 'DD.MM.YYYY'; cell.font = { name: 'Arial', size: 9, color: { argb: GRAY } } }
      if (ci === 2)  { cell.alignment = { horizontal: 'center', vertical: 'middle' }; cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: NAVY } } }
      if (ci === 4)  { cell.numFmt = '#,##0'; cell.font = { name: 'Arial', bold: true, size: 9 } }
      if (ci === 5 && r.reject_count > 0) { cell.numFmt = '#,##0'; cell.font = { name: 'Arial', size: 9, color: { argb: RED } } }
      if (ci === 8)  { cell.numFmt = '0%'; cell.font = { name: 'Arial', bold: true, size: 9, color: { argb: effArgb(eff) } } }
      if (ci >= 9 && ci <= 13) { cell.numFmt = '#,##0'; cell.alignment = { horizontal: 'center', vertical: 'middle' } }
      if (ci === 15) { cell.alignment = { wrapText: true, vertical: 'top' } }
    })
    row.height = r.notes && r.notes.length > 40 ? 28 : 16
  })

  // Wiersz SUMA
  const sumRowIdx = dataStart + reports.length
  const sr = ws.getRow(sumRowIdx)
  sr.height = 20
  MACHINE_COLS.forEach((_, ci) => {
    const cell = sr.getCell(ci + 1)
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    cell.font  = { name: 'Arial', bold: true, size: 9, color: { argb: GOLD } }
    boldBorder(cell, 'top')
  })
  sr.getCell(1).value = 'SUMA / ŚREDNIA'
  if (reports.length > 0) {
    sr.getCell(5).value  = { formula: `SUM(E${dataStart}:E${sumRowIdx - 1})` }; sr.getCell(5).numFmt = '#,##0'
    sr.getCell(6).value  = { formula: `SUM(F${dataStart}:F${sumRowIdx - 1})` }; sr.getCell(6).numFmt = '#,##0'
    sr.getCell(9).value  = { formula: `AVERAGE(I${dataStart}:I${sumRowIdx - 1})` }; sr.getCell(9).numFmt = '0%'
    sr.getCell(10).value = { formula: `SUM(J${dataStart}:J${sumRowIdx - 1})` }; sr.getCell(10).numFmt = '#,##0'
    sr.getCell(11).value = { formula: `SUM(K${dataStart}:K${sumRowIdx - 1})` }; sr.getCell(11).numFmt = '#,##0'
    sr.getCell(14).value = { formula: `SUM(N${dataStart}:N${sumRowIdx - 1})` }; sr.getCell(14).numFmt = '#,##0'
  }
}

// ─── arkusz PODSUMOWANIE ────────────────────────────────────────────────────
const buildSummarySheet = (
  wb:       EJS,
  machines: Machine[],
  reports:  ExportReport[],
  dateFrom: string,
  dateTo:   string
) => {
  const ws = wb.addWorksheet('📊 Podsumowanie', {
    views: [{ state: 'frozen', ySplit: 6 }]
  })

  const cols = [
    { label: 'Data',             width: 13 },
    { label: 'Maszyna',          width: 16 },
    { label: 'Zmiana',           width: 10 },
    { label: 'Produkcja',        width: 13 },
    { label: 'Odrzut',           width: 10 },
    { label: 'Odrzut %',         width: 11 },
    { label: 'Efektywność',      width: 13 },
    { label: 'Czas pracy (min)', width: 16 },
    { label: 'Przestój (min)',   width: 14 },
    { label: 'Awaria (min)',     width: 13 },
    { label: 'Wpisów',           width: 9  },
  ]
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width })

  const headerRow = addSheetHeader(
    ws,
    'MARGOMED S.A. — Podsumowanie produkcji',
    `Okres: ${dateFrom} – ${dateTo}   ·   Wszystkie maszyny   ·   MargoLine beta   ·   From years. For years. Quality.`,
    cols.length
  )

  cols.forEach((c, i) => setHeaderCell(ws.getCell(headerRow, i + 1), c.label))
  ws.getRow(headerRow).height = 20

  // grupowanie: data × maszyna × zmiana
  type GroupKey = string
  const groups: Record<GroupKey, {
    date: string; machineId: string; machineName: string; shift: string
    good: number; reject: number; eff: number[]; runtime: number; downtime: number; failure: number; count: number
  }> = {}

  reports.forEach(r => {
    const m     = machines.find(m => m.id === r.machine_id)
    const shift = shiftLabel(r.hour_start ?? 0)
    const key   = `${r.report_date}__${r.machine_id}__${shift}`
    if (!groups[key]) groups[key] = {
      date: r.report_date, machineId: r.machine_id, machineName: m?.name ?? '—', shift,
      good: 0, reject: 0, eff: [], runtime: 0, downtime: 0, failure: 0, count: 0
    }
    const g = groups[key]
    g.good     += r.good_count
    g.reject   += r.reject_count
    g.eff.push(Number(r.efficiency_pct))
    g.runtime  += r.runtime_min
    g.downtime += r.downtime_min
    g.failure  += r.failure_min
    g.count    += 1
  })

  const sorted = Object.values(groups).sort((a, b) =>
    a.date.localeCompare(b.date) || a.machineName.localeCompare(b.machineName) || shiftOrder(a.shift) - shiftOrder(b.shift)
  )

  const dataStart = headerRow + 1
  sorted.forEach((g, idx) => {
    const avgEff = g.eff.reduce((a, b) => a + b, 0) / g.eff.length
    const rejPct = (g.good + g.reject) > 0 ? g.reject / (g.good + g.reject) : 0
    const bg     = idx % 2 === 0 ? WHITE : LIGHT
    const row    = ws.getRow(dataStart + idx)

    const vals = [g.date, g.machineName, g.shift, g.good, g.reject, rejPct, avgEff / 100, g.runtime, g.downtime, g.failure, g.count]
    vals.forEach((v, ci) => {
      const cell = row.getCell(ci + 1)
      cell.value = v
      cell.font  = { name: 'Arial', size: 9 }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
      cell.alignment = { vertical: 'middle', horizontal: ci >= 3 ? 'center' : 'left' }
      applyBorder(cell)
      if (ci === 0) { cell.numFmt = 'DD.MM.YYYY'; cell.font = { name: 'Arial', size: 9, color: { argb: GRAY } } }
      if (ci === 2) { cell.font = { name: 'Arial', bold: true, size: 9, color: { argb: NAVY } } }
      if (ci === 3 || ci === 4) cell.numFmt = '#,##0'
      if (ci === 5) { cell.numFmt = '0.00%'; cell.font = { name: 'Arial', size: 9, color: { argb: rejPct > 0.045 ? RED : GREEN } } }
      if (ci === 6) { cell.numFmt = '0%'; cell.font = { name: 'Arial', bold: true, size: 9, color: { argb: effArgb(avgEff) } } }
      if (ci >= 7 && ci <= 9) cell.numFmt = '#,##0'
    })
    row.height = 16
  })

  // Wiersz SUMA
  const sumIdx = dataStart + sorted.length
  const sr = ws.getRow(sumIdx)
  sr.height = 20
  cols.forEach((_, ci) => {
    const cell = sr.getCell(ci + 1)
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    cell.font  = { name: 'Arial', bold: true, size: 9, color: { argb: GOLD } }
    boldBorder(cell, 'top')
  })
  sr.getCell(1).value = 'RAZEM'
  if (sorted.length > 0) {
    sr.getCell(4).value  = { formula: `SUM(D${dataStart}:D${sumIdx - 1})` }; sr.getCell(4).numFmt = '#,##0'
    sr.getCell(5).value  = { formula: `SUM(E${dataStart}:E${sumIdx - 1})` }; sr.getCell(5).numFmt = '#,##0'
    sr.getCell(7).value  = { formula: `AVERAGE(G${dataStart}:G${sumIdx - 1})` }; sr.getCell(7).numFmt = '0%'
    sr.getCell(8).value  = { formula: `SUM(H${dataStart}:H${sumIdx - 1})` }; sr.getCell(8).numFmt = '#,##0'
    sr.getCell(9).value  = { formula: `SUM(I${dataStart}:I${sumIdx - 1})` }; sr.getCell(9).numFmt = '#,##0'
    sr.getCell(10).value = { formula: `SUM(J${dataStart}:J${sumIdx - 1})` }; sr.getCell(10).numFmt = '#,##0'
    sr.getCell(11).value = { formula: `SUM(K${dataStart}:K${sumIdx - 1})` }; sr.getCell(11).numFmt = '#,##0'
  }

  // mini KPI block pod tabelą (2 wiersze oddechu + blok)
  const kpiStart = sumIdx + 3
  const kpiData = machines.map(m => {
    const mr = reports.filter(r => r.machine_id === m.id)
    const totalGood   = mr.reduce((s, r) => s + r.good_count, 0)
    const totalReject = mr.reduce((s, r) => s + r.reject_count, 0)
    const avgE = mr.length > 0 ? mr.reduce((s, r) => s + Number(r.efficiency_pct), 0) / mr.length : 0
    const totalDown = mr.reduce((s, r) => s + r.downtime_min + r.failure_min, 0)
    return { name: m.name, totalGood, totalReject, avgE, totalDown, count: mr.length }
  })

  // Nagłówek KPI
  ws.mergeCells(kpiStart, 1, kpiStart, cols.length)
  const kpiTitle = ws.getCell(kpiStart, 1)
  kpiTitle.value     = 'KPI — zestawienie per maszyna'
  kpiTitle.font      = { name: 'Arial', bold: true, size: 10, color: { argb: GOLD } }
  kpiTitle.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  kpiTitle.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
  ws.getRow(kpiStart).height = 18

  const kpiHeaders = ['Maszyna', 'Produkcja', 'Odrzut', 'Odrzut %', 'Śr. efektywność', 'Przestój (min)', 'Wpisów']
  kpiHeaders.forEach((h, i) => setHeaderCell(ws.getCell(kpiStart + 1, i + 1), h))
  ws.getRow(kpiStart + 1).height = 18

  kpiData.forEach((k, idx) => {
    const row = ws.getRow(kpiStart + 2 + idx)
    const rejPct = (k.totalGood + k.totalReject) > 0 ? k.totalReject / (k.totalGood + k.totalReject) : 0
    const vals = [k.name, k.totalGood, k.totalReject, rejPct, k.avgE / 100, k.totalDown, k.count]
    vals.forEach((v, ci) => {
      const cell = row.getCell(ci + 1)
      cell.value = v
      cell.font  = { name: 'Arial', size: 9, bold: ci === 0 }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? WHITE : LIGHT } }
      cell.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'left' : 'center' }
      applyBorder(cell)
      if (ci === 1 || ci === 2) cell.numFmt = '#,##0'
      if (ci === 3) { cell.numFmt = '0.00%'; cell.font = { name: 'Arial', size: 9, color: { argb: rejPct > 0.045 ? RED : GREEN } } }
      if (ci === 4) { cell.numFmt = '0%'; cell.font = { name: 'Arial', bold: true, size: 9, color: { argb: effArgb(k.avgE) } } }
      if (ci === 5) cell.numFmt = '#,##0'
    })
    row.height = 16
  })
}

// ─── główny komponent ────────────────────────────────────────────────────────
export default function ManagerExport() {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(`${getProductionDate()}T12:00:00`)
    d.setDate(d.getDate() - 7)
    return d.toISOString().split('T')[0]
  })
  const [dateTo,     setDateTo]     = useState(getProductionDate())
  const [selMachine, setSelMachine] = useState('')
  const [selShift,   setSelShift]   = useState('')
  const [loading,    setLoading]    = useState(false)
  const [exporting,  setExporting]  = useState(false)
  const [data,       setData]       = useState<ReportData | null>(null)
  const [machines,   setMachines]   = useState<Machine[]>([])

  useEffect(() => {
    supabase.from('machines').select('*').eq('is_active', true).then(({ data }) => {
      if (data) setMachines(data as Machine[])
    })
  }, [])

  const loadData = async () => {
    setLoading(true)
    let q = supabase.from('hourly_reports').select('*, operator:profiles!operator_id(full_name)')
      .gte('report_date', dateFrom).lte('report_date', dateTo)
      .is('deleted_at', null).order('report_date').order('hour_start')
    if (selMachine) q = q.eq('machine_id', selMachine)
    if (selShift) {
      const shiftHours: Record<string, number[]> = {
        'I':   [6,7,8,9,10,11,12,13],
        'II':  [14,15,16,17,18,19,20,21],
        'III': [22,23,0,1,2,3,4,5]
      }
      if (shiftHours[selShift]) q = q.in('hour_start', shiftHours[selShift])
    }
    const { data: reports } = await q
    setData({ reports: sortReportsByProductionDay((reports ?? []) as ExportReport[]), machines, dateFrom, dateTo })
    setLoading(false)
  }

  const loadExcelJS = (): Promise<EJS> =>
    new Promise((resolve, reject) => {
      if (window.ExcelJS) { resolve(window.ExcelJS); return }
      const s = document.createElement('script')
      s.src     = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js'
      s.onload  = () => resolve(window.ExcelJS!)
      s.onerror = () => reject(new Error('Nie udało się załadować ExcelJS'))
      document.head.appendChild(s)
    })

  const exportExcel = async () => {
    if (!data) return
    setExporting(true)
    try {
      const ExcelJS = await loadExcelJS()
      const wb = new ExcelJS.Workbook()
      wb.creator = 'MargoLine MES'
      wb.created = new Date()

      // Arkusz Podsumowanie jako pierwszy
      buildSummarySheet(wb, data.machines, data.reports, data.dateFrom, data.dateTo)

      // Osobny arkusz per maszyna
      const activeMachineIds = [...new Set(data.reports.map(r => r.machine_id))]
      data.machines
        .filter(m => activeMachineIds.includes(m.id))
        .forEach(m => {
          const machineReports = data.reports.filter(r => r.machine_id === m.id)
          buildMachineSheet(wb, m, machineReports, data.dateFrom, data.dateTo)
        })

      const buffer = await wb.xlsx.writeBuffer()
      const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url    = URL.createObjectURL(blob)
      const a      = document.createElement('a')
      a.href       = url
      a.download   = `MargoLine_${data.dateFrom}_${data.dateTo}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const exportPDF = () => { if (data) window.print() }

  const totalGood     = data?.reports.reduce((s, r) => s + r.good_count, 0) ?? 0
  const totalReject   = data?.reports.reduce((s, r) => s + r.reject_count, 0) ?? 0
  const avgEff        = data && data.reports.length > 0
    ? Math.round(data.reports.reduce((s, r) => s + Number(r.efficiency_pct), 0) / data.reports.length) : 0
  const totalDowntime = data?.reports.reduce((s, r) => s + r.downtime_min + r.failure_min, 0) ?? 0

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: fixed; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="space-y-5 no-print">
        <div>
          <h1 className="text-2xl font-bold text-white">Eksport raportów</h1>
          <p className="text-navy-400 mt-1">Pobierz dane produkcyjne w formacie Excel lub PDF</p>
        </div>

        {/* Filtry */}
        <div className="card">
          <div className="card-header"><div className="card-title">Filtry</div></div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="label">Data od</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Data do</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Maszyna</label>
              <select value={selMachine} onChange={e => setSelMachine(e.target.value)} className="input">
                <option value="">Wszystkie maszyny</option>
                {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Zmiana</label>
              <select value={selShift} onChange={e => setSelShift(e.target.value)} className="input">
                <option value="">Wszystkie zmiany</option>
                <option value="I">Zmiana I (06–14)</option>
                <option value="II">Zmiana II (14–22)</option>
                <option value="III">Zmiana III (22–06)</option>
              </select>
            </div>
          </div>
          <button onClick={loadData} disabled={loading} className="btn-primary px-6 py-2.5">
            {loading ? 'Ładowanie...' : '🔍 Załaduj dane'}
          </button>
        </div>

        {data && (
          <>
            {/* KPI */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { l: 'Produkcja łącznie', v: totalGood.toLocaleString('pl-PL') + ' szt',   c: 'text-brand'     },
                { l: 'Śr. efektywność',   v: avgEff + '%',                                  c: efficiencyColor(avgEff) },
                { l: 'Odrzut łącznie',    v: totalReject.toLocaleString('pl-PL') + ' szt', c: 'text-red-400'   },
                { l: 'Przestoje łącznie', v: totalDowntime + ' min',                        c: 'text-amber-400' },
              ].map(k => (
                <div key={k.l} className="kpi-card">
                  <div className="kpi-label">{k.l}</div>
                  <div className={cn('kpi-value', k.c)}>{k.v}</div>
                  <div className="kpi-sub">{data.reports.length} wpisów · {dateFrom} – {dateTo}</div>
                </div>
              ))}
            </div>

            {/* Info o strukturze pliku */}
            <div className="card border border-navy-600">
              <div className="card-header"><div className="card-title text-sm">Struktura pliku Excel</div></div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-1 rounded bg-brand/20 text-brand font-mono">📊 Podsumowanie</span>
                {[...new Set(data.reports.map(r => r.machine_id))].map(mid => {
                  const m = data.machines.find(m => m.id === mid)
                  return <span key={mid} className="px-2 py-1 rounded bg-navy-700 text-navy-300 font-mono">⚙ {m?.name ?? mid}</span>
                })}
              </div>
              <p className="text-navy-500 text-xs mt-2">Każda maszyna = osobna zakładka · Podsumowanie zawiera KPI per maszyna i zestawienie zmianowe</p>
            </div>

            {/* Przyciski */}
            <div className="flex gap-3 flex-wrap">
              <button onClick={exportExcel} disabled={exporting} className="btn-primary px-6 py-3 text-base">
                {exporting ? '⏳ Generowanie...' : '📊 Pobierz Excel (.xlsx)'}
              </button>
              <button onClick={exportPDF} className="btn-secondary px-6 py-3 text-base">
                🖨️ Drukuj / Zapisz PDF
              </button>
            </div>

            {/* Podgląd */}
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Podgląd danych</div>
                  <div className="card-sub">{data.reports.length} rekordów</div>
                </div>
              </div>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="sticky top-0">
                    <tr className="border-b border-navy-700 bg-navy-800">
                      {['Data','Godzina','Maszyna','Zmiana','Przyrost','Odrzut','Efektywność','Czas pracy','Przestój','Uwagi'].map(h => (
                        <th key={h} className="text-left py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.reports.map(r => {
                      const eff = Number(r.efficiency_pct)
                      const m   = data.machines.find(m => m.id === r.machine_id)
                      return (
                        <tr key={r.id} className="border-b border-navy-800 hover:bg-navy-800/40">
                          <td className="py-1.5 px-3 font-mono text-navy-400">{r.report_date}</td>
                          <td className="py-1.5 px-3 font-mono text-white">{r.hour_block}</td>
                          <td className="py-1.5 px-3 text-navy-300 font-medium">{m?.name ?? '—'}</td>
                          <td className="py-1.5 px-3 text-center">
                            <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-navy-700 text-navy-300">
                              {shiftLabel(r.hour_start ?? 0)}
                            </span>
                          </td>
                          <td className="py-1.5 px-3 font-bold font-mono text-white">{r.good_count.toLocaleString('pl-PL')}</td>
                          <td className="py-1.5 px-3 font-mono text-red-400">{r.reject_count || '—'}</td>
                          <td className="py-1.5 px-3"><span className={cn('font-bold', efficiencyColor(eff))}>{eff}%</span></td>
                          <td className="py-1.5 px-3 font-mono text-navy-400">{r.runtime_min}min</td>
                          <td className="py-1.5 px-3 font-mono text-amber-400">{(r.downtime_min + r.failure_min) > 0 ? (r.downtime_min + r.failure_min) + 'min' : '—'}</td>
                          <td className="py-1.5 px-3 text-navy-500 max-w-xs truncate">{r.notes || r.downtime_reason || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* PRINT AREA */}
      {data && (
        <div id="print-area" style={{ display: 'none', fontFamily: 'Arial, sans-serif', padding: '20px', color: '#000' }}>
          <div style={{ background: '#1A2744', color: '#C9A84C', padding: '16px 20px', marginBottom: '16px', borderRadius: '6px' }}>
            <h1 style={{ fontSize: '18px', margin: 0, fontWeight: 'bold' }}>MARGOMED S.A. — MargoLine MES</h1>
            <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#aaa' }}>
              Raport produkcji · Okres: {dateFrom} – {dateTo} · MargoLine beta · From years. For years. Quality.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
            {[
              { l: 'Produkcja łącznie', v: totalGood.toLocaleString('pl-PL') + ' szt'   },
              { l: 'Śr. efektywność',   v: avgEff + '%'                                   },
              { l: 'Odrzut łącznie',    v: totalReject.toLocaleString('pl-PL') + ' szt' },
              { l: 'Przestoje łącznie', v: totalDowntime + ' min'                         },
            ].map(k => (
              <div key={k.l} style={{ border: '2px solid #1A2744', borderRadius: '6px', padding: '10px' }}>
                <div style={{ fontSize: '9px', color: '#888', textTransform: 'uppercase', marginBottom: '4px' }}>{k.l}</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#1A2744' }}>{k.v}</div>
              </div>
            ))}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
            <thead>
              <tr style={{ background: '#1A2744' }}>
                {['Data','Godzina','Maszyna','Zmiana','Przyrost','Odrzut','Efekt.%','Czas pr.','Postój','Uwagi'].map(h => (
                  <th key={h} style={{ border: '1px solid #C9A84C', padding: '5px 7px', textAlign: 'left', color: '#C9A84C' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.reports.map((r, i) => {
                const m   = data.machines.find(m => m.id === r.machine_id)
                const eff = Number(r.efficiency_pct)
                return (
                  <tr key={r.id} style={{ background: i % 2 === 0 ? '#fff' : '#EEF2FA' }}>
                    <td style={{ border: '1px solid #ddd', padding: '4px 7px' }}>{r.report_date}</td>
                    <td style={{ border: '1px solid #ddd', padding: '4px 7px', fontFamily: 'monospace' }}>{r.hour_block}</td>
                    <td style={{ border: '1px solid #ddd', padding: '4px 7px', fontWeight: 'bold' }}>{m?.name ?? '—'}</td>
                    <td style={{ border: '1px solid #ddd', padding: '4px 7px', textAlign: 'center', fontWeight: 'bold' }}>{shiftLabel(r.hour_start ?? 0)}</td>
                    <td style={{ border: '1px solid #ddd', padding: '4px 7px', fontWeight: 'bold' }}>{r.good_count.toLocaleString('pl-PL')}</td>
                    <td style={{ border: '1px solid #ddd', padding: '4px 7px', color: r.reject_count > 0 ? '#DC2626' : undefined }}>{r.reject_count || '—'}</td>
                    <td style={{ border: '1px solid #ddd', padding: '4px 7px', fontWeight: 'bold', color: eff >= 90 ? '#16A34A' : eff >= 70 ? '#D97706' : '#DC2626' }}>{eff}%</td>
                    <td style={{ border: '1px solid #ddd', padding: '4px 7px' }}>{r.runtime_min}min</td>
                    <td style={{ border: '1px solid #ddd', padding: '4px 7px', color: (r.downtime_min + r.failure_min) > 0 ? '#D97706' : undefined }}>
                      {(r.downtime_min + r.failure_min) > 0 ? (r.downtime_min + r.failure_min) + 'min' : '—'}
                    </td>
                    <td style={{ border: '1px solid #ddd', padding: '4px 7px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.notes || r.downtime_reason || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
