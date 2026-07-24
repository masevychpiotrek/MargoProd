// Wspolna biblioteka metryk produkcyjnych - JEDNO zrodlo definicji dla panelu
// kierownika, raportu dnia i eksportu. Wczesniej kazdy ekran liczyl "efektywnosc"
// inaczej (good/18000 vs good/3200 vs zapisana efficiency_pct), przez co liczby
// sie nie zgadzaly. Tu jest jedna definicja OEE (standard przemyslowy) + osobno
// realizacja planu.

// Bazowa norma godzinowa maszyny, gdy w bazie brak target_per_hour.
export const IDEAL_RATE_FALLBACK = 3200
// Poziom "world-class" OEE - benchmark do porownania na dashboardzie.
export const WORLD_CLASS_OEE = 85
// Planowany cel na zmiane (do "realizacji planu", niezalezny od tempa maszyny).
export const TARGET_PER_SHIFT = 18000

export interface OeeInput {
  good: number
  reject: number
  runtimeMin: number
  readyMin: number
  alarmMin: number
  downtimeMin: number
  idealRatePerHour: number
}

export interface OeeResult {
  // null = brak rozliczenia czasu zmiany (nie udajemy 0%, bo to falszywy sygnal)
  availabilityPct: number | null
  performancePct: number | null
  qualityPct: number
  oeePct: number | null
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10))
}

// OEE = Dostepnosc x Wydajnosc x Jakosc.
export function computeOee(input: OeeInput): OeeResult {
  const { good, reject, runtimeMin, readyMin, alarmMin, downtimeMin } = input
  const idealRate = input.idealRatePerHour > 0 ? input.idealRatePerHour : IDEAL_RATE_FALLBACK
  const totalPieces = good + reject
  const plannedTime = runtimeMin + readyMin + alarmMin + downtimeMin
  const hasTime = plannedTime > 0

  // Jakosc liczymy zawsze - zalezy tylko od sztuk, nie od czasu.
  const qualityPct = totalPieces > 0 ? clampPct(good / totalPieces * 100) : 100

  if (!hasTime || runtimeMin <= 0) {
    return { availabilityPct: hasTime ? 0 : null, performancePct: null, qualityPct, oeePct: null }
  }

  const availabilityPct = clampPct(runtimeMin / plannedTime * 100)
  // Wydajnosc: ile maszyna wyprodukowala vs ile mogla przy idealnym tempie w czasie pracy.
  const idealOutput = runtimeMin / 60 * idealRate
  const performancePct = idealOutput > 0 ? clampPct(totalPieces / idealOutput * 100) : null
  const oeePct = performancePct != null
    ? clampPct(availabilityPct / 100 * (performancePct / 100) * (qualityPct / 100) * 100)
    : null

  return { availabilityPct, performancePct, qualityPct, oeePct }
}

// Realizacja planu - produkcja dobra vs cel planowy (zmiana/miesiac). Osobna
// metryka biznesowa, nie mylic z OEE (wydajnoscia maszyny).
export function planAttainmentPct(good: number, plan: number): number {
  return plan > 0 ? Math.round(good / plan * 1000) / 10 : 0
}

// Procent odrzutu = odrzut / (dobre + odrzut).
export function rejectPct(good: number, reject: number): number {
  const total = good + reject
  return total > 0 ? Math.round(reject / total * 1000) / 10 : 0
}

// Rzeczywiste tempo (szt/h) w czasie pracy - null gdy brak czasu pracy.
export function actualRatePerHour(pieces: number, runtimeMin: number): number | null {
  return runtimeMin > 0 ? Math.round(pieces / runtimeMin * 60) : null
}
