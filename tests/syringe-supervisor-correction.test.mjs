import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createSyringeDb } from './syringe-db.mjs'

test('Supervisor corrects one session, rejects unauthorized/stale changes and closes without deletion', async () => {
  const { db, ids, command } = await createSyringeDb({ full: true })
  try {
    const { session_id } = await command('start', { machine_id: ids.machine, assortment_id: ids.assortment, shift_type: 'I' })
    for (const name of ['075_syringe_auto_close', '079_syringe_supervisor_correction']) {
      await db.exec(await readFile(new URL('../supabase/migrations/' + name + '.sql', import.meta.url), 'utf8'))
    }
    const date = (await db.query("SELECT (current_date+1)::text d")).rows[0].d
    let stamp = (await db.query('SELECT updated_at FROM sa_sessions WHERE id=$1', [session_id])).rows[0].updated_at
    async function correct(actor, close = false, expected = stamp) {
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [actor])
      await db.exec('SET ROLE authenticated')
      try { await db.query('SELECT sa_correct_active_session($1,$2,$3,$4,$5,$6,$7)',
        [session_id, ids.other, date, 'II', close, 'Błędnie otwarta zmiana na linii', expected]) }
      finally { await db.exec('RESET ROLE') }
    }
    await assert.rejects(correct(ids.operator), /Brak uprawnień/)
    await correct(ids.manager)
    const row = (await db.query('SELECT * FROM sa_sessions WHERE id=$1', [session_id])).rows[0]
    assert.equal(row.operator_id, ids.other)
    assert.equal(row.shift_type, 'II')
    await assert.rejects(correct(ids.manager), /zmodyfikowana/)
    stamp = row.updated_at
    await correct(ids.manager, true)
    assert.ok((await db.query('SELECT ended_at FROM sa_sessions WHERE id=$1', [session_id])).rows[0].ended_at)
    assert.equal((await db.query("SELECT count(*)::int n FROM sa_audit_log WHERE action='session_supervisor_correction'")).rows[0].n, 2)
    await assert.rejects(correct(ids.manager, true), /zamknięta/)
  } finally { await db.close() }
})

test('Correction preserves production and refuses reassignment or closure during downtime', async () => {
  const { db, ids, command } = await createSyringeDb({ full: true })
  try {
    const { session_id } = await command('start', { machine_id: ids.machine, assortment_id: ids.assortment, shift_type: 'I' })
    await command('production', { session_id, last_entry_id: null, print: '100', assembly: '100', defects: [] })
    for (const name of ['075_syringe_auto_close', '079_syringe_supervisor_correction']) {
      await db.exec(await readFile(new URL('../supabase/migrations/' + name + '.sql', import.meta.url), 'utf8'))
    }
    const date = (await db.query('SELECT (current_date+1)::text d')).rows[0].d
    async function correct(operator, close) {
      const stamp = (await db.query('SELECT updated_at FROM sa_sessions WHERE id=$1', [session_id])).rows[0].updated_at
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [ids.manager])
      await db.exec('SET ROLE authenticated')
      try { await db.query('SELECT sa_correct_active_session($1,$2,$3,$4,$5,$6,$7)',
        [session_id, operator, date, 'II', close, 'Korekta błędnie otwartej zmiany', stamp]) }
      finally { await db.exec('RESET ROLE') }
    }
    await assert.rejects(correct(ids.other, false), /zawiera wpisy/)
    await correct(ids.operator, false)
    const stop = await command('downtime_start', { session_id, category_id: ids.downtime })
    await assert.rejects(correct(ids.operator, true), /aktywny przestój/)
    await command('downtime_end', { session_id, event_id: stop.record_id, fully_resolved: true })
    await correct(ids.operator, true)
    assert.equal((await db.query('SELECT total_good FROM sa_sessions WHERE id=$1', [session_id])).rows[0].total_good, 100)
    assert.equal((await db.query('SELECT count(*)::int n FROM sa_production_entries WHERE session_id=$1', [session_id])).rows[0].n, 1)
  } finally { await db.close() }
})
