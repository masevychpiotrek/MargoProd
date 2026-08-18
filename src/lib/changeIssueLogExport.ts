// Eksport modułu "Transparentność Zmian i Problemów" - XLSX (branding navy/gold,
// wzorem src/pages/manager/Export.tsx), CSV i PDF (reużyte wprost z src/lib/tpmExport.ts,
// żeby nie duplikować mechanizmu, który już działa gdzie indziej w apce).

import { exportCsv, printDocument, esc } from '@/lib/tpmExport'
import { changeTypeLabel, issueLogPriorityLabel, issueLogStatusLabel } from '@/lib/changeIssueLog'
import type { ChangeLogEntry, IssueLogEntry } from '@/types/database'

function one<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined
}

function machineName(entry: { machine?: { name: string } | { name: string }[] | null }): string {
  return one(entry.machine)?.name ?? '—'
}

function fullName(person: { full_name: string } | { full_name: string }[] | null | undefined): string {
  return one(person)?.full_name ?? '—'
}

function fmtDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('pl-PL')
}

// ─── Stałe brand (te same wartości co Export.tsx/ShiftStatPhotos.tsx) ───────
const NAVY = 'FF1A2744'
const GOLD = 'FFC9A84C'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EJS = any
declare global { interface Window { ExcelJS?: EJS } }

function getExcelJS(): EJS | undefined { return (window as unknown as { ExcelJS?: EJS }).ExcelJS }

function loadExcelJS(): Promise<EJS> {
  return new Promise((resolve, reject) => {
    const existing = getExcelJS()
    if (existing) { resolve(existing); return }
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js'
    s.onload = () => { const ejs = getExcelJS(); ejs ? resolve(ejs) : reject(new Error('ExcelJS niedostępny')) }
    s.onerror = () => reject(new Error('Nie udało się załadować ExcelJS'))
    document.head.appendChild(s)
  })
}

const THIN_BORDER = {
  top: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
  bottom: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
  left: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
  right: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } }
}

const setHeaderCell = (cell: EJS, value: string) => {
  cell.value = value
  cell.font = { name: 'Arial', bold: true, color: { argb: GOLD }, size: 9 }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  cell.border = { bottom: { style: 'medium', color: { argb: GOLD } } }
}

// Tytuł + separator - zwraca numer pierwszego wiersza nagłówka kolumn.
const addSheetHeader = (ws: EJS, title: string, colCount: number): number => {
  ws.mergeCells(1, 1, 1, colCount)
  const t = ws.getCell(1, 1)
  t.value = title
  t.font = { name: 'Arial', bold: true, size: 13, color: { argb: GOLD } }
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  t.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 28
  ws.mergeCells(2, 1, 2, colCount)
  ws.getCell(2, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } }
  ws.getRow(2).height = 3
  return 4
}

// ─── XLSX ────────────────────────────────────────────────────────────────────

