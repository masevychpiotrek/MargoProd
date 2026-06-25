// Narzędzia eksportu dla modułu TPM/PM — CSV, XLSX (ExcelJS z CDN), PDF (druk)

type Row = (string | number | null | undefined)[]

interface EJS { Workbook: new () => any }
function getExcelJS(): EJS | undefined { return (window as unknown as { ExcelJS?: EJS }).ExcelJS }

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportCsv(filename: string, header: string[], rows: Row[]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [header.map(esc).join(';'), ...rows.map(r => r.map(esc).join(';'))]
  // BOM dla poprawnego otwarcia polskich znaków w Excelu
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`)
}

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

export interface Sheet {
  name: string
  header: string[]
  rows: Row[]
}

export async function exportXlsx(filename: string, sheets: Sheet[]) {
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31))
    ws.addRow(sheet.header)
    ws.getRow(1).font = { bold: true }
    for (const r of sheet.rows) ws.addRow(r)
    ws.columns.forEach((col: any) => {
      let max = 10
      col.eachCell?.({ includeEmpty: true }, (cell: any) => {
        const len = cell.value ? String(cell.value).length : 0
        if (len > max) max = len
      })
      col.width = Math.min(max + 2, 60)
    })
  }
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  downloadBlob(blob, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

/** Otwiera okno druku z dokumentem HTML — użytkownik zapisuje jako PDF */
export function printDocument(title: string, bodyHtml: string) {
  const win = window.open('', '_blank', 'width=900,height=1000')
  if (!win) { alert('Zezwól na otwieranie okien, aby wygenerować PDF.'); return }
  win.document.write(`<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><title>${title}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 32px; line-height: 1.5; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      h2 { font-size: 15px; margin: 24px 0 8px; border-bottom: 2px solid #c9a84c; padding-bottom: 4px; }
      h3 { font-size: 13px; margin: 16px 0 6px; }
      table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 12px; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
      th { background: #f3f3f3; }
      .muted { color: #666; font-size: 12px; }
      .kv { display: grid; grid-template-columns: 200px 1fr; gap: 2px 12px; font-size: 12px; margin: 8px 0; }
      .kv div:nth-child(odd) { color: #666; }
      .box { border: 1px solid #ddd; border-radius: 6px; padding: 12px; margin: 8px 0; }
      .summary { background: #fff8e6; border: 1px solid #c9a84c; padding: 12px; border-radius: 6px; font-size: 12px; }
      img { max-width: 240px; max-height: 180px; margin: 4px; border: 1px solid #ccc; }
      @media print { button { display: none; } }
    </style></head><body>
    <button onclick="window.print()" style="position:fixed;top:12px;right:12px;padding:8px 16px;background:#c9a84c;border:none;border-radius:6px;font-weight:bold;cursor:pointer">Drukuj / Zapisz PDF</button>
    ${bodyHtml}
    </body></html>`)
  win.document.close()
}

export function esc(v: unknown): string {
  const s = v == null ? '' : String(v)
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
