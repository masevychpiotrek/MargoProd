// Stałe dla ustandaryzowanego zgłaszania przyczyn niskiej wydajności / nadmiernego odrzutu
// (rozbudowa "Komentarz do wyniku" / "Komentarz do odrzutu" w src/pages/operator/Report.tsx)

export type ReportIssueType = 'downtime' | 'reject'

export interface IssueOption {
  value: string
  label: string
}

// ─── Stacje / obszary problemu ──────────────────────────────────────────────

const STATION_NUMBERS = [
  ...Array.from({ length: 57 }, (_, i) => i + 1),
  76, 77
]

export const STATIONS: IssueOption[] = STATION_NUMBERS.map(n => ({
  value: `st_${n}`,
  label: `Stacja ${n}`
}))

export const GENERAL_CATEGORIES: IssueOption[] = [
  { value: 'gc_brak_obsady', label: 'Brak obsady' },
  { value: 'gc_brak_materialu', label: 'Brak materiału' },
  { value: 'gc_przezbrojenie', label: 'Przezbrojenie' },
  { value: 'gc_oczekiwanie_ur', label: 'Oczekiwanie na UR' },
  { value: 'gc_oczekiwanie_decyzje', label: 'Oczekiwanie na decyzję' },
  { value: 'gc_oczekiwanie_jakosc', label: 'Oczekiwanie na jakość' },
  { value: 'gc_oczekiwanie_technolog', label: 'Oczekiwanie na technologa' },
  { value: 'gc_testy_proby', label: 'Testy / próby' },
  { value: 'gc_czyszczenie', label: 'Czyszczenie automatu' },
  { value: 'gc_planowany_postoj', label: 'Planowany postój' },
  { value: 'gc_inny', label: 'Inny powód / do doprecyzowania' }
]

export const STATION_OPTIONS: IssueOption[] = [...STATIONS, ...GENERAL_CATEGORIES]

export function stationLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return STATION_OPTIONS.find(o => o.value === value)?.label ?? value
}

export interface StationAllocation {
  station: string
  pct: number
}

// Stacja "glowna" zgloszenia - ta o najwyzszym udziale % (remis: pierwsza dodana).
// Uzywana do wypelnienia istniejacych kolumn downtime_station / reject_station
// (proste filtrowanie/eksporty bez rozbijania na wiele stacji).
export function primaryStation(allocations: StationAllocation[] | null | undefined): string | null {
  if (!allocations || allocations.length === 0) return null
  return allocations.reduce((best, cur) => (cur.pct > best.pct ? cur : best), allocations[0]).station
}

export function stationsSummaryLabel(allocations: StationAllocation[] | null | undefined): string {
  if (!allocations || allocations.length === 0) return '—'
  if (allocations.length === 1) return stationLabel(allocations[0].station)
  return allocations.map(a => `${stationLabel(a.station)} (${a.pct}%)`).join(' + ')
}

// ─── Kategorie problemu (klasyfikacja AI) ───────────────────────────────────

export const DOWNTIME_PROBLEM_CATEGORIES: IssueOption[] = [
  { value: 'awaria_mechaniczna', label: 'Awaria mechaniczna' },
  { value: 'awaria_elektryczna_czujnik', label: 'Awaria elektryczna / czujnik' },
  { value: 'problem_pneumatyczny', label: 'Problem pneumatyczny' },
  { value: 'problem_z_robotem', label: 'Problem z robotem' },
  { value: 'problem_z_kamera', label: 'Problem z kamerą / kontrolą wizyjną' },
  { value: 'problem_z_podaniem_komponentu', label: 'Problem z podaniem komponentu' },
  { value: 'problem_z_transportem', label: 'Problem z transportem / pasem' },
  { value: 'problem_ze_zgrzewaniem', label: 'Problem ze zgrzewaniem' },
  { value: 'problem_z_cieciem', label: 'Problem z cięciem' },
  { value: 'problem_z_nawijaniem_drenu', label: 'Problem z nawijaniem drenu' },
  { value: 'problem_z_ustawieniami_procesu', label: 'Problem z ustawieniami procesu' },
  { value: 'regulacja', label: 'Regulacja' },
  { value: 'przezbrojenie', label: 'Przezbrojenie' },
  { value: 'brak_materialu', label: 'Brak materiału' },
  { value: 'brak_obsady', label: 'Brak obsady' },
  { value: 'oczekiwanie_na_ur', label: 'Oczekiwanie na UR' },
  { value: 'oczekiwanie_na_decyzje_jakosc_technolog', label: 'Oczekiwanie na decyzję / jakość / technologa' },
  { value: 'inna_przyczyna', label: 'Inna przyczyna' }
]

