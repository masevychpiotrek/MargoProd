import { useEffect, useMemo, useState } from 'react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { cn, efficiencyColor, getProductionDate } from '@/lib/utils'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const MONTHLY_TARGET_STORAGE_PREFIX = 'margoprod.monthly-target'

const CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#7B89A8' } },
    x: { grid: { display: false }, ticks: { color: '#7B89A8' } }
  }
}

function pieces(value: number) {
  return value.toLocaleString('pl-PL')
}

function pct(value: number, target: number) {
  return target > 0 ? Math.round(value / target * 100) : 0
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10)
}

function startOfMonth(year: string, month: string) {
  return `${year}-${month}-01`
}

function endOfMonth(year: string, month: string) {
  return iso(new Date(Number(year), Number(month), 0))
}

function daysInMonth(year: string, month: string) {
  return new Date(Number(year), Number(month), 0).getDate()
}

function monthTargetKey(year: string, month: string) {
  return `${MONTHLY_TARGET_STORAGE_PREFIX}.${year}-${month}`
}

function readStoredMonthlyTarget(year: string, month: string) {
  if (typeof window === 'undefined') return ''
  const value = window.localStorage.getItem(monthTargetKey(year, month)) ?? ''
  return value ? String(Math.max(0, Number.parseInt(value, 10) || 0)) : ''
}

export default function MonthlyTargetPanel() {
  const { profile } = useAuthStore()
  const productionDate = getProductionDate()
  const [month, setMonth] = useState(productionDate.slice(5, 7))
  const [year, setYear] = useState(productionDate.slice(0, 4))
  const [targetInput, setTargetInput] = useState(() => readStoredMonthlyTarget(productionDate.slice(0, 4), productionDate.slice(5, 7)))
  const [actual, setActual] = useState(0)
  const [loading, setLoading] = useState(true)

  const canEdit = profile?.role === 'manager' || profile?.role === 'admin'
  const monthlyTarget = Math.max(0, Number.parseInt(targetInput || '0', 10) || 0)

  useEffect(() => {
    setTargetInput(readStoredMonthlyTarget(year, month))
  }, [month, year])

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('hourly_reports')
        .select('good_count')
        .gte('report_date', startOfMonth(year, month))
        .lte('report_date', endOfMonth(year, month))
        .is('deleted_at', null)

      if (!active) return
      setActual((data ?? []).reduce((sum, row) => sum + (row.good_count ?? 0), 0))
      setLoading(false)
    }

    load()
    const channel = supabase.channel(`monthly-target-panel-${year}-${month}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_reports' }, load)
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [month, year])

  const progress = useMemo(() => {
    const today = getProductionDate()
    const monthStart = startOfMonth(year, month)
    const monthEnd = endOfMonth(year, month)
    const referenceDate = today < monthStart ? monthStart : today > monthEnd ? monthEnd : today
    const elapsedDays = Math.max(1, Number(referenceDate.slice(8, 10)))
    const totalDays = daysInMonth(year, month)
    const expectedToday = monthlyTarget > 0 ? Math.round(monthlyTarget * elapsedDays / totalDays) : 0
    return {
      elapsedDays,
      totalDays,
      expectedToday,
      remaining: Math.max(0, monthlyTarget - actual),
      gapToToday: expectedToday - actual,
      realization: pct(actual, monthlyTarget)
    }
  }, [actual, month, monthlyTarget, year])

  const chartData = {
    labels: ['Powinno', 'Jest', 'Cel'],
    datasets: [{
      label: 'szt',
      data: [progress.expectedToday, actual, monthlyTarget],
      backgroundColor: ['rgba(245,158,11,0.72)', 'rgba(34,197,94,0.78)', 'rgba(59,130,246,0.72)'],
      borderRadius: 4
    }]
  }

  const saveTarget = () => {
    if (monthlyTarget > 0) {
      window.localStorage.setItem(monthTargetKey(year, month), String(monthlyTarget))
      setTargetInput(String(monthlyTarget))
      return
    }
    window.localStorage.removeItem(monthTargetKey(year, month))
    setTargetInput('')
  }

  return (
    <aside className="hidden w-80 shrink-0 border-l border-navy-700 bg-navy-800/80 p-4 xl:block">
      <div className="sticky top-[76px] space-y-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-brand">Plan miesiaca</div>
          <div className="mt-1 text-lg font-black text-white">Realizacja</div>
        </div>

        <div className="rounded-2xl border border-navy-700 bg-navy-900 p-4">
          <div className="grid grid-cols-2 gap-2">
            <select className="input py-2" value={month} onChange={e => setMonth(e.target.value)}>
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(value => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
            <input className="input py-2" value={year} onChange={e => setYear(e.target.value)} />
          </div>

          {canEdit ? (
            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="label">Cel sztuk</span>
                <input
                  className="input font-mono text-lg font-bold"
                  type="number"
                  min="0"
                  step="1000"
                  value={targetInput}
                  onChange={e => setTargetInput(e.target.value)}
                  placeholder="1600000"
                />
              </label>
              <button type="button" className="btn-primary w-full py-2" onClick={saveTarget}>Zapisz cel</button>
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-navy-700 bg-navy-800 p-3">
              <div className="text-xs font-bold uppercase tracking-wider text-navy-500">Cel</div>
              <div className="mt-1 font-mono text-xl font-black text-brand">{monthlyTarget ? pieces(monthlyTarget) : '-'}</div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-brand/20 bg-navy-900 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-navy-500">Status dzis</div>
              <div className={cn('mt-1 font-mono text-2xl font-black', efficiencyColor(progress.realization))}>
                {loading ? '...' : `${progress.realization}%`}
              </div>
            </div>
            <span className={cn('rounded-full px-2.5 py-1 text-xs font-bold', progress.gapToToday > 0 ? 'bg-red-500/10 text-red-300' : 'bg-green-500/10 text-green-300')}>
              {monthlyTarget ? progress.gapToToday > 0 ? 'ponizej' : 'ok' : 'brak celu'}
            </span>
          </div>

          <div className="mt-4 h-44">
            {monthlyTarget > 0
              ? <Bar data={chartData} options={CHART_OPTIONS as never} />
              : <div className="flex h-full items-center justify-center text-center text-sm text-navy-500">Kierownik wpisuje cel miesieczny tutaj.</div>}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {[
            ['Jest teraz', `${pieces(actual)} szt`],
            ['Powinno byc', monthlyTarget ? `${pieces(progress.expectedToday)} szt` : '-'],
            ['Brakuje do celu', monthlyTarget ? `${pieces(progress.remaining)} szt` : '-'],
            ['Dni miesiaca', `${progress.elapsedDays}/${progress.totalDays}`]
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-navy-700 bg-navy-900 p-3">
              <div className="text-xs font-bold uppercase tracking-wider text-navy-500">{label}</div>
              <div className="mt-1 font-mono text-sm font-bold text-white">{loading && label === 'Jest teraz' ? '...' : value}</div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
