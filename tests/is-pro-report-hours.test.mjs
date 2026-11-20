import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/isProProduction.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { isProReportStart, overlapMilliseconds } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
const at = iso => new Date(iso).getTime()
const first = { id: 'first', started_at: '2026-11-20T09:00:00Z' } // 10:00 Warsaw
const shiftStart = at('2026-11-20T05:00:00Z') // 06:00 Warsaw

test('Late registration of the first assortment allows full earlier hourly results and targets', () => {
  const start = isProReportStart(shiftStart, first, [first], [])
  assert.equal(start, shiftStart)
  for (let hour = 6; hour <= 13; hour++) {
    const end = shiftStart + (hour - 5) * 3600000
    const minutes = overlapMilliseconds(start, end, end - 3600000, end) / 60000
    assert.equal(minutes, 60)
    assert.equal(Math.round(3200 * minutes / 60), 3200)
  }
  // Saving 06:00 keeps the window open from 06:00 for the next missing block.
  assert.equal(isProReportStart(shiftStart, first, [first], [], shiftStart), shiftStart)
})

test('Previously saved later counters keep their window instead of forcing an earlier insert', () => {
  assert.equal(isProReportStart(shiftStart, first, [first], [], at(first.started_at)), at(first.started_at))
})

test('A new assortment after changeover retains its actual start and partial-hour target', () => {
  const second = { id: 'second', started_at: '2026-11-20T11:30:00Z' }
  const start = isProReportStart(shiftStart, second, [first, second], [])
  assert.equal(start, at(second.started_at))
  const end = at('2026-11-20T12:00:00Z')
  assert.equal(overlapMilliseconds(start, end, end - 3600000, end) / 60000, 30)
})

test('A carried-over changeover prevents assigning production to the earlier changeover hours', () => {
  const changes = [{ started_at: '2026-11-20T04:00:00Z', ended_at: first.started_at }]
  assert.equal(isProReportStart(shiftStart, first, [first], changes), at(first.started_at))
})

test('The first night-shift assortment can report before midnight after a late start after midnight', () => {
  const night = { id: 'night', started_at: '2026-11-21T00:00:00Z' }
  const start = at('2026-11-20T21:00:00Z')
  assert.equal(isProReportStart(start, night, [night], []), start)
  const midnightEnd = at('2026-11-21T00:00:00Z')
  assert.equal(overlapMilliseconds(start, midnightEnd, midnightEnd - 3600000, midnightEnd) / 60000, 60)
})
