import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/completedProductionDate.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { getLastCompletedProductionDate } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

test('Defaults to the completed production day at the Warsaw 06:00 boundary', () => {
  for (const [now, expected] of [
    ['2026-11-20T04:59:59Z', '2026-11-18'],
    ['2026-11-20T05:00:00Z', '2026-11-19'],
    ['2026-11-20T23:30:00Z', '2026-11-19'],
    ['2026-01-01T04:59:59Z', '2025-12-30'],
    ['2026-01-01T05:00:00Z', '2025-12-31'],
    ['2026-03-01T05:00:00Z', '2026-02-28'],
    ['2026-03-29T03:59:59Z', '2026-03-27'],
    ['2026-03-29T04:00:00Z', '2026-03-28'],
    ['2026-10-25T04:59:59Z', '2026-10-23'],
    ['2026-10-25T05:00:00Z', '2026-10-24']
  ]) assert.equal(getLastCompletedProductionDate(new Date(now)), expected, now)
})