export async function exportChangeIssueLogXlsx(
  changes: ChangeLogEntry[],
  issues: IssueLogEntry[],
  filenameSuffix: string
) {
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'MargoLine MES'
  wb.created = new Date()

  // Zmiany
  const changeCols = [
    { label: 'Data', width: 16 }, { label: 'Automat', width: 16 }, { label: 'Stacja', width: 12 },
    { label: 'Wprowadził', width: 18 }, { label: 'Typ zmiany', width: 14 }, { label: 'Przed', width: 20 },
    { label: 'Po', width: 20 }, { label: 'Powód', width: 30 }, { label: 'Zatwierdził', width: 18 }
  ]
  const changesWs = wb.addWorksheet('Zmiany')
  const changeHeaderRow = addSheetHeader(changesWs, 'Rejestr Zmian', changeCols.length)
  changeCols.forEach((c, ci) => {
    setHeaderCell(changesWs.getCell(changeHeaderRow, ci + 1), c.label)
    changesWs.getColumn(ci + 1).width = c.width
  })
  changes.forEach((entry, ri) => {
    const row = changeHeaderRow + 1 + ri
    const values = [
      fmtDate(entry.created_at), machineName(entry), entry.station ?? '—', fullName(entry.user),
      changeTypeLabel(entry.change_type), entry.value_before ?? '—', entry.value_after ?? '—',
      entry.reason, entry.approved_by ? fullName(entry.approver) : '—'
    ]
    values.forEach((value, ci) => {
      const cell = changesWs.getCell(row, ci + 1)
      cell.value = value
      cell.font = { name: 'Arial', size: 9 }
      cell.alignment = { vertical: 'top', wrapText: ci === 7 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ri % 2 === 0 ? 'FFF3F4F6' : 'FFFFFFFF' } }
      cell.border = THIN_BORDER
    })
  })
  changesWs.views = [{ state: 'frozen', ySplit: changeHeaderRow }]

  // Problemy
  const issueCols = [
    { label: 'Data', width: 16 }, { label: 'Automat', width: 16 }, { label: 'Stacja', width: 12 },
    { label: 'Zgłosił', width: 18 }, { label: 'Opis', width: 34 }, { label: 'Status', width: 16 },
    { label: 'Priorytet', width: 12 }, { label: 'Przypisany', width: 18 }, { label: 'Zamknięto', width: 16 },
    { label: 'Rozwiązanie', width: 30 }
  ]
  const issuesWs = wb.addWorksheet('Problemy')
  const issueHeaderRow = addSheetHeader(issuesWs, 'Rejestr Problemów', issueCols.length)
  issueCols.forEach((c, ci) => {
    setHeaderCell(issuesWs.getCell(issueHeaderRow, ci + 1), c.label)
    issuesWs.getColumn(ci + 1).width = c.width
  })
  issues.forEach((entry, ri) => {
    const row = issueHeaderRow + 1 + ri
    const values = [
      fmtDate(entry.created_at), machineName(entry), entry.station ?? '—', fullName(entry.reporter),
      entry.description, issueLogStatusLabel(entry.status), issueLogPriorityLabel(entry.priority),
      entry.assigned_to ? fullName(entry.assignee) : '—', entry.closed_at ? fmtDate(entry.closed_at) : '—',
      entry.resolution ?? '—'
    ]
    values.forEach((value, ci) => {
      const cell = issuesWs.getCell(row, ci + 1)
      cell.value = value
      cell.font = { name: 'Arial', size: 9 }
      cell.alignment = { vertical: 'top', wrapText: ci === 4 || ci === 9 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ri % 2 === 0 ? 'FFF3F4F6' : 'FFFFFFFF' } }
      cell.border = THIN_BORDER
    })
  })
  issuesWs.views = [{ state: 'frozen', ySplit: issueHeaderRow }]

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `Zmiany-i-problemy_${filenameSuffix}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

// ─── CSV (reużywa exportCsv z tpmExport.ts) ──────────────────────────────────

export function exportChangeLogCsv(changes: ChangeLogEntry[], filenameSuffix: string) {
  const header = ['Data', 'Automat', 'Stacja', 'Wprowadził', 'Typ zmiany', 'Przed', 'Po', 'Powód', 'Zatwierdził']
  const rows = changes.map(entry => [
    fmtDate(entry.created_at), machineName(entry), entry.station ?? '', fullName(entry.user),
    changeTypeLabel(entry.change_type), entry.value_before ?? '', entry.value_after ?? '',
    entry.reason, entry.approved_by ? fullName(entry.approver) : ''
  ])
  exportCsv(`Rejestr-zmian_${filenameSuffix}`, header, rows)
}

export function exportIssueLogCsv(issues: IssueLogEntry[], filenameSuffix: string) {
  const header = ['Data', 'Automat', 'Stacja', 'Zgłosił', 'Opis', 'Status', 'Priorytet', 'Przypisany', 'Zamknięto', 'Rozwiązanie']
  const rows = issues.map(entry => [
    fmtDate(entry.created_at), machineName(entry), entry.station ?? '', fullName(entry.reporter),
    entry.description, issueLogStatusLabel(entry.status), issueLogPriorityLabel(entry.priority),
    entry.assigned_to ? fullName(entry.assignee) : '', entry.closed_at ? fmtDate(entry.closed_at) : '',
    entry.resolution ?? ''
  ])
  exportCsv(`Rejestr-problemow_${filenameSuffix}`, header, rows)
}

// ─── PDF (druk-do-PDF, reużywa printDocument z tpmExport.ts) ────────────────

export function printChangeIssueLogSummary(
  changes: ChangeLogEntry[],
  issues: IssueLogEntry[],
  rangeLabel: string
) {
  const openIssues = issues.filter(i => i.status !== 'closed')
  const closedIssues = issues.filter(i => i.status === 'closed')

  const topProblems = [...issues.reduce((map, i) => {
    const name = machineName(i)
    map.set(name, (map.get(name) ?? 0) + 1)
    return map
  }, new Map<string, number>()).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  const body = `
    <h1>Transparentność Zmian i Problemów</h1>
    <div class="muted">Zakres: ${esc(rangeLabel)} · wygenerowano ${esc(new Date().toLocaleString('pl-PL'))}</div>

    <div class="summary">
      <strong>Podsumowanie</strong><br/>
      Zmiany: ${changes.length} · Problemy: ${issues.length} (otwarte: ${openIssues.length}, zamknięte: ${closedIssues.length})
    </div>

    <h2>Top problemy (wg liczby zgłoszeń na automat)</h2>
    <table>
      <tr><th>Automat</th><th>Liczba problemów</th></tr>
      ${topProblems.map(([name, count]) => `<tr><td>${esc(name)}</td><td>${count}</td></tr>`).join('')}
    </table>

    <h2>Ostatnie problemy (otwarte)</h2>
    <table>
      <tr><th>Data</th><th>Automat</th><th>Priorytet</th><th>Status</th><th>Opis</th></tr>
      ${openIssues.slice(0, 20).map(i => `<tr>
        <td>${esc(fmtDate(i.created_at))}</td><td>${esc(machineName(i))}</td>
        <td>${esc(issueLogPriorityLabel(i.priority))}</td><td>${esc(issueLogStatusLabel(i.status))}</td>
        <td>${esc(i.description)}</td>
      </tr>`).join('')}
    </table>

    <h2>Ostatnie zmiany</h2>
    <table>
      <tr><th>Data</th><th>Automat</th><th>Typ</th><th>Powód</th></tr>
      ${changes.slice(0, 20).map(c => `<tr>
        <td>${esc(fmtDate(c.created_at))}</td><td>${esc(machineName(c))}</td>
        <td>${esc(changeTypeLabel(c.change_type))}</td><td>${esc(c.reason)}</td>
      </tr>`).join('')}
    </table>
  `
  printDocument('Transparentność Zmian i Problemów', body)
}
