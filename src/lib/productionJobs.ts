// Stałe i logika dla funkcji "Zlecenie produkcyjne" (identyfikowalność półfabrykatów, moduł operator IS PRO)
import type { ProductionJob, ProductionJobComponent, ProductionJobComponentHistory } from '@/types/database'

export interface AssortmentOption {
  name: string
  length_cm: 150 | 180
  multiplier: 700 | 650
}

export const ASSORTMENTS: AssortmentOption[] = [
  { name: 'IS PRO 150 cm',            length_cm: 150, multiplier: 700 },
  { name: 'IS PRO 180 cm',            length_cm: 180, multiplier: 650 },
  { name: 'IS PRO AIR PASS 150 cm',   length_cm: 150, multiplier: 700 },
  { name: 'IS PRO AIR PASS 180 cm',   length_cm: 180, multiplier: 650 },
  { name: 'IS PRO SAFETY 150 cm',     length_cm: 150, multiplier: 700 },
  { name: 'IS PRO SAFETY 180 cm',     length_cm: 180, multiplier: 650 }
]

export interface ComponentDefinition {
  key: string
  label: string
  sort_order: number
}

// Musi być zgodne 1:1 z kluczami wstawianymi przez trigger production_job_seed_components
// w supabase/migrations/045_production_jobs.sql
export const STANDARD_COMPONENTS: ComponentDefinition[] = [
  { key: 'oslonka_igly_biorczej',      label: 'Osłonka igły biorczej',      sort_order: 1 },
  { key: 'zatyczka_odpowietrznika',    label: 'Zatyczka odpowietrznika',    sort_order: 2 },
  { key: 'igla_biorcza',               label: 'Igła biorcza',               sort_order: 3 },
  { key: 'komora_kroplowa',            label: 'Komora kroplowa',            sort_order: 4 },
  { key: 'oslonka_lacznika_luer_lock', label: 'Osłonka łącznika luer lock', sort_order: 5 },
  { key: 'lacznik_luer_lock',          label: 'Łącznik luer lock',          sort_order: 6 },
  { key: 'regulator_przeplywu',        label: 'Regulator przepływu',        sort_order: 7 },
  { key: 'rolka_regulatora_przeplywu', label: 'Rolka regulatora przepływu', sort_order: 8 },
  { key: 'tasma_zabezpieczajaca',      label: 'Taśma zabezpieczająca',      sort_order: 9 },
  { key: 'filtr_powietrza',            label: 'Filtr powietrza',            sort_order: 10 },
  { key: 'filtr_plynu',                label: 'Filtr płynu',                sort_order: 11 },
  { key: 'rozpuszczalnik',             label: 'Rozpuszczalnik',             sort_order: 12 }
]

export const DREN_COMPONENTS: ComponentDefinition[] = [
  { key: 'dren_st1_lewa',  label: 'Stacja 1 — lewa',  sort_order: 13 },
  { key: 'dren_st1_prawa', label: 'Stacja 1 — prawa', sort_order: 14 },
  { key: 'dren_st2_lewa',  label: 'Stacja 2 — lewa',  sort_order: 15 },
  { key: 'dren_st2_prawa', label: 'Stacja 2 — prawa', sort_order: 16 },
  { key: 'dren_st3_lewa',  label: 'Stacja 3 — lewa',  sort_order: 17 },
  { key: 'dren_st3_prawa', label: 'Stacja 3 — prawa', sort_order: 18 },
  { key: 'dren_st4_lewa',  label: 'Stacja 4 — lewa',  sort_order: 19 },
  { key: 'dren_st4_prawa', label: 'Stacja 4 — prawa', sort_order: 20 }
]

export function calculateQty(labelCount: number, multiplier: number): number {
  return labelCount * multiplier
}

// ─── Walidacja numeru serii/partii ──────────────────────────────────────────

const BANNED_BATCH_VALUES = ['xxx', 'test', 'brak', 'nie wiem', '123', '-', 'n/a', 'brak danych', 'asdf']

function normalize(value: string) {
  return value.trim().toLowerCase()
}

function isRepeatedChar(value: string) {
  return /^(.)\1*$/.test(value)
}

export function isPlausibleBatchNumber(value: string | null | undefined): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (trimmed.length < 3) return false
  const normalized = normalize(trimmed)
  if (BANNED_BATCH_VALUES.includes(normalized)) return false
  if (isRepeatedChar(trimmed)) return false
  return true
}

// ─── Format kopiowania (jedno źródło prawdy — podgląd operatora + kopiowanie kierownika) ──

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export interface JobCopyContext {
  job: ProductionJob
  machineName: string
  operatorName: string
  components: ProductionJobComponent[]
  history: (ProductionJobComponentHistory & { component_label?: string; changed_by_name?: string })[]
}

export function formatJobCopyText({ job, machineName, operatorName, components, history }: JobCopyContext): string {
  const standard = components.filter(c => !c.is_dren).sort((a, b) => a.sort_order - b.sort_order)
  const dren = components.filter(c => c.is_dren).sort((a, b) => a.sort_order - b.sort_order)

  const lines: string[] = [
    `Zlecenie produkcyjne: ${job.order_number}`,
    `Seria produkcyjna: ${job.series_number ?? '—'}`,
    `Automat: ${machineName}`,
    `Zmiana: ${job.shift_type ?? '—'}`,
    `Operator: ${operatorName}`,
    `Asortyment: ${job.assortment_name}`,
    `Liczba etykiet: ${job.label_count}`,
    `Przelicznik: ${job.multiplier}`,
    `Ilość sztuk: ${job.calculated_qty.toLocaleString('pl-PL')}`,
    `Start: ${formatDateTime(job.started_at)}`,
    '',
    'Półfabrykaty:'
  ]
  standard.forEach(c => lines.push(`- ${c.component_label}: ${c.batch_number ?? '—'}`))
  lines.push('', 'Dren:')
  dren.forEach(c => lines.push(`- ${c.component_label}: ${c.batch_number ?? '—'}`))
  lines.push('', 'Wymiany:')
  if (history.length === 0) {
    lines.push('- brak wymian')
  } else {
    history.forEach(h => {
      lines.push(`- ${formatDateTime(h.changed_at)} ${h.component_label ?? ''} zmieniono z ${h.previous_batch_number ?? '—'} na ${h.new_batch_number}, operator: ${h.changed_by_name ?? '—'}`)
    })
  }

  return lines.join('\n')
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
