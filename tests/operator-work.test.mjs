import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/operatorWork.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { buildOperatorWork, rankOperatorWork, operatorWorkCsv } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
const shift = { id: 's1', machine_id: 'm1', shift_date: '2026-10-04', shift_type: 'III', started_at: '2026-10-04T20:00:00Z', ended_at: '2026-10-05T04:00:00Z', operator_1_id: 'a', operator_2_id: 'b', operator_1: { full_name: 'Anna' }, operator_2: { full_name: 'Bartek' } }
const report = { id: 'r1', shift_id: 's1', machine_id: 'm1', operator_id: 'a', report_date: '2026-10-04', good_count: 100, reject_count: 5, runtime_min: 40, downtime_min: 20, operator: { full_name: 'Anna' } }
const session = { id: 'sa1', machine_id: 'm1', operator_id: 'a', session_date: '2026-10-05', shift_type: 'I', started_at: '2026-10-05T04:00:00Z', ended_at: null, total_good: 300, total_reject: 15, total_runtime_min: 120, total_downtime_min: 30, operator: { full_name: 'Anna' }, assortment: { name: '50/60 ml' } }

test('Both modules merge by operator identity without duplicating the shared IS PRO shift result', () => {
  const rows = buildOperatorWork([shift], [report, { ...report, id: 'r2', operator_id: 'b', good_count: 200, reject_count: 10, operator: { full_name: 'Bartek' } }, { ...report, id: 'deleted', good_count: 99999, deleted_at: '2026-10-05' }], [session], { m1: 'IS 1' }, { m1: 'ST 50' })
  assert.equal(rows.length, 3)
  assert.equal(rows.reduce((n, r) => n + r.good, 0), 600)
  assert.equal(new Set(rows.map(r => r.machineKey)).size, 2)
  const ranking = rankOperatorWork(rows)
  assert.equal(ranking.length, 2)
  assert.equal(ranking[0].operatorId, 'a')
  assert.equal(ranking[0].good, 400)
  assert.equal(ranking[0].shifts, 2)
  assert.equal(ranking[0].rejectPct, 20 / 420 * 100)
  assert.equal(rows.find(r => r.operatorId === 'b').date, '2026-10-04')
})

test('Roster without reports, missing measurements, zero production and automatic closures remain distinct', () => {
  const rows = buildOperatorWork([shift], [report], [{ ...session, auto_closed_at: '2026-10-05T13:00:00Z', total_good: 0, total_reject: 0, total_runtime_min: null }], {}, {})
  const missing = rows.find(r => r.operatorId === 'b')
  assert.equal(missing.good, null)
  assert.equal(missing.status, 'Brak wpisów')
  const sa = rows.find(r => r.source !== 'IS PRO')
  assert.equal(sa.good, 0)
  assert.equal(sa.status, 'Zamknięta automatycznie')
  assert.equal(rankOperatorWork(rows).find(r => r.operatorId === 'a').runtime, null)
  assert.equal(rankOperatorWork(rows).find(r => r.operatorId === 'b').missingResults, 1)
})

test('CSV exports all filtered rows, Warsaw overnight dates, diacritics and safe quoted cells', () => {
  const rows = buildOperatorWork([shift], [{ ...report, operator: { full_name: '=SUM(A1); "Łukasz"' } }], [], { m1: 'IS 1' }, {})
  const csv = operatorWorkCsv(rows)
  assert.ok(csv.startsWith('\uFEFF'))
  assert.match(csv, /'=SUM\(A1\); ""Łukasz""/)
  assert.match(csv, /4\.10\.2026, 22:00/)
  assert.match(csv, /5\.10\.2026, 06:00/)
  assert.equal(csv.split('\r\n').length, 3)
})
