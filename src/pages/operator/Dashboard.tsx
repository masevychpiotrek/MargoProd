import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShiftStore } from '@/stores/shiftStore'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { useHourCountdown, useCurrentHourBlock, useClock } from '@/hooks/useClock'
import { efficiencyColor, efficiencyBg, formatHourBlock, cn } from '@/lib/utils'
import type { HourlyReport } from '@/types/database'

const TARGET = 2100

export default function OperatorDashboard() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { activeShift, activeMachine } = useShiftStore()
  const { display: countdown, isUrgent, seconds } = useHourCountdown()
  const hourBlock = useCurrentHourBlock()
  const { hour, time, date } = useClock()
  const [reports, setReports] = useState<HourlyReport[]>([])

  useEffect(() => {
    // Auto-detect shift for operator_2
    const { loadActiveShift } = useShiftStore.getState()
    loadActiveShift()
  }, [])

  useEffect(() => {
    if (activeShift) loadReports()
  }, [activeShift])

  const loadReports = async () => {
    if (!activeShift) return
    const { data } = await supabase
      .from('hourly_reports').select('*')
      .eq('shift_id', activeShift.id).is('deleted_at', null).order('hour_start')
    if (data) setReports(data as HourlyReport[])
  }

  const currentHourReported = reports.some(r => r.hour_start === hour)
  const totalGood = reports.reduce((s, r) => s + r.good_count, 0)
  const totalReject = reports.reduce((s, r) => s + r.reject_count, 0)
  const avgEff = reports.length > 0
    ? Math.round(reports.reduce((s, r) => s + Number(r.efficiency_pct), 0) / reports.length) : 0

  return (
    <div className="space-y-5 page-enter">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-white">Witaj, {profile?.full_name?.split(' ')[0]}!</h1>
        <p className="text-navy-400 mt-1">{date} · {time}</p>
      </div>

      {/* No active shift */}
      {!activeShift && (
        <div className="card text-center py-10">
          <div className="text-5xl mb-4">🏭</div>
          <h2 className="text-xl font-bold text-white mb-2">Brak aktywnej zmiany</h2>
          <p className="text-navy-400 mb-6">Rozpocznij zmianę żeby móc wpisywać wyniki godzinowe</p>
          <button onClick={() => navigate('/operator/shift')} className="btn-primary px-8 py-3">
            🚀 Rozpocznij zmianę
          </button>
        </div>
      )}

      {/* Active shift */}
      {activeShift && (
        <>
          {/* Alert - report due */}
          {!currentHourReported && (
            <div className={cn('rounded-2xl p-4 border', isUrgent
              ? 'bg-red-500/10 border-red-500/30 alert-pulse-border'
              : 'bg-amber-500/10 border-amber-500/30'
            )}>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className={cn('font-bold text-lg', isUrgent ? 'text-red-400' : 'text-amber-400')}>
                    {isUrgent ? '⚠ CZAS NA WPIS GODZINY!' : '⏰ Pamiętaj o wpisaniu wyniku'}
                  </div>
                  <div className="text-sm text-navy-300 mt-0.5">
                    Raport za godzinę <span className="font-bold text-white">{hourBlock}</span> nie został jeszcze wpisany
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn('text-3xl font-bold font-mono', isUrgent ? 'text-red-400' : 'text-white')}>
                    {countdown}
                  </div>
                  <div className="text-xs text-navy-400">do końca godziny</div>
                </div>
              </div>
              <button onClick={() => navigate('/operator/report')} className="btn-primary w-full mt-3 py-3">
                ✏️ Wpisz teraz
              </button>
            </div>
          )}

          {currentHourReported && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">✅</span>
                <div>
                  <div className="font-bold text-green-400">Raport za {hourBlock} wpisany</div>
                  <div className="text-sm text-navy-400">Następny raport za <span className="font-bold text-white font-mono">{countdown}</span></div>
                </div>
              </div>
            </div>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="kpi-card kpi-animate" style={{ '--before-bg': 'var(--brand)', animationDelay: '0ms' } as React.CSSProperties}>
              <div className="kpi-label">Produkcja łącznie</div>
              <div className="kpi-value">{totalGood.toLocaleString('pl-PL')}</div>
              <div className="kpi-sub">szt. tej zmiany</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Śr. efektywność</div>
              <div className={cn('kpi-value', efficiencyColor(avgEff))}>{avgEff > 0 ? avgEff + '%' : '—'}</div>
              <div className="kpi-sub">vs target {TARGET} szt/h</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Odrzut łącznie</div>
              <div className="kpi-value text-red-400">{totalReject}</div>
              <div className="kpi-sub">szt. tej zmiany</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Raportów</div>
              <div className="kpi-value">{reports.length}</div>
              <div className="kpi-sub">z {activeMachine?.name}</div>
            </div>
          </div>

          {/* Reports list */}
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Raporty tej zmiany</div>
                <div className="card-sub">{activeMachine?.name} · Zmiana {activeShift.shift_type}</div>
              </div>
              <button onClick={() => navigate('/operator/report')} className="btn-primary text-xs py-1.5 px-3">
                + Nowy raport
              </button>
            </div>
            {reports.length === 0 ? (
              <div className="text-center py-8 text-navy-500">Brak raportów — zacznij wpisywać wyniki!</div>
            ) : (
              <div className="space-y-2">
                {reports.map(r => {
                  const eff = Number(r.efficiency_pct)
                  return (
                    <div key={r.id} className="bg-navy-900 rounded-xl p-3 flex items-center gap-4">
                      <div className="font-mono text-sm text-navy-400 w-24 flex-shrink-0">{r.hour_block}</div>
                      <div className="flex-1">
                        <div className="h-2 bg-navy-700 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full', efficiencyBg(eff))}
                            style={{ width: `${Math.min(eff, 100)}%` }} />
                        </div>
                      </div>
                      <div className="font-bold text-white font-mono w-20 text-right">
                        {r.good_count.toLocaleString('pl-PL')} szt
                      </div>
                      <div className={cn('font-bold text-sm w-12 text-right', efficiencyColor(eff))}>
                        {eff}%
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
