import type { ShiftType } from '@/types/database'
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
  admin:    'Administrator',
  specialist: 'Specjalista',
  viewer: 'Gość',
  executive: 'Zarzad'
}

export const SHIFT_HOURS: Record<ShiftType, number[]> = {
  I:   [6, 7, 8, 9, 10, 11, 12, 13],
  II:  [14, 15, 16, 17, 18, 19, 20, 21],
  III: [22, 23, 0, 1, 2, 3, 4, 5]
}

export const PRODUCTION_DAY_START_HOUR = 6

export const PRODUCTION_DAY_HOURS = Array.from(
  { length: 24 },
  (_, index) => (PRODUCTION_DAY_START_HOUR + index) % 24
)

export function productionHourOrder(hour: number): number {
  return (hour - PRODUCTION_DAY_START_HOUR + 24) % 24
}

export function compareProductionHours(a: number, b: number): number {
  return productionHourOrder(a) - productionHourOrder(b)
}

export function isProductionHourAtOrBefore(hour: number, cutoff: number): boolean {
  return productionHourOrder(hour) <= productionHourOrder(cutoff)
}

const SHIFT_WINDOWS: Record<ShiftType, { startHour: number; endHour: number; endDayOffset: number }> = {
  I:   { startHour: 6,  endHour: 14, endDayOffset: 0 },
  II:  { startHour: 14, endHour: 22, endDayOffset: 0 },
  III: { startHour: 22, endHour: 6,  endDayOffset: 1 }
}

export function getShiftForHour(hour: number): 'I' | 'II' | 'III' {
  if (hour >= 6 && hour < 14)  return 'I'
  if (hour >= 14 && hour < 22) return 'II'
  return 'III'
}

export function formatLocalDateISO(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function getShiftDateForStart(shiftType: ShiftType, now = new Date()): string {
  const date = new Date(now)
  if (shiftType === 'III' && now.getHours() < 6) {
    date.setDate(date.getDate() - 1)
  }
  return formatLocalDateISO(date)
}

export function getProductionDate(now = new Date()): string {
  const date = new Date(now)
  if (date.getHours() < PRODUCTION_DAY_START_HOUR) {
    date.setDate(date.getDate() - 1)
  }
  return formatLocalDateISO(date)
}

function dateAtHour(dateISO: string, hour: number, dayOffset = 0): Date {
  const [year, month, day] = dateISO.split('-').map(Number)
  const date = new Date(year, month - 1, day, hour, 0, 0, 0)
  date.setDate(date.getDate() + dayOffset)
  return date
}

export function getShiftStartAt(shiftDate: string, shiftType: ShiftType): Date {
  const window = SHIFT_WINDOWS[shiftType]
  return dateAtHour(shiftDate, window.startHour)
}

export function getShiftEndAt(shiftDate: string, shiftType: ShiftType): Date {
  const window = SHIFT_WINDOWS[shiftType]
  return dateAtHour(shiftDate, window.endHour, window.endDayOffset)
}

export function getShiftAutoCloseAt(shiftDate: string, shiftType: ShiftType): Date {
  const endAt = getShiftEndAt(shiftDate, shiftType)
  endAt.setHours(endAt.getHours() + 1)
  return endAt
}

export function isShiftPastAutoClose(shiftDate: string, shiftType: ShiftType, now = new Date()): boolean {
  return now.getTime() >= getShiftAutoCloseAt(shiftDate, shiftType).getTime()
}

export function getReportBlockEndAt(shiftDate: string, shiftType: ShiftType, hourStart: number): Date {
  const dayOffset = shiftType === 'III' && hourStart < 6 ? 1 : 0
  const blockStart = dateAtHour(shiftDate, hourStart, dayOffset)
  blockStart.setHours(blockStart.getHours() + 1)
  return blockStart
}

export function getReportEntryOpenAt(shiftDate: string, shiftType: ShiftType, hourStart: number): Date {
  const openAt = getReportBlockEndAt(shiftDate, shiftType, hourStart)
  openAt.setMinutes(openAt.getMinutes() - 10)
  return openAt
}

export function canEnterHourlyReport(shiftDate: string, shiftType: ShiftType, hourStart: number, now = new Date()): boolean {
  return now.getTime() >= getReportEntryOpenAt(shiftDate, shiftType, hourStart).getTime()
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
