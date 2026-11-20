import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/isProProduction.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { isProReportStart, isProPlannedHours, overlapMilliseconds } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
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

test('Reloading a previously recorded partial registration hour preserves its target and runtime', () => {
  const partial = { id: 'partial', started_at: '2026-11-20T09:40:00Z' }
  const beforeReload = at(partial.started_at)
  const afterReload = isProReportStart(shiftStart, partial, [partial], [], at('2026-11-20T09:00:00Z'))
  assert.equal(afterReload, beforeReload)
  const end = at('2026-11-20T10:00:00Z')
  assert.equal(overlapMilliseconds(afterReload, end, end - 3600000, end) / 60000, 20)
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

const blocks = Array.from({ length: 8 }, (_, index) => ({
  hour: index + 6, start: shiftStart + index * 3600000, end: shiftStart + (index + 1) * 3600000
}))

test('Shift completion and the hourly form both require 06–13 for a late first registration', () => {
  const segments = [{ ...first, ended_at: null }]
  assert.deepEqual(isProPlannedHours(blocks, segments, [], []), [6, 7, 8, 9, 10, 11, 12, 13])
  const reports = [{ segment_id: first.id, hour_start: 6 }]
  assert.deepEqual(isProPlannedHours(blocks, segments, [], reports), [6, 7, 8, 9, 10, 11, 12, 13])
  const saved = new Set(reports.map(report => report.hour_start))
  assert.deepEqual(isProPlannedHours(blocks, segments, [], reports).filter(hour => !saved.has(hour)), [7, 8, 9, 10, 11, 12, 13])
})

test('A changeover gap is excluded; both assortments may share a partial clock hour', () => {
  const segments = [
    { ...first, ended_at: '2026-11-20T09:15:00Z' },
    { id: 'second', started_at: '2026-11-20T11:30:00Z', ended_at: null }
  ]
  const changes = [{ started_at: segments[0].ended_at, ended_at: segments[1].started_at }]
  const reports = [{ segment_id: first.id, hour_start: 6 }]
  assert.deepEqual(isProPlannedHours(blocks, segments, changes, reports), [6, 7, 8, 9, 10, 12, 13])
  segments[1].started_at = '2026-11-20T09:45:00Z'
  changes[0].ended_at = segments[1].started_at
  assert.deepEqual(isProPlannedHours(blocks, segments, changes, reports), [6, 7, 8, 9, 10, 11, 12, 13])
})

test('Shift completion preserves old late readings and ignores closing tails when deciding backfill eligibility', () => {
  const segments = [{ ...first, ended_at: null }]
  assert.deepEqual(isProPlannedHours(blocks, segments, [], [{ segment_id: first.id, hour_start: 10 }]), [10, 11, 12, 13])
  assert.deepEqual(isProPlannedHours(blocks, segments, [], [{ segment_id: first.id, hour_start: 10, is_segment_close: true }]), [6, 7, 8, 9, 10, 11, 12, 13])
})

test('Shift completion honours a carried-over changeover and a midnight crossing', () => {
  const segments = [{ ...first, ended_at: null }]
  const changes = [{ started_at: '2026-11-20T04:00:00Z', ended_at: first.started_at }]
  assert.deepEqual(isProPlannedHours(blocks, segments, changes, []), [10, 11, 12, 13])
  const nightStart = at('2026-11-20T21:00:00Z')
  const nightBlocks = Array.from({ length: 8 }, (_, index) => ({
    hour: (22 + index) % 24, start: nightStart + index * 3600000, end: nightStart + (index + 1) * 3600000
  }))
  assert.deepEqual(isProPlannedHours(nightBlocks, [{ id: 'night', started_at: '2026-11-21T00:00:00Z', ended_at: null }], [], []), [22, 23, 0, 1, 2, 3, 4, 5])
})
