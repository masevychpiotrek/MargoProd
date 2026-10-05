export type WorkSource = 'IS PRO' | 'Automaty strzykawkowe'
type Person = { full_name: string } | null
export type WorkShift = { id: string; machine_id: string; shift_date: string; shift_type: string; started_at: string; ended_at: string | null; operator_1_id: string; operator_2_id: string | null; operator_1?: Person; operator_2?: Person }
export type WorkReport = { id: string; shift_id: string; machine_id: string; operator_id: string; report_date: string; good_count: number; reject_count: number; runtime_min: number | null; downtime_min: number | null; deleted_at?: string | null; operator?: Person }
export type WorkSession = { id: string; machine_id: string; operator_id: string; session_date: string; shift_type: string; started_at: string; ended_at: string | null; total_good: number | null; total_reject: number | null; total_runtime_min: number | null; total_downtime_min: number | null; auto_closed_at?: string | null; operator?: Person; assortment?: { name: string } | null }
export type WorkRow = {
  id: string; source: WorkSource; operatorId: string; operatorName: string; machineKey: string; machineName: string
  date: string; shift: string; startedAt: string | null; endedAt: string | null; good: number | null; reject: number | null
  runtime: number | null; downtime: number | null; reports: number | null; product: string; status: string
}
const sum = (values: Array<number | null | undefined>) => values.length && values.every(v => v != null) ? values.reduce<number>((n, v) => n + Number(v), 0) : null

export function buildOperatorWork(shifts: WorkShift[], reports: WorkReport[], sessions: WorkSession[], machines: Record<string, string>, syringeMachines: Record<string, string>): WorkRow[] {
  const shiftById = new Map(shifts.map(s => [s.id, s]))
  const groups = new Map<string, WorkReport[]>()
  for (const r of reports) {
    if (r.deleted_at) continue
    const key = `${r.shift_id}:${r.operator_id}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  // Roster rows remain visible even when an operator has submitted no reports.
  for (const s of shifts) for (const operatorId of new Set([s.operator_1_id, s.operator_2_id].filter((id): id is string => !!id))) {
    const key = `${s.id}:${operatorId}`
    if (!groups.has(key)) groups.set(key, [])
  }
  const rows: WorkRow[] = []
  for (const [key, entries] of groups) {
    const separator = key.indexOf(':')
    const shiftId = key.slice(0, separator), operatorId = key.slice(separator + 1)
    const s = shiftById.get(shiftId), first = entries[0]
    const machineId = s?.machine_id ?? first.machine_id
    rows.push({ id: `is:${key}`, source: 'IS PRO', operatorId,
      operatorName: first?.operator?.full_name ?? (operatorId === s?.operator_1_id ? s.operator_1?.full_name : s?.operator_2?.full_name) ?? 'Nieznany operator',
      machineKey: `is:${machineId}`, machineName: machines[machineId] ?? 'Nieznana maszyna',
      date: s?.shift_date ?? first.report_date, shift: s?.shift_type ?? '—', startedAt: s?.started_at ?? null, endedAt: s?.ended_at ?? null,
      good: sum(entries.map(r => r.good_count)), reject: sum(entries.map(r => r.reject_count)), runtime: sum(entries.map(r => r.runtime_min)), downtime: sum(entries.map(r => r.downtime_min)),
      reports: entries.length, product: 'IS PRO', status: !entries.length ? 'Brak wpisów' : !s ? 'Brak danych zmiany' : s.ended_at ? 'Zakończona' : 'W trakcie' })
  }
  for (const s of sessions) rows.push({ id: `sa:${s.id}`, source: 'Automaty strzykawkowe', operatorId: s.operator_id, operatorName: s.operator?.full_name ?? 'Nieznany operator',
    machineKey: `sa:${s.machine_id}`, machineName: syringeMachines[s.machine_id] ?? 'Nieznana maszyna', date: s.session_date, shift: s.shift_type,
    startedAt: s.started_at, endedAt: s.ended_at, good: s.total_good, reject: s.total_reject, runtime: s.total_runtime_min, downtime: s.total_downtime_min,
    reports: null, product: s.assortment?.name ?? '—', status: s.auto_closed_at ? 'Zamknięta automatycznie' : s.ended_at ? 'Zakończona' : 'W trakcie' })
  return rows.sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt ?? '').localeCompare(a.startedAt ?? '') || a.operatorName.localeCompare(b.operatorName, 'pl'))
}

export function rankOperatorWork(rows: WorkRow[]) {
  const groups = new Map<string, WorkRow[]>()
  for (const row of rows) groups.set(row.operatorId, [...(groups.get(row.operatorId) ?? []), row])
  return [...groups].map(([operatorId, work]) => {
    const good = work.reduce((n, r) => n + (r.good ?? 0), 0), reject = work.reduce((n, r) => n + (r.reject ?? 0), 0)
    return { operatorId, operatorName: work[0].operatorName, good, reject, rejectPct: good + reject > 0 ? reject / (good + reject) * 100 : null,
      shifts: work.length, machines: [...new Set(work.map(r => `${r.source}: ${r.machineName}`))], sources: [...new Set(work.map(r => r.source))],
      missingResults: work.filter(r => r.good == null || r.reject == null).length,
      runtime: sum(work.map(r => r.runtime)), downtime: sum(work.map(r => r.downtime)) }
  }).sort((a, b) => b.good - a.good || a.operatorName.localeCompare(b.operatorName, 'pl'))
}

export function operatorWorkCsv(rows: WorkRow[]) {
  const escape = (value: unknown) => '"' + String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""') + '"'
  const time = (value: string | null) => value ? new Date(value).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }) : ''
  return '\uFEFF' + [['Operator', 'Moduł', 'Maszyna', 'Data produkcyjna', 'Zmiana', 'Początek zmiany', 'Koniec zmiany', 'Dobre sztuki', 'Braki', 'Praca min', 'Przestój min', 'Asortyment', 'Status'],
    ...rows.map(r => [r.operatorName, r.source, r.machineName, r.date, r.shift, time(r.startedAt), time(r.endedAt), r.good, r.reject, r.runtime, r.downtime, r.product, r.status])]
    .map(row => row.map(escape).join(';')).join('\r\n')
}
