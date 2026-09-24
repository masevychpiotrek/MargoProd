import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createSyringeDb } from './syringe-db.mjs'

const repair = await readFile(new URL('../supabase/migrations/072_syringe_early_close_schema_repair.sql', import.meta.url), 'utf8')

test('Repair missing early-close column: finish stays atomic, records missing hours and is retry-safe', async () => {
  const { db, ids, command } = await createSyringeDb({ full: true })
  try {
    // Reproduce the deployed mismatch: current function and older table/trigger.
    await db.exec(`
      ALTER TABLE sa_sessions DROP COLUMN early_missing_blocks CASCADE;
      CREATE TRIGGER trg_sa_mark_early_finish BEFORE UPDATE OF ended_at ON sa_sessions
      FOR EACH ROW EXECUTE FUNCTION sa_mark_early_finish();
    `)
    const { session_id } = await command('start', { machine_id: ids.machine, assortment_id: ids.assortment, shift_type: 'I' })
    await db.query("UPDATE sa_sessions SET session_date='2020-01-01', started_at='2020-01-01 06:00 Europe/Warsaw' WHERE id=$1", [session_id])
    const finish = { session_id, final_print: '0', final_assembly: '0', comment: 'Zatrzymanie linii z powodu awarii podajnika.' }
    await assert.rejects(command('finish', finish), /record "new" has no field "early_missing_blocks"/)
    assert.equal((await db.query('SELECT ended_at FROM sa_sessions WHERE id=$1', [session_id])).rows[0].ended_at, null)
    assert.equal((await db.query('SELECT count(*) n FROM sa_handovers')).rows[0].n, 0)

    await db.exec(repair)
    await db.exec(repair)
    await assert.rejects(command('finish', { ...finish, comment: 'Awaria' }), /konkretny powód/)
    await command('finish', finish)
    const closed = (await db.query('SELECT * FROM sa_sessions WHERE id=$1', [session_id])).rows[0]
    assert.ok(closed.ended_at)
    assert.equal(closed.ended_early, true)
    assert.equal(closed.early_end_reason, finish.comment)
    assert.deepEqual(closed.early_missing_blocks, [6, 7, 8, 9, 10, 11, 12, 13])
    assert.equal((await db.query('SELECT count(*) n FROM sa_handovers')).rows[0].n, 1)
    await db.exec(repair)
    assert.deepEqual((await db.query('SELECT early_missing_blocks FROM sa_sessions WHERE id=$1', [session_id])).rows[0].early_missing_blocks, closed.early_missing_blocks)
  } finally { await db.close() }
})
