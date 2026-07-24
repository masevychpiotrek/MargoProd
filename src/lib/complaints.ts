// Stale modulu reklamacji wewnetrznych - operator zglasza wykryta wade
// jakosciowa polfabrykatu (numer serii, data produkcji, typ polfabrykatu,
// typ niezgodnosci, zdjecie wady).
import { ASSORTMENTS } from './productionJobs'

export interface Option {
  value: string
  label: string
}

// Typ polfabrykatu - te same warianty IS PRO co w module zlecen produkcyjnych.
export const SEMI_PRODUCTS: Option[] = ASSORTMENTS.map(a => ({ value: a.name, label: a.name }))

// Typ niezgodnosci - standardowy zestaw wad (kierownik moze dopisac wlasne
// przez pole "Inna"). Kolejnosc od najczestszych wad formowania.
export const DEFECT_TYPES: Option[] = [
  { value: 'wyplywka', label: 'Wypływka' },
  { value: 'zadzior', label: 'Zadzior' },
  { value: 'niedolew', label: 'Niedolew / braki materiału' },
  { value: 'deformacja', label: 'Deformacja' },
  { value: 'peknniecie', label: 'Pęknięcie' },
  { value: 'przebarwienie', label: 'Przebarwienie / plama' },
  { value: 'zarysowanie', label: 'Zarysowanie' },
  { value: 'zabrudzenie', label: 'Zabrudzenie / ciało obce' },
  { value: 'wymiar', label: 'Wymiar poza tolerancją' },
  { value: 'niekompletny', label: 'Niekompletny wyrób' },
  { value: 'inna', label: 'Inna niezgodność (opisz w uwagach)' }
]

export type ComplaintStatus = 'new' | 'in_review' | 'resolved' | 'rejected'

export const COMPLAINT_STATUSES: { value: ComplaintStatus; label: string; tone: 'blue' | 'amber' | 'green' | 'red' }[] = [
  { value: 'new', label: 'Nowa', tone: 'blue' },
  { value: 'in_review', label: 'W analizie', tone: 'amber' },
  { value: 'resolved', label: 'Rozwiązana', tone: 'green' },
  { value: 'rejected', label: 'Odrzucona', tone: 'red' }
]

export function defectTypeLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return DEFECT_TYPES.find(d => d.value === value)?.label ?? value
}

export function semiProductLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return SEMI_PRODUCTS.find(s => s.value === value)?.label ?? value
}

export function complaintStatusLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return COMPLAINT_STATUSES.find(s => s.value === value)?.label ?? value
}

export function complaintStatusTone(value: string | null | undefined): 'blue' | 'amber' | 'green' | 'red' {
  return COMPLAINT_STATUSES.find(s => s.value === value)?.tone ?? 'blue'
}

// Numer serii/partii - zwykle kilka znakow alfanumerycznych. Blokuje ewidentne
// smieci (jeden znak, sama spacja), ale nie narzuca sztywnego formatu.
export function isPlausibleBatchNumber(value: string): boolean {
  const v = value.trim()
  return v.length >= 2 && /[a-zA-Z0-9]/.test(v)
}