export const REJECT_PROBLEM_CATEGORIES: IssueOption[] = [
  { value: 'odrzut_jakosciowy', label: 'Odrzut jakościowy' },
  { value: 'falszywy_odrzut', label: 'Fałszywy odrzut' },
  { value: 'problem_z_kamera', label: 'Problem z kamerą' },
  { value: 'problem_z_czujnikiem', label: 'Problem z czujnikiem' },
  { value: 'nieprawidlowe_podanie_komponentu', label: 'Nieprawidłowe podanie komponentu' },
  { value: 'brak_komponentu', label: 'Brak komponentu' },
  { value: 'nieprawidlowy_montaz_komponentu', label: 'Nieprawidłowy montaż komponentu' },
  { value: 'problem_ze_zgrzewem', label: 'Problem ze zgrzewem' },
  { value: 'problem_z_dlugoscia_drenu', label: 'Problem z długością drenu' },
  { value: 'problem_z_pozycjonowaniem_komponentu', label: 'Problem z pozycjonowaniem komponentu' },
  { value: 'problem_z_filtrem_odpowietrznika', label: 'Problem z filtrem odpowietrznika' },
  { value: 'problem_z_oslonka_igly', label: 'Problem z osłonką igły' },
  { value: 'problem_z_komora', label: 'Problem z komorą' },
  { value: 'problem_z_luer_lockiem', label: 'Problem z luer-lockiem' },
  { value: 'problem_z_rolka', label: 'Problem z rolką' },
  { value: 'uszkodzenie_mechaniczne_wyrobu', label: 'Uszkodzenie mechaniczne wyrobu' },
  { value: 'zabrudzenie_cialo_obce', label: 'Zabrudzenie / ciało obce' },
  { value: 'problem_materialowy', label: 'Problem materiałowy' },
  { value: 'problem_po_regulacji', label: 'Problem po regulacji' },
  { value: 'problem_po_przezbrojeniu', label: 'Problem po przezbrojeniu' },
  { value: 'inna_przyczyna', label: 'Inna przyczyna' }
]

export function problemCategoriesFor(type: ReportIssueType): IssueOption[] {
  return type === 'downtime' ? DOWNTIME_PROBLEM_CATEGORIES : REJECT_PROBLEM_CATEGORIES
}

export function problemCategoryLabel(type: ReportIssueType, value: string | null | undefined): string {
  if (!value) return '—'
  return problemCategoriesFor(type).find(o => o.value === value)?.label ?? value
}

// ─── Status zgłoszenia ───────────────────────────────────────────────────────

export const ISSUE_STATUSES: IssueOption[] = [
  { value: 'rozwiazane_operator', label: 'Rozwiązane przez operatora' },
  { value: 'rozwiazane_lider', label: 'Rozwiązane przez lidera' },
  { value: 'rozwiazane_ur', label: 'Rozwiązane przez UR' },
  { value: 'wystepuje_nadal', label: 'Problem nadal występuje' },
  { value: 'wymaga_analizy', label: 'Wymaga dalszej analizy' },
  { value: 'wymaga_czesci', label: 'Wymaga części zamiennej' },
  { value: 'wymaga_serwisu_zewn', label: 'Wymaga kontaktu z serwisem zewnętrznym' },
  { value: 'wymaga_poprawy_danych', label: 'Zgłoszenie wymaga poprawy danych' }
]

export function issueStatusLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return ISSUE_STATUSES.find(o => o.value === value)?.label ?? value
}

// ─── Lokalna kontrola jakości opisu (fallback, gdy AI niedostępne) ──────────

export const BANNED_GENERIC_PHRASES = [
  'awaria', 'problem', 'nie dziala', 'nie działa', 'maszyna stoi', 'regulacja',
  'odrzut', 'duzy odrzut', 'duży odrzut', 'niska wydajnosc', 'niska wydajność',
  'cos nie dziala', 'coś nie działa', 'cos nie podaje', 'coś nie podaje',
  'blad', 'błąd', 'stop', 'przestoj', 'przestój'
]

export const GENERIC_DESCRIPTION_MESSAGE =
  'Opis jest zbyt ogólny. Wskaż konkretnie, co się wydarzyło, na jakiej stacji, jaki element nie zadziałał prawidłowo oraz jaki był skutek. ' +
  'Przykład: „Stacja 52 – nieprawidłowe podanie filtra odpowietrznika, automat zatrzymywał się okresowo, konieczna była regulacja podajnika.”'

function normalize(text: string) {
  return text.toLowerCase().trim().replace(/[.,!?;:]+$/g, '')
}

export interface HeuristicCheckResult {
  ok: boolean
  message: string | null
}

export function localHeuristicCheck(text: string): HeuristicCheckResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, message: GENERIC_DESCRIPTION_MESSAGE }

  const normalized = normalize(trimmed)
  if (BANNED_GENERIC_PHRASES.some(phrase => normalized === phrase)) {
    return { ok: false, message: GENERIC_DESCRIPTION_MESSAGE }
  }
  if (trimmed.length < 25) {
    return { ok: false, message: GENERIC_DESCRIPTION_MESSAGE }
  }

  const bannedWords = new Set(BANNED_GENERIC_PHRASES.flatMap(p => p.split(' ')))
  const words = normalized.split(/\s+/).filter(Boolean)
  const meaningfulWords = words.filter(w => !bannedWords.has(w))
  if (meaningfulWords.length < 4) {
    return { ok: false, message: GENERIC_DESCRIPTION_MESSAGE }
  }

  return { ok: true, message: null }
}
