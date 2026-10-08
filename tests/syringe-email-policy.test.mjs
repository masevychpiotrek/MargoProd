import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/syringeEmailPolicy.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { includeSyringeEmailShift, requiresSyringeIdleReason } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
const idle = { good: 0, reject: 0, notes: [] }

test('First shift requires an explanation only for idle lines without a saved explanation', () => {
  assert.equal(requiresSyringeIdleReason('I', idle), true)
  assert.equal(requiresSyringeIdleReason('I', { ...idle, notes: ['   '] }), true)
  assert.equal(requiresSyringeIdleReason('I', { ...idle, notes: ['Planned maintenance'] }), false)
  assert.equal(requiresSyringeIdleReason('I', { ...idle, good: 100 }), false)
  assert.equal(requiresSyringeIdleReason('I', { ...idle, reject: 100 }), false)
})

test('Second shift never blocks generation and is reported only when there was production', () => {
  for (const summary of [idle, { ...idle, good: 100 }, { ...idle, reject: 100 }]) {
    assert.equal(requiresSyringeIdleReason('II', summary), false)
  }
  assert.equal(includeSyringeEmailShift('I', idle), true)
  assert.equal(includeSyringeEmailShift('II', idle), false)
  assert.equal(includeSyringeEmailShift('II', { ...idle, notes: ['No order'] }), false)
  assert.equal(includeSyringeEmailShift('II', { ...idle, good: 100 }), true)
  assert.equal(includeSyringeEmailShift('II', { ...idle, reject: 100 }), true)
  assert.equal(includeSyringeEmailShift('III', { ...idle, good: 100 }), false)
})
