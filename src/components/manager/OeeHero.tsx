import { cn, efficiencyColor, efficiencyBg } from '@/lib/utils'
import { WORLD_CLASS_OEE } from '@/lib/oee'

interface OeeHeroProps {
  loading: boolean
  oee: number | null
  oeeAvailability: number | null
  oeePerformance: number | null
  oeeQuality: number | null
  theoreticalMaxPieces: number
  lossAvailabilityPieces: number
  lossPerformancePieces: number
  lossQualityPieces: number
  goodPieces: number
  planGood: number
  planTarget: number
  planAttainmentPct: number
}

// Pierscieniowy wskaznik OEE - pelne kolo, wypelnienie proporcjonalne do %.
function OeeRing({ pct }: { pct: number | null }) {
  const r = 78
  const circumference = 2 * Math.PI * r
  const clamped = pct == null ? 0 : Math.max(0, Math.min(100, pct))
  const filled = circumference * clamped / 100
  const colorClass = pct == null ? 'text-navy-600' : efficiencyColor(pct)
  return (
    <svg viewBox="0 0 200 200" className="w-44 h-44 sm:w-52 sm:h-52 -rotate-90">
      <circle cx="100" cy="100" r={r} strokeWidth="18" fill="none" className="text-navy-700" stroke="currentColor" />
      <circle
        cx="100" cy="100" r={r} strokeWidth="18" fill="none" strokeLinecap="round"
        className={colorClass} stroke="currentColor"
        strokeDasharray={`${filled} ${circumference}`}
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
    </svg>
  )
}

function MetricBar({ label, sub, value }: { label: string; sub: string; value: number | null }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-navy-400">{label}</span>
        <span className={cn('text-lg font-bold font-mono', value == null ? 'text-navy-500' : efficiencyColor(value))}>
          {value == null ? '—' : `${value}%`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-navy-900 mt-1.5 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', value == null ? 'bg-navy-700' : efficiencyBg(value))}
          style={{ width: `${value == null ? 0 : Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
      <div className="text-[11px] text-navy-500 mt-1">{sub}</div>
    </div>
  )
}

// "Six Big Losses" przelozone na sztuki - jeden pasek pokazujacy z czego
// sklada sie teoretyczne maksimum produkcji: dobra produkcja + trzy kategorie
// strat (dostepnosc/wydajnosc/jakosc), zeby kierownik widzial NA CZYM traci OEE.
function LossWaterfall(props: {
  theoreticalMaxPieces: number
  lossAvailabilityPieces: number
  lossPerformancePieces: number
  lossQualityPieces: number
  goodPieces: number
}) {
  const { theoreticalMaxPieces, lossAvailabilityPieces, lossPerformancePieces, lossQualityPieces, goodPieces } = props
  if (theoreticalMaxPieces <= 0) {
    return <div className="text-xs text-navy-500 py-3">Brak rozliczenia czasu zmian — straty pojawią się po zamknięciu zmian z rozliczeniem.</div>
  }
  const segments = [
    { key: 'good', label: 'Produkcja dobra', value: goodPieces, color: 'bg-green-500', text: 'text-green-400' },
    { key: 'quality', label: 'Strata jakości (odrzut)', value: lossQualityPieces, color: 'bg-red-500', text: 'text-red-400' },
    { key: 'performance', label: 'Strata wydajności (tempo)', value: lossPerformancePieces, color: 'bg-amber-500', text: 'text-amber-400' },
    { key: 'availability', label: 'Strata dostępności (postoje/alarmy)', value: lossAvailabilityPieces, color: 'bg-slate-500', text: 'text-slate-300' }
  ]
  return (
    <div>
      <div className="flex h-8 rounded-lg overflow-hidden border border-navy-700">
        {segments.map(seg => {
          const width = Math.max(0, seg.value) / theoreticalMaxPieces * 100
          if (width <= 0) return null
          return <div key={seg.key} className={seg.color} style={{ width: `${width}%` }} title={`${seg.label}: ${seg.value.toLocaleString('pl-PL')} szt`} />
        })}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
        {segments.map(seg => (
          <div key={seg.key} className="flex items-start gap-1.5">
            <span className={cn('w-2.5 h-2.5 rounded-sm mt-0.5 shrink-0', seg.color)} />
            <div>
              <div className={cn('text-sm font-bold font-mono', seg.text)}>{seg.value.toLocaleString('pl-PL')} szt</div>
              <div className="text-[10px] text-navy-500 leading-tight">{seg.label}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-navy-500 mt-2">
        Teoretyczne maksimum przy pełnej dostępności, normie maszyny i zerowym odrzucie: {theoreticalMaxPieces.toLocaleString('pl-PL')} szt.
      </div>
    </div>
  )
}

export default function OeeHero(props: OeeHeroProps) {
  const { loading, oee, oeeAvailability, oeePerformance, oeeQuality, planGood, planTarget, planAttainmentPct } = props
  const planPctClamped = Math.max(0, Math.min(100, planAttainmentPct))

  return (
    <div className="card">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 flex flex-col items-center justify-center py-2">
          <div className="relative">
            <OeeRing pct={oee} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className={cn('text-4xl sm:text-5xl font-bold', oee == null ? 'text-navy-500' : efficiencyColor(oee))}>
                {loading ? '...' : oee == null ? '—' : `${oee}%`}
              </div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-navy-400 mt-1">OEE</div>
            </div>
          </div>
          <div className="text-xs text-navy-500 mt-3 text-center">
            {oee == null ? 'brak rozliczenia czasu zmian' : `cel world-class: ${WORLD_CLASS_OEE}%`}
          </div>
        </div>

        <div className="lg:col-span-3 flex flex-col justify-center gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricBar label="Dostępność" sub="praca / czas planowany" value={oeeAvailability} />
            <MetricBar label="Wydajność" sub="tempo vs norma maszyny" value={oeePerformance} />
            <MetricBar label="Jakość" sub="dobre / wszystkie" value={oeeQuality} />
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-navy-400">Realizacja planu</span>
              <span className={cn('text-lg font-bold font-mono', efficiencyColor(planAttainmentPct))}>
                {planTarget ? `${planAttainmentPct}%` : '—'}
              </span>
            </div>
            <div className="h-2 rounded-full bg-navy-900 mt-1.5 overflow-hidden">
              <div className={cn('h-full rounded-full transition-all', efficiencyBg(planAttainmentPct))} style={{ width: `${planPctClamped}%` }} />
            </div>
            <div className="text-[11px] text-navy-500 mt-1">
              {planTarget ? `${planGood.toLocaleString('pl-PL')} / ${planTarget.toLocaleString('pl-PL')} szt` : 'brak celu w wybranym zakresie'}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 pt-5 border-t border-navy-700">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-3">Gdzie ginie OEE — straty przełożone na sztuki</div>
        <LossWaterfall
          theoreticalMaxPieces={props.theoreticalMaxPieces}
          lossAvailabilityPieces={props.lossAvailabilityPieces}
          lossPerformancePieces={props.lossPerformancePieces}
          lossQualityPieces={props.lossQualityPieces}
          goodPieces={props.goodPieces}
        />
      </div>
    </div>
  )
}
