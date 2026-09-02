import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { formatJobCopyText, STANDARD_COMPONENTS, DREN_COMPONENTS } from '@/lib/productionJobs'
import type { ProductionJob, ProductionJobComponent, ProductionJobComponentHistory } from '@/types/database'

type JobRow = ProductionJob & {
  machine?: { name: string } | { name: string }[] | null
  operator?: { full_name: string } | { full_name: string }[] | null
}

type HistoryRow = ProductionJobComponentHistory & {
  changed_by_profile?: { full_name: string } | { full_name: string }[] | null
}

function one<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined
}

const NAVY = 'FF1A2744'
const GOLD = 'FFC9A84C'
const THIN_BORDER = {
  top: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
  bottom: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
  left: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
  right: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EJS = any
declare global {
  interface Window { ExcelJS?: EJS }
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

async function fetchJobs() {
  const { data } = await supabase
    .from('production_jobs')
    .select('*, machine:machines(name), operator:profiles!operator_id(full_name)')
    .order('started_at', { ascending: false })
    .limit(200)
  return (data ?? []) as JobRow[]
}

async function fetchComponents(jobId: string) {
  const { data } = await supabase
    .from('production_job_components')
    .select('*')
    .eq('job_id', jobId)
    .order('sort_order')
  return (data ?? []) as ProductionJobComponent[]
}

async function fetchHistory(jobId: string) {
  const { data } = await supabase
    .from('production_job_component_history')
    .select('*, changed_by_profile:profiles!changed_by(full_name)')
    .eq('job_id', jobId)
    .order('changed_at', { ascending: false })
  return (data ?? []) as HistoryRow[]
}

// Zbiorcze pobranie dla kopiowania wielu zleceń naraz (np. całego asortymentu) - jedno
// zapytanie na wiele job_id zamiast N osobnych zapytań per zlecenie.
async function fetchComponentsForJobs(jobIds: string[]) {
  if (!jobIds.length) return [] as ProductionJobComponent[]
  const { data } = await supabase
    .from('production_job_components')
    .select('*')
    .in('job_id', jobIds)
    .order('sort_order')
  return (data ?? []) as ProductionJobComponent[]
}

async function fetchHistoryForJobs(jobIds: string[]) {
  if (!jobIds.length) return [] as HistoryRow[]
  const { data } = await supabase
    .from('production_job_component_history')
    .select('*, changed_by_profile:profiles!changed_by(full_name)')
    .in('job_id', jobIds)
    .order('changed_at', { ascending: false })
  return (data ?? []) as HistoryRow[]
}

export default function ManagerProductionJobs() {
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterAssortment, setFilterAssortment] = useState('')

  const [selectedJob, setSelectedJob] = useState<JobRow | null>(null)
  const [components, setComponents] = useState<ProductionJobComponent[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [fallbackText, setFallbackText] = useState<string | null>(null)

  // Zbiorcze kopiowanie wszystkich (aktualnie widocznych po filtrach) zleceń naraz -
  // zamiast otwierać każde zlecenie z osobna i klikać "Kopiuj" pojedynczo, np. dla
  // wszystkich zleceń danego asortymentu w wybranym okresie.
  const [bulkCopyStatus, setBulkCopyStatus] = useState<'idle' | 'loading' | 'ok' | 'fail'>('idle')
  const [bulkFallbackText, setBulkFallbackText] = useState<string | null>(null)

  // Eksport do prawdziwego pliku XLSX - zamiast tekstu do wklejenia (ktory przy kilku
  // zleceniach tego samego asortymentu zlewal sie w jedna, nieczytelna mase), kazde
  // zlecenie dostaje wlasna, wyraznie oddzielona kolumne. Wzorzec 1:1 z
  // ShiftStatPhotos.tsx (kolumny=instancje, wiersze=parametry, zlota linia miedzy
  // grupami - tu grupa to asortyment zamiast automatu).
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportError, setExportError] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    setJobs(await fetchJobs())
    setLoading(false)
  }

  const openDetail = async (job: JobRow) => {
    setSelectedJob(job)
    setDetailLoading(true)
    setCopyStatus('idle')
    setFallbackText(null)
    const [comps, hist] = await Promise.all([fetchComponents(job.id), fetchHistory(job.id)])
    setComponents(comps)
    setHistory(hist)
    setDetailLoading(false)
  }

  // Lista asortymentów do filtra brana z faktycznie załadowanych zleceń (nie ze stałej
  // ASSORTMENTS) - zawsze zgodna z tym, co realnie jest w bazie, nawet jeśli lista
  // asortymentów się kiedyś zmieni.
  const assortmentOptions = [...new Set(jobs.map(j => j.assortment_name))].sort((a, b) => a.localeCompare(b, 'pl'))

  const filtered = jobs.filter(j => {
    if (filterAssortment && j.assortment_name !== filterAssortment) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return j.order_number.toLowerCase().includes(q) ||
      (j.series_number ?? '').toLowerCase().includes(q) ||
      j.assortment_name.toLowerCase().includes(q) ||
      (one(j.machine)?.name ?? '').toLowerCase().includes(q)
  })

  // Kopiuje dane WSZYSTKICH aktualnie widocznych (po filtrach: asortyment + szukajka)
  // zleceń naraz, jeden blok pod drugim - dokładnie ten sam format co pojedyncze
  // "Kopiuj dane zlecenia", tylko dla całego asortymentu (lub innego zestawu z filtra)
  // zamiast otwierania każdego zlecenia z osobna.
  const handleBulkCopy = async () => {
    if (filtered.length === 0) return
    setBulkCopyStatus('loading')
    setBulkFallbackText(null)
    try {
      const jobIds = filtered.map(j => j.id)
      const [allComponents, allHistory] = await Promise.all([
        fetchComponentsForJobs(jobIds),
        fetchHistoryForJobs(jobIds)
      ])
      const componentsByJob = new Map<string, ProductionJobComponent[]>()
      allComponents.forEach(c => {
        const arr = componentsByJob.get(c.job_id) ?? []
        arr.push(c)
        componentsByJob.set(c.job_id, arr)
      })
      const historyByJob = new Map<string, HistoryRow[]>()
      allHistory.forEach(h => {
        const arr = historyByJob.get(h.job_id) ?? []
        arr.push(h)
        historyByJob.set(h.job_id, arr)
      })

      const blocks = filtered.map(job => {
        const comps = componentsByJob.get(job.id) ?? []
        const hist = historyByJob.get(job.id) ?? []
        return formatJobCopyText({
          job,
          machineName: one(job.machine)?.name ?? '—',
          operatorName: one(job.operator)?.full_name ?? '—',
          components: comps,
          history: hist.map(h => ({
            ...h,
            component_label: comps.find(c => c.id === h.component_id)?.component_label,
            changed_by_name: one(h.changed_by_profile)?.full_name ?? '—'
          }))
        })
      })

      const divider = '\n\n' + '='.repeat(40) + '\n\n'
      const header = `Zbiorczy eksport zleceń${filterAssortment ? ` — asortyment: ${filterAssortment}` : ''} (${filtered.length} zleceń)\n${'='.repeat(40)}\n\n`
      const text = header + blocks.join(divider)

      try {
        await navigator.clipboard.writeText(text)
        setBulkCopyStatus('ok')
        setBulkFallbackText(null)
      } catch {
        setBulkCopyStatus('fail')
        setBulkFallbackText(text)
      }
    } catch {
      // blad pobrania danych (np. siec) - nie mamy tekstu do fallbacku, tylko status
      setBulkCopyStatus('fail')
    } finally {
      setTimeout(() => setBulkCopyStatus('idle'), 2500)
    }
  }

  const handleExportExcel = async () => {
    if (filtered.length === 0) return
    setExportingExcel(true)
    setExportError('')
    try {
      const jobIds = filtered.map(j => j.id)
      const [ExcelJS, allComponents] = await Promise.all([
        loadExcelJS(),
        fetchComponentsForJobs(jobIds)
      ])
      const componentsByJob = new Map<string, ProductionJobComponent[]>()
      allComponents.forEach(c => {
        const arr = componentsByJob.get(c.job_id) ?? []
        arr.push(c)
        componentsByJob.set(c.job_id, arr)
      })

      // Grupowanie po asortymencie, a w obrebie asortymentu chronologicznie - zeby
      // sasiednie kolumny byly kolejnymi zleceniami TEGO SAMEGO asortymentu, a nie
      // przeplatanka wynikajaca z sortowania czysto po dacie startu.
      const sortedJobs = filtered.slice().sort((a, b) =>
        a.assortment_name.localeCompare(b.assortment_name, 'pl') ||
        a.started_at.localeCompare(b.started_at)
      )

      const wb = new ExcelJS.Workbook()
      wb.creator = 'MargoLine MES'
      wb.created = new Date()

      // Podsumowanie - jeden wiersz na zlecenie, chronologicznie: dnia po dniu,
      // zmiana po zmianie, jaki automat montowal jaki asortyment i ile sztuk -
      // ten sam widok co glowna tabela na ekranie, ale w jednym, czytelnym arkuszu
      // zamiast rozproszony po kolumnach w arkuszu "Zlecenia" (kszaltki).
      const summaryWs = wb.addWorksheet('Podsumowanie')
      const summaryColumns = ['Data', 'Zmiana', 'Automat', 'Asortyment', 'Ilość szt.', 'Numer zlecenia', 'Seria', 'Operator', 'Status']
      const summaryWidths = [12, 9, 16, 22, 12, 16, 14, 20, 14]
      summaryWs.mergeCells(1, 1, 1, summaryColumns.length)
      const summaryTitle = summaryWs.getCell(1, 1)
      summaryTitle.value = 'Podsumowanie produkcji — dzień po dniu, zmiana po zmianie'
      summaryTitle.font = { name: 'Arial', bold: true, size: 13, color: { argb: GOLD } }
      summaryTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
      summaryTitle.alignment = { horizontal: 'center', vertical: 'middle' }
      summaryWs.getRow(1).height = 26

      const summaryHeaderRow = 3
      summaryColumns.forEach((label, ci) => {
        const cell = summaryWs.getCell(summaryHeaderRow, ci + 1)
        cell.value = label
        cell.font = { name: 'Arial', bold: true, color: { argb: GOLD }, size: 9 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
        summaryWs.getColumn(ci + 1).width = summaryWidths[ci]
      })

      const chronological = filtered.slice().sort((a, b) => a.started_at.localeCompare(b.started_at))
      let summaryRow = summaryHeaderRow + 1
      chronological.forEach((job, ri) => {
        const stripeColor = ri % 2 === 0 ? 'FFF3F4F6' : 'FFFFFFFF'
        const cells: (string | number)[] = [
          new Date(job.started_at).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }),
          job.shift_type ?? '—',
          one(job.machine)?.name ?? '—',
          job.assortment_name,
          job.calculated_qty.toLocaleString('pl-PL'),
          job.order_number,
          job.series_number ?? '—',
          one(job.operator)?.full_name ?? '—',
          job.status === 'confirmed' ? 'Zatwierdzone' : 'W trakcie'
        ]
        cells.forEach((value, ci) => {
          const cell = summaryWs.getCell(summaryRow, ci + 1)
          cell.value = value
          cell.font = { name: 'Arial', size: 9, bold: ci === 4 }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stripeColor } }
          cell.alignment = { horizontal: ci === 4 ? 'right' : 'left', vertical: 'middle' }
          cell.border = THIN_BORDER
        })
        summaryRow += 1
      })
      summaryWs.views = [{ state: 'frozen', ySplit: summaryHeaderRow }]

      const ws = wb.addWorksheet('Zlecenia')

      const metaLabels = ['Numer zlecenia', 'Seria', 'Automat', 'Zmiana', 'Operator', 'Start', 'Ilość szt.', 'Status']
      const firstDataCol = 2
      const titleText = filterAssortment ? `Zlecenia produkcyjne — ${filterAssortment}` : 'Zlecenia produkcyjne'

      ws.mergeCells(1, 1, 1, Math.max(sortedJobs.length + 1, 2))
      const title = ws.getCell(1, 1)
      title.value = titleText
      title.font = { name: 'Arial', bold: true, size: 13, color: { argb: GOLD } }
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
      title.alignment = { horizontal: 'center', vertical: 'middle' }
      ws.getRow(1).height = 26

      if (sortedJobs.length === 0) {
        const cell = ws.getCell(3, 1)
        cell.value = 'Brak zleceń dla wybranych filtrów.'
        cell.font = { name: 'Arial', italic: true, size: 9, color: { argb: 'FF6B7280' } }
      } else {
        const metaHeaderRow = 3
        const standardStartRow = metaHeaderRow + metaLabels.length + 1
        const drenStartRow = standardStartRow + 1 + STANDARD_COMPONENTS.length + 1

        ws.getColumn(1).width = 26
        sortedJobs.forEach((_, ci) => { ws.getColumn(firstDataCol + ci).width = 18 })

        // Gruba zlota linia na koncu bloku kolumn kazdego asortymentu - oddziela
        // wizualnie np. "IS PRO 150 cm" od "IS PRO AIR PASS 150 cm".
        const groupEndBorder = { style: 'medium' as const, color: { argb: GOLD } }
        const isLastOfGroup = sortedJobs.map((job, ci) => {
          const next = sortedJobs[ci + 1]
          return !next || next.assortment_name !== job.assortment_name
        })

        metaLabels.forEach((label, ri) => {
          const cell = ws.getCell(metaHeaderRow + ri, 1)
          cell.value = label
          cell.font = { name: 'Arial', bold: true, color: { argb: GOLD }, size: 9 }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
          cell.alignment = { vertical: 'middle' }
        })

        sortedJobs.forEach((job, ci) => {
          const col = firstDataCol + ci
          const metaValues = [
            job.order_number,
            job.series_number ?? '—',
            one(job.machine)?.name ?? '—',
            job.shift_type ?? '—',
            one(job.operator)?.full_name ?? '—',
            new Date(job.started_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            job.calculated_qty.toLocaleString('pl-PL'),
            job.status === 'confirmed' ? 'Zatwierdzone' : 'W trakcie'
          ]
          metaValues.forEach((value, ri) => {
            const cell = ws.getCell(metaHeaderRow + ri, col)
            cell.value = value
            cell.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FFE5E9F2' } }
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF24345A' } }
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
            if (isLastOfGroup[ci]) cell.border = { right: groupEndBorder }
          })
        })

        const renderSection = (sectionTitle: string, startRow: number, defs: typeof STANDARD_COMPONENTS) => {
          const sectionCell = ws.getCell(startRow, 1)
          sectionCell.value = sectionTitle
          sectionCell.font = { name: 'Arial', bold: true, color: { argb: GOLD }, size: 9 }
          sectionCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
          sortedJobs.forEach((_, ci) => {
            const cell = ws.getCell(startRow, firstDataCol + ci)
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
            if (isLastOfGroup[ci]) cell.border = { right: groupEndBorder }
          })

          defs.forEach((def, ri) => {
            const row = startRow + 1 + ri
            const stripeColor = ri % 2 === 0 ? 'FFF3F4F6' : 'FFFFFFFF'

            const labelCell = ws.getCell(row, 1)
            labelCell.value = def.label
            labelCell.font = { name: 'Arial', bold: true, size: 9 }
            labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stripeColor } }
            labelCell.alignment = { vertical: 'middle' }
            labelCell.border = THIN_BORDER

            sortedJobs.forEach((job, ci) => {
              const col = firstDataCol + ci
              const comp = componentsByJob.get(job.id)?.find(c => c.component_key === def.key)
              const cell = ws.getCell(row, col)
              cell.value = comp?.batch_number ?? ''
              cell.font = { name: 'Arial', size: 9 }
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stripeColor } }
              cell.alignment = { horizontal: 'right', vertical: 'middle' }
              cell.border = isLastOfGroup[ci] ? { ...THIN_BORDER, right: groupEndBorder } : THIN_BORDER
            })
          })
        }

        renderSection('Półfabrykaty', standardStartRow, STANDARD_COMPONENTS)
        renderSection('Dren', drenStartRow, DREN_COMPONENTS)

        ws.views = [{ state: 'frozen', xSplit: 1, ySplit: metaHeaderRow - 1 }]
      }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Zlecenia-produkcyjne_${new Date().toISOString().slice(0, 10)}.xlsx`
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

  const handleCopy = async () => {
    if (!selectedJob) return
    const text = formatJobCopyText({
      job: selectedJob,
      machineName: one(selectedJob.machine)?.name ?? '—',
      operatorName: one(selectedJob.operator)?.full_name ?? '—',
      components,
      history: history.map(h => ({
        ...h,
        component_label: components.find(c => c.id === h.component_id)?.component_label,
        changed_by_name: one(h.changed_by_profile)?.full_name ?? '—'
      }))
    })
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus('ok')
      setFallbackText(null)
    } catch {
      setCopyStatus('fail')
      setFallbackText(text)
    }
    setTimeout(() => setCopyStatus('idle'), 2500)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Zlecenia produkcyjne</h1>
          <p className="text-navy-400 mt-1">{jobs.length} zleceń</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Szukaj po numerze zlecenia, serii, asortymencie, automacie..."
          className="input w-full max-w-md"
        />
        <select value={filterAssortment} onChange={e => setFilterAssortment(e.target.value)} className="input w-auto">
          <option value="">Wszystkie asortymenty</option>
          {assortmentOptions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <button
          onClick={handleExportExcel}
          disabled={exportingExcel || filtered.length === 0}
          className="btn-primary whitespace-nowrap disabled:opacity-40"
        >
          {exportingExcel ? 'Generowanie...' : `📊 Eksportuj do Excela (${filtered.length})`}
        </button>
        <button
          onClick={handleBulkCopy}
          disabled={bulkCopyStatus === 'loading' || filtered.length === 0}
          className="btn-secondary whitespace-nowrap disabled:opacity-40"
        >
          {bulkCopyStatus === 'loading' ? 'Pobieranie...'
            : bulkCopyStatus === 'ok' ? 'Skopiowano ✓'
            : bulkCopyStatus === 'fail' ? 'Nie udało się — zaznacz poniżej'
            : `Kopiuj wszystkie widoczne (${filtered.length})`}
        </button>
      </div>

      {exportError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{exportError}</div>
      )}

      {bulkFallbackText && (
        <textarea readOnly value={bulkFallbackText} onClick={e => (e.target as HTMLTextAreaElement).select()}
          className="input font-mono text-xs min-h-[160px] w-full" />
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700">
                {['Numer zlecenia', 'Seria', 'Automat', 'Zmiana', 'Operator', 'Asortyment', 'Ilość szt.', 'Start', 'Status'].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-8 text-navy-500">Ładowanie...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-navy-500">Brak zleceń</td></tr>
              ) : filtered.map(job => (
                <tr key={job.id} onClick={() => openDetail(job)}
                  className="border-b border-navy-800 hover:bg-navy-800/50 cursor-pointer">
                  <td className="py-2.5 px-4 font-mono text-white">{job.order_number}</td>
                  <td className="py-2.5 px-4 font-mono text-navy-300">{job.series_number ?? '—'}</td>
                  <td className="py-2.5 px-4"><span className="status-info text-xs">{one(job.machine)?.name ?? '—'}</span></td>
                  <td className="py-2.5 px-4 font-bold text-white">{job.shift_type}</td>
                  <td className="py-2.5 px-4 text-navy-200">{one(job.operator)?.full_name ?? '—'}</td>
                  <td className="py-2.5 px-4 text-navy-200">{job.assortment_name}</td>
                  <td className="py-2.5 px-4 font-mono font-bold text-white">{job.calculated_qty.toLocaleString('pl-PL')}</td>
                  <td className="py-2.5 px-4 font-mono text-xs text-navy-400">{new Date(job.started_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="py-2.5 px-4">
                    <span className={cn(
                      'text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border',
                      job.status === 'confirmed' ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    )}>
                      {job.status === 'confirmed' ? 'Zatwierdzone' : 'W trakcie'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.85)', backdropFilter: 'blur(8px)' }}>
          <div className="bg-navy-800 border border-navy-600 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">{selectedJob.order_number}</h2>
                <p className="text-navy-400 text-sm">{selectedJob.series_number}</p>
              </div>
              <button onClick={() => setSelectedJob(null)} className="text-navy-400 hover:text-white text-xl leading-none">✕</button>
            </div>

            {detailLoading ? (
              <div className="text-center py-8 text-navy-500">Ładowanie...</div>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <div><div className="text-navy-500 text-xs">Automat</div><div className="text-white">{one(selectedJob.machine)?.name ?? '—'}</div></div>
                  <div><div className="text-navy-500 text-xs">Zmiana</div><div className="text-white">{selectedJob.shift_type}</div></div>
                  <div><div className="text-navy-500 text-xs">Operator</div><div className="text-white">{one(selectedJob.operator)?.full_name ?? '—'}</div></div>
                  <div><div className="text-navy-500 text-xs">Asortyment</div><div className="text-white">{selectedJob.assortment_name}</div></div>
                  <div><div className="text-navy-500 text-xs">Liczba etykiet</div><div className="font-mono text-white">{selectedJob.label_count}</div></div>
                  <div><div className="text-navy-500 text-xs">Przelicznik</div><div className="font-mono text-white">{selectedJob.multiplier}</div></div>
                  <div><div className="text-navy-500 text-xs">Ilość sztuk</div><div className="font-mono text-brand font-bold">{selectedJob.calculated_qty.toLocaleString('pl-PL')}</div></div>
                  <div className="col-span-2"><div className="text-navy-500 text-xs">Start</div><div className="text-white">{new Date(selectedJob.started_at).toLocaleString('pl-PL')}</div></div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-2">Półfabrykaty</div>
                  <div className="space-y-1">
                    {components.filter(c => !c.is_dren).map(c => (
                      <div key={c.id} className="flex justify-between text-sm border-b border-navy-800 py-1.5">
                        <span className="text-navy-300">{c.component_label}</span>
                        <span className="font-mono text-white">{c.batch_number ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-2">Dren</div>
                  <div className="space-y-1">
                    {components.filter(c => c.is_dren).map(c => (
                      <div key={c.id} className="flex justify-between text-sm border-b border-navy-800 py-1.5">
                        <span className="text-navy-300">{c.component_label}</span>
                        <span className="font-mono text-white">{c.batch_number ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {history.length > 0 && (
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-2">Historia wymian</div>
                    <div className="space-y-1.5">
                      {history.map(h => (
                        <div key={h.id} className="text-xs text-navy-300">
                          {new Date(h.changed_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{' '}
                          <span className="text-white font-semibold">{components.find(c => c.id === h.component_id)?.component_label ?? '—'}</span>
                          {' '}z <span className="font-mono">{h.previous_batch_number ?? '—'}</span> na <span className="font-mono text-white">{h.new_batch_number}</span>
                          {' '}· {one(h.changed_by_profile)?.full_name ?? '—'}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button onClick={handleCopy} className="btn-primary w-full py-3">
                  {copyStatus === 'ok' ? 'Skopiowano ✓' : copyStatus === 'fail' ? 'Nie udało się skopiować — zaznacz poniżej' : 'Kopiuj dane zlecenia'}
                </button>

                {fallbackText && (
                  <textarea readOnly value={fallbackText} onClick={e => (e.target as HTMLTextAreaElement).select()}
                    className="input font-mono text-xs min-h-[160px]" />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
