import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { createSyringeDb } from './syringe-db.mjs'

test('50 ml line can select and start both real seeded 50/60 ml variants', async () => {
  const { db, ids, command } = await createSyringeDb({ full: true })
  try {
    await db.exec(await readFile(new URL('../supabase/migrations/072_syringe_early_close_schema_repair.sql', import.meta.url), 'utf8'))
    const source = await readFile(new URL('../src/lib/syringeCompatibility.ts', import.meta.url), 'utf8')
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
    const { isSyringeCompatible } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
    const machine = (await db.query("SELECT * FROM sa_machines WHERE code='SA-50ML'")).rows[0]
    const assortments = (await db.query("SELECT * FROM sa_assortments WHERE code IN ('SYR_50ML','SYR_50ML_STANDARD') ORDER BY code")).rows
    assert.equal(assortments.length, 2)
    assert.equal(Number(machine.volume_ml), 50)
    for (const a of assortments) {
      assert.equal(Number(a.volume_ml), 60)
      assert.equal(isSyringeCompatible(machine, a), true)
      // Reproduce the original database rejection before applying the repair.
      await assert.rejects(command('start', { machine_id: machine.id, assortment_id: a.id, shift_type: 'I' }), /niezgodny/)
    }
    await db.exec(await readFile(new URL('../supabase/migrations/076_syringe_50_60_compatibility.sql', import.meta.url), 'utf8'))
    for (const a of assortments) {
      await db.exec('BEGIN')
      const { session_id } = await command('start', { machine_id: machine.id, assortment_id: a.id, shift_type: 'I' })
      assert.ok(session_id)
      const entry = await command('production', { session_id, last_entry_id: null, print: '100', assembly: '100', defects: [] })
      assert.ok(entry.record_id)
      assert.equal((await db.query('SELECT total_good FROM sa_sessions WHERE id=$1', [session_id])).rows[0].total_good, 100)
      await db.exec('ROLLBACK')
    }
    const a = assortments[0]
    for (const volume_ml of [2, 5, 10, 20, 60, 100]) assert.equal(isSyringeCompatible({ ...machine, volume_ml }, a), false)
    assert.equal(isSyringeCompatible(machine, { ...a, code: 'CUSTOM_60ML' }), false)
    assert.equal(isSyringeCompatible(machine, { ...a, is_active: false }), false)
    assert.equal(isSyringeCompatible(machine, { ...a, volume_ml: 100 }), false)
    await assert.rejects(command('start', { machine_id: machine.id, assortment_id: ids.incompatible, shift_type: 'I' }), /niezgodny/)
    await assert.rejects(command('start', { machine_id: ids.machine, assortment_id: a.id, shift_type: 'I' }), /niezgodny/)
    await db.query('UPDATE sa_assortments SET is_active=false WHERE id=$1', [a.id])
    await assert.rejects(command('start', { machine_id: machine.id, assortment_id: a.id, shift_type: 'I' }), /niezgodny|niedostępny/)
  } finally { await db.close() }
})
