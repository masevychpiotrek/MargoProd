// Silnik regul wykrywajacy wzorce problemow per maszyna - czyste funkcje,
// bez AI. AI (edge function diagnose-machines) tylko sklada te sygnaly w
// czytelne zdanie; same sygnaly sa juz uzyteczne bez AI (fallback offline).
import type { ReportIssueType } from './issueReports'

// Minimalny podzbior danych z Dashboard.tsx potrzebny do wykrycia sygnalow -
// zeby ten plik nie zalezal od typow zdefiniowanych lokalnie w Dashboard.tsx.
export interface DiagnosticReport {
  machine_id: string
  downtime_category?: string | null
  downtime_problem_name?: string | null
  reject_category?: string | null
  reject_problem_name?: string | null
}

export interface DiagnosticGroup {
  machineId: string
  reports: number
  hasTimeSummary: boolean
  rejectPct: number
  performancePct: number | null
  availabilityPct: number | null
}

export type SignalType = 'repeated_defect' | 'high_reject' | 'low_performance' | 'low_availability' | 'missing_summary'
export type Severity = 'high' | 'medium'

export interface Signal {
  type: SignalType
  severity: Severity
  // Krotki, gotowy do wyswietlenia opis sygnalu (bez AI) - fallback gdy AI niedostepne.
  label: string
  // Dodatkowe dane do promptu AI (nie wyswietlane wprost operatorowi/kierownikowi).
  detail: Record<string, string | number>
}

export interface MachineSignals {
  machineId: string
  machineName: string
  signals: Signal[]
}

// Progi - nazwane stale, latwe do przestrojenia bez grzebania w logice.
const REPEATED_DEFECT_MIN_COUNT = 3
const REPEATED_DEFECT_HIGH_COUNT = 5
const HIGH_REJECT_PCT = 5
const HIGH_REJECT_HIGH_PCT = 10
const LOW_PERFORMANCE_PCT = 70
const LOW_PERFORMANCE_HIGH_PCT = 50
const LOW_AVAILABILITY_PCT = 70
const LOW_AVAILABILITY_HIGH_PCT = 50
const MISSING_SUMMARY_MIN_COUNT = 2

function typeLabel(type: ReportIssueType) {
  return type === 'downtime' ? 'Wynik' : 'Odrzut'
}

