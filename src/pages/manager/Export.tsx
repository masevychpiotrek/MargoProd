import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { efficiencyColor, cn } from '@/lib/utils'
import type { HourlyReport, Machine } from '@/types/database'

const TARGET = 3200

interface ReportData {
  reports: HourlyReport[]
  machines: Machine[]
  dateFrom: string
  dateTo: string
}

interface XLSXApi {
  utils: {
    json_to_sheet: (rows: Record<string, unknown>[]) => unknown
    book_new: () => unknown
    book_append_sheet: (workbook: unknown, worksheet: unknown, name: string) => void
  }
  writeFile: (workbook: unknown, fileName: string) => void
}

export default function ManagerExport() {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7)
    return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [selMachine, setSelMachine] = useState('')
  const [selShift, setSelShift] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ReportData | null>(null)
  const [machines, setMachines] = useState<Machine[]>([])

  useEffect(() => {
    supabase.from('machines').select('*').eq('is_active', true).then(({ data }) => {
      if (data) setMachines(data as Machine[])
    })
  }, [])

  const loadData = async () => {
    setLoading(true)
    let q = supabase.from('hourly_reports').select('*')
      .gte('report_date', dateFrom).lte('report_date', dateTo)
      .is('deleted_at', null).order('report_date').order('hour_start')
    if (selMachine) q = q.eq('machine_id', selMachine)
    if (selShift) {
      // filter by shift via joined shifts table - approximate by hour
      const shiftHours: Record<string, number[]> = {
        'I':   [6,7,8,9,10,11,12,13],
        'II':  [14,15,16,17,18,19,20,21],
        'III': [22,23,0,1,2,3,4,5]
      }
      if (shiftHours[selShift]) q = q.in('hour_start', shiftHours[selShift])
    }
    const { data: reports } = await q
    setData({ reports: (reports ?? []) as HourlyReport[], machines, dateFrom, dateTo })
    setLoading(false)
  }

  const exportExcel = () => {
    if (!data) return
    const XLSX = (window as unknown as { XLSX?: XLSXApi }).XLSX
    if (!XLSX) { alert('Ładowanie biblioteki Excel...'); loadXLSX().then(exportExcel); return }

    const rows = data.reports.map(r => {
      const m = data.machines.find(m => m.id === r.machine_id)
      return {
        'Data': r.report_date,
        'Godzina': r.hour_block,
        'Maszyna': m?.name ?? '—',
        'Przyrost dobrych': r.good_count,
        'Odrzut': r.reject_count,
        'Wyroby łącznie': r.total_count ?? '',
        'Cel': r.target,
        'Efektywność %': Number(r.efficiency_pct),
        'Czas pracy (min)': r.runtime_min,
        'Postój (min)': r.downtime_min,
        'Mikroprzestoje (min)': r.micro_stoppage_min,
        'Przezbrojenie (min)': r.changeover_min,
        'Awaria (min)': r.failure_min,
        'Przyczyna': r.downtime_reason ?? '',
        'Uwagi': r.notes ?? ''
      }
    })

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Raporty')

    // Summary sheet
    const summaryByDate: Record<string, { good: number, reject: number, count: number }> = {}
    data.reports.forEach(r => {
      if (!summaryByDate[r.report_date]) summaryByDate[r.report_date] = { good: 0, reject: 0, count: 0 }
      summaryByDate[r.report_date].good += r.good_count
      summaryByDate[r.report_date].reject += r.reject_count
      summaryByDate[r.report_date].count++
    })
    const summaryRows = Object.entries(summaryByDate).map(([date, s]) => ({
      'Data': date,
      'Produkcja łącznie': s.good,
      'Odrzut łącznie': s.reject,
      'Liczba wpisów': s.count,
      'Śr. efektywność %': s.count > 0 ? Math.round(s.good / (s.count * TARGET) * 100) : 0
    }))
    const ws2 = XLSX.utils.json_to_sheet(summaryRows)
    XLSX.utils.book_append_sheet(wb, ws2, 'Podsumowanie')

    XLSX.writeFile(wb, `MargoProd_${dateFrom}_${dateTo}.xlsx`)
  }

  const exportPDF = () => {
    if (!data) return
    window.print()
  }

  const loadXLSX = () => new Promise<void>(resolve => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
    s.onload = () => resolve()
    document.head.appendChild(s)
  })

  // Stats
  const totalGood   = data?.reports.reduce((s, r) => s + r.good_count, 0) ?? 0
  const totalReject = data?.reports.reduce((s, r) => s + r.reject_count, 0) ?? 0
  const avgEff = data && data.reports.length > 0
    ? Math.round(data.reports.reduce((s, r) => s + Number(r.efficiency_pct), 0) / data.reports.length) : 0
  const totalDowntime = data?.reports.reduce((s, r) => s + r.downtime_min + r.failure_min, 0) ?? 0

  return (
    <>
      {/* Print styles */}
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

        {/* Filters */}
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

        {/* Preview */}
        {data && (
          <>
            {/* KPI summary */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { l: 'Produkcja łącznie', v: totalGood.toLocaleString('pl-PL') + ' szt', c: 'text-brand' },
                { l: 'Śr. efektywność', v: avgEff + '%', c: efficiencyColor(avgEff) },
                { l: 'Odrzut łącznie', v: totalReject.toLocaleString('pl-PL') + ' szt', c: 'text-red-400' },
                { l: 'Przestoje łącznie', v: totalDowntime + ' min', c: 'text-amber-400' },
              ].map(k => (
                <div key={k.l} className="kpi-card">
                  <div className="kpi-label">{k.l}</div>
                  <div className={cn('kpi-value', k.c)}>{k.v}</div>
                  <div className="kpi-sub">{data.reports.length} wpisów · {dateFrom} – {dateTo}</div>
                </div>
              ))}
            </div>

            {/* Export buttons */}
            <div className="flex gap-3 flex-wrap">
              <button onClick={() => { loadXLSX().then(exportExcel) }}
                className="btn-primary px-6 py-3 text-base">
                📊 Pobierz Excel (.xlsx)
              </button>
              <button onClick={exportPDF}
                className="btn-secondary px-6 py-3 text-base">
                🖨️ Drukuj / Zapisz PDF
              </button>
            </div>

            {/* Data preview table */}
            <div className="card">
              <div className="card-header">
                <div><div className="card-title">Podgląd danych</div><div className="card-sub">{data.reports.length} rekordów</div></div>
              </div>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="sticky top-0">
                    <tr className="border-b border-navy-700 bg-navy-800">
                      {['Data','Godzina','Maszyna','Przyrost','Odrzut','Efektywność','Czas pracy','Przestój','Uwagi'].map(h => (
                        <th key={h} className="text-left py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.reports.map(r => {
                      const eff = Number(r.efficiency_pct)
                      const m = data.machines.find(m => m.id === r.machine_id)
                      return (
                        <tr key={r.id} className="border-b border-navy-800 hover:bg-navy-800/40">
                          <td className="py-1.5 px-3 font-mono text-navy-400">{r.report_date}</td>
                          <td className="py-1.5 px-3 font-mono text-white">{r.hour_block}</td>
                          <td className="py-1.5 px-3 text-navy-300">{m?.name ?? '—'}</td>
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
          <div style={{ borderBottom: '2px solid #000', paddingBottom: '10px', marginBottom: '16px' }}>
            <h1 style={{ fontSize: '20px', margin: 0 }}>MargoProd MES — Raport produkcji</h1>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#555' }}>
              Okres: {dateFrom} – {dateTo} · Wygenerowano: {new Date().toLocaleString('pl-PL')}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
            {[
              { l: 'Produkcja łącznie', v: totalGood.toLocaleString('pl-PL') + ' szt' },
              { l: 'Śr. efektywność', v: avgEff + '%' },
              { l: 'Odrzut łącznie', v: totalReject.toLocaleString('pl-PL') + ' szt' },
              { l: 'Przestoje łącznie', v: totalDowntime + ' min' },
            ].map(k => (
              <div key={k.l} style={{ border: '1px solid #ddd', borderRadius: '6px', padding: '10px' }}>
                <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', marginBottom: '4px' }}>{k.l}</div>
                <div style={{ fontSize: '20px', fontWeight: 'bold' }}>{k.v}</div>
              </div>
            ))}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr style={{ background: '#f0f0f0' }}>
                {['Data','Godzina','Maszyna','Przyrost','Odrzut','Efekt.%','Czas pr.','Postój','Uwagi'].map(h => (
                  <th key={h} style={{ border: '1px solid #ccc', padding: '5px 7px', textAlign: 'left', fontWeight: 'bold' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.reports.map((r, i) => {
                const m = data.machines.find(m => m.id === r.machine_id)
                return (
                  <tr key={r.id} style={{ background: i % 2 === 0 ? '#fff' : '#f9f9f9' }}>
                    <td style={{ border: '1px solid #ccc', padding: '4px 7px' }}>{r.report_date}</td>
                    <td style={{ border: '1px solid #ccc', padding: '4px 7px', fontFamily: 'monospace' }}>{r.hour_block}</td>
                    <td style={{ border: '1px solid #ccc', padding: '4px 7px' }}>{m?.name ?? '—'}</td>
                    <td style={{ border: '1px solid #ccc', padding: '4px 7px', fontWeight: 'bold' }}>{r.good_count.toLocaleString('pl-PL')}</td>
                    <td style={{ border: '1px solid #ccc', padding: '4px 7px' }}>{r.reject_count || '—'}</td>
                    <td style={{ border: '1px solid #ccc', padding: '4px 7px', fontWeight: 'bold', color: Number(r.efficiency_pct) >= 90 ? '#16a34a' : Number(r.efficiency_pct) >= 70 ? '#d97706' : '#dc2626' }}>
                      {r.efficiency_pct}%
                    </td>
                    <td style={{ border: '1px solid #ccc', padding: '4px 7px' }}>{r.runtime_min}min</td>
                    <td style={{ border: '1px solid #ccc', padding: '4px 7px' }}>{(r.downtime_min + r.failure_min) > 0 ? (r.downtime_min + r.failure_min) + 'min' : '—'}</td>
                    <td style={{ border: '1px solid #ccc', padding: '4px 7px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.notes || r.downtime_reason || '—'}</td>
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
