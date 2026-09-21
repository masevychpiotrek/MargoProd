import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/syringeMetrics.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const { syringeProductionDate, syringeCurrentShift, syringeRange, syringeRate, wholeQuantity, rejectPercent, stoppedMinutes } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

test('Production date at 06:00, local shifts, midnight, year change and summer/winter time', () => {
  assert.equal(syringeProductionDate(new Date('2026-09-21T03:59:59Z')), '2026-09-20')
  assert.equal(syringeProductionDate(new Date('2026-09-21T04:00:00Z')), '2026-09-21')
  assert.equal(syringeProductionDate(new Date('2026-01-01T00:30:00Z')), '2025-12-31')
  assert.equal(syringeCurrentShift(new Date('2026-09-21T12:00:00Z')), 'II')
  assert.equal(syringeCurrentShift(new Date('2026-09-21T20:00:00Z')), 'III')
  assert.equal(syringeProductionDate(new Date('2026-10-25T04:59:59Z')), '2026-10-24')
  assert.equal(syringeProductionDate(new Date('2026-10-25T05:00:00Z')), '2026-10-25')
})
test('Calendar months and weeks have no UTC one-day shift', () => {
  assert.deepEqual(syringeRange('month', '2026-09-21'), { from: '2026-09-01', to: '2026-09-30' })
  assert.deepEqual(syringeRange('month', '2024-02-20'), { from: '2024-02-01', to: '2024-02-29' })
  assert.deepEqual(syringeRange('week', '2026-01-01'), { from: '2025-12-29', to: '2026-01-04' })
})
test('Rate and reject denominators, zero output, invalid quantities and overlapping stops', () => {
  assert.equal(rejectPercent(950, 50), 5)
  assert.equal(rejectPercent(0, 100), 100)
  assert.equal(rejectPercent(0, 0), 0)
  assert.equal(syringeRate(1800, 3600000), 1800)
  assert.equal(syringeRate(0, 3600000), 0)
  assert.equal(syringeRate(1800, 2000), null)
  for (const s of ['1.5', '-1', '3e4', '', 'NaN', '2147483648']) assert.equal(wholeQuantity(s), false)
  assert.equal(wholeQuantity('0'), true)
  assert.equal(stoppedMinutes([
    { started_at: '2026-09-21T06:00:00Z', ended_at: '2026-09-21T06:30:00Z' },
    { started_at: '2026-09-21T06:10:00Z', ended_at: '2026-09-21T06:45:00Z' },
    { started_at: '2026-09-21T06:50:00Z', ended_at: null }
  ], '2026-09-21T06:00:00Z', Date.parse('2026-09-21T07:00:00Z')), 55)
})