export function detectMachineSignals(
  reports: DiagnosticReport[],
  groups: DiagnosticGroup[],
  machineNameById: Record<string, string>
): MachineSignals[] {
  const machineIds = new Set<string>([
    ...reports.map(r => r.machine_id),
    ...groups.map(g => g.machineId)
  ])

  const result: MachineSignals[] = []

  machineIds.forEach(machineId => {
    const signals: Signal[] = []
    const machineReports = reports.filter(r => r.machine_id === machineId)
    const machineGroups = groups.filter(g => g.machineId === machineId)

    // 1) Powtarzajacy sie problem: ta sama para (typ, kategoria) >= 3 razy.
    const categoryCounts: Record<string, { type: ReportIssueType; category: string; count: number; problemNames: Set<string> }> = {}
    machineReports.forEach(r => {
      if (r.downtime_category) {
        const key = `downtime|${r.downtime_category}`
        if (!categoryCounts[key]) categoryCounts[key] = { type: 'downtime', category: r.downtime_category, count: 0, problemNames: new Set() }
        categoryCounts[key].count += 1
        if (r.downtime_problem_name) categoryCounts[key].problemNames.add(r.downtime_problem_name)
      }
      if (r.reject_category) {
        const key = `reject|${r.reject_category}`
        if (!categoryCounts[key]) categoryCounts[key] = { type: 'reject', category: r.reject_category, count: 0, problemNames: new Set() }
        categoryCounts[key].count += 1
        if (r.reject_problem_name) categoryCounts[key].problemNames.add(r.reject_problem_name)
      }
    })
    Object.values(categoryCounts)
      .filter(c => c.count >= REPEATED_DEFECT_MIN_COUNT)
      .sort((a, b) => b.count - a.count)
      .forEach(c => {
        const examples = Array.from(c.problemNames).slice(0, 2).join(', ')
        signals.push({
          type: 'repeated_defect',
          severity: c.count >= REPEATED_DEFECT_HIGH_COUNT ? 'high' : 'medium',
          label: `${typeLabel(c.type)}: powtarzający się problem — ${c.category} (${c.count}x)${examples ? ` (${examples})` : ''}`,
          detail: { reportType: c.type, category: c.category, count: c.count, examples }
        })
      })

    // 2) Wysoki odrzut - srednia z grup tej maszyny.
    if (machineGroups.length > 0) {
      const avgReject = Math.round(machineGroups.reduce((s, g) => s + g.rejectPct, 0) / machineGroups.length * 10) / 10
      if (avgReject > HIGH_REJECT_PCT) {
        signals.push({
          type: 'high_reject',
          severity: avgReject > HIGH_REJECT_HIGH_PCT ? 'high' : 'medium',
          label: `Wysoki odrzut: średnio ${avgReject}% w wybranym zakresie`,
          detail: { avgRejectPct: avgReject }
        })
      }

      // 3) Niska wydajnosc - tylko grupy z realnym rozliczeniem czasu.
      const timedForPerf = machineGroups.filter(g => g.hasTimeSummary && g.performancePct != null)
      if (timedForPerf.length > 0) {
        const avgPerf = Math.round(timedForPerf.reduce((s, g) => s + (g.performancePct ?? 0), 0) / timedForPerf.length * 10) / 10
        if (avgPerf < LOW_PERFORMANCE_PCT) {
          signals.push({
            type: 'low_performance',
            severity: avgPerf < LOW_PERFORMANCE_HIGH_PCT ? 'high' : 'medium',
            label: `Niska wydajność: średnio ${avgPerf}% normy maszyny`,
            detail: { avgPerformancePct: avgPerf }
          })
        }
      }

      // 4) Niska dostepnosc - alarmy/postoje zjadaja duzo czasu.
      const timedForAvail = machineGroups.filter(g => g.hasTimeSummary && g.availabilityPct != null)
      if (timedForAvail.length > 0) {
        const avgAvail = Math.round(timedForAvail.reduce((s, g) => s + (g.availabilityPct ?? 0), 0) / timedForAvail.length * 10) / 10
        if (avgAvail < LOW_AVAILABILITY_PCT) {
          signals.push({
            type: 'low_availability',
            severity: avgAvail < LOW_AVAILABILITY_HIGH_PCT ? 'high' : 'medium',
            label: `Niska dostępność: średnio ${avgAvail}% czasu planowanego (alarmy/postoje)`,
            detail: { avgAvailabilityPct: avgAvail }
          })
        }
      }

      // 5) Brakujace rozliczenia zmian (dane sa, ale nikt nie zamknal zmiany z czasem).
      const missing = machineGroups.filter(g => g.reports > 0 && !g.hasTimeSummary).length
      if (missing >= MISSING_SUMMARY_MIN_COUNT) {
        signals.push({
          type: 'missing_summary',
          severity: missing >= MISSING_SUMMARY_MIN_COUNT * 2 ? 'high' : 'medium',
          label: `Brakuje rozliczenia czasu dla ${missing} zmian — OEE tej maszyny jest niedoszacowane`,
          detail: { missingCount: missing }
        })
      }
    }

    if (signals.length > 0) {
      result.push({ machineId, machineName: machineNameById[machineId] ?? 'Nieznana maszyna', signals })
    }
  })

  return result.sort((a, b) => {
    const aHigh = a.signals.filter(s => s.severity === 'high').length
    const bHigh = b.signals.filter(s => s.severity === 'high').length
    return bHigh - aHigh || b.signals.length - a.signals.length
  })
}
