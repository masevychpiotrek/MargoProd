import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const DOWNTIME_LABELS: Record<string, string> = {
  mechanical_failure: 'Awaria mechaniczna',
  electrical_failure: 'Awaria elektryczna',
  material_shortage:  'Brak materiału',
  quality_control:    'Kontrola jakości',
  changeover:         'Przezbrojenie',
  no_operator:        'Brak operatora',
  cleaning:           'Czyszczenie',
  process_issue:      'Problem procesu',
  logistics_issue:    'Problem logistyczny',
  other:              'Inne'
}

export const SHIFT_LABELS: Record<string, string> = {
  I:   'Zmiana I (06:00–14:00)',
  II:  'Zmiana II (14:00–22:00)',
  III: 'Zmiana III (22:00–06:00)'
}

export const ROLE_LABELS: Record<string, string> = {
  operator: 'Operator',
  manager:  'Kierownik',
  admin:    'Administrator'
}

export function getShiftForHour(hour: number): 'I' | 'II' | 'III' {
  if (hour >= 6 && hour < 14)  return 'I'
  if (hour >= 14 && hour < 22) return 'II'
  return 'III'
}

export function formatHourBlock(hour: number): string {
  const h1 = String(hour).padStart(2, '0')
  const h2 = String((hour + 1) % 24).padStart(2, '0')
  return `${h1}:00–${h2}:00`
}

export function efficiencyColor(pct: number): string {
  if (pct >= 90) return 'text-green-400'
  if (pct >= 70) return 'text-amber-400'
  return 'text-red-400'
}

export function efficiencyBg(pct: number): string {
  if (pct >= 90) return 'bg-green-500'
  if (pct >= 70) return 'bg-amber-500'
  return 'bg-red-500'
}
