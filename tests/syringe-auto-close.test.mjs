import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createSyringeDb } from './syringe-db.mjs'

const migration = await readFile(new URL('../supabase/migrations/075_syringe_auto_close.sql', import.meta.url), 'utf8')

test('Automatic closure uses a one-hour grace period and Warsaw dates including DST', async () => {
  const { db } = await createSyringeDb({ full: true })
  try {
    await db.exec(migration)
    for (const [day, shift, expected] of [
      ['2026-09-24', 'I', '2026-09-24T13:00:00.000Z'],
      ['2026-09-24', 'II', '2026-09-24T21:00:00.000Z'],
      ['2026-09-24', 'III', '2026-09-25T05:00:00.000Z'],
      ['2026-10-24', 'III', '2026-10-25T06:00:00.000Z'],
      ['2026-03-28', 'III', '2026-03-29T05:00:00.000Z'],
    ]) {
      assert.equal((await db.query('SELECT sa_shift_auto_close_at($1,$2) t', [day, shift])).rows[0].t.toISOString(), expected)
    }
    const deadline = (await db.query("SELECT sa_shift_auto_close_at('2026-09-24','I') t")).rows[0].t
    assert.ok(new Date('2026-09-24T12:59:59Z') < deadline)
    assert.ok(new Date('2026-09-24T13:00:00Z') >= deadline)
  } finally { await db.close() }
})

test('An expired session releases the machine, preserves production and flags missing handover', async () => {
  const { db, ids, command } = await createSyringeDb({ full: true })
  try {
    const { session_id } = await command('start', { machine_id: ids.machine, assortment_id: ids.assortment, shift_type: 'I' })
    const entry = await command('production', { session_id, last_entry_id: null, print: '100', assembly: '100', defects: [] })
    const stop = await command('downtime_start', { session_id, category_id: ids.downtime })
    await db.query("UPDATE sa_sessions SET session_date='2020-01-01',started_at='2020-01-01 06:00 Europe/Warsaw',production_started_at='2020-01-01 06:00 Europe/Warsaw' WHERE id=$1", [session_id])
    await db.query("UPDATE sa_production_entries SET recorded_at='2020-01-01 07:00 Europe/Warsaw' WHERE id=$1", [entry.record_id])
    await db.query("UPDATE sa_downtime_events SET started_at='2020-01-01 13:00 Europe/Warsaw' WHERE id=$1", [stop.record_id])
    await db.exec(migration)
    const next = await command('start', { machine_id: ids.machine, assortment_id: ids.assortment, shift_type: 'II' }, ids.other)
    assert.notEqual(next.session_id, session_id)
    const closed = (await db.query('SELECT * FROM sa_sessions WHERE id=$1', [session_id])).rows[0]
    assert.equal(closed.ended_at.toISOString(), '2020-01-01T14:00:00.000Z')
    assert.ok(closed.auto_closed_at)
    assert.equal(closed.total_good, 100)
    assert.match(closed.summary_notes, /godzina.*Brak ręcznego przekazania/)
    assert.equal((await db.query('SELECT duration_min FROM sa_downtime_events WHERE id=$1', [stop.record_id])).rows[0].duration_min, 120)
    assert.equal((await db.query('SELECT count(*) n FROM sa_handovers WHERE session_id=$1', [session_id])).rows[0].n, 0)
    assert.equal((await db.query("SELECT count(*) n FROM sa_audit_log WHERE action='session_auto_close'")).rows[0].n, 1)
    // Background reruns do not rewrite an already closed session.
    await db.exec("UPDATE sa_sessions SET session_date=current_date+1 WHERE ended_at IS NULL")
    assert.equal((await db.query('SELECT sa_expire_sessions() n')).rows[0].n, 0)
    await db.exec('SET ROLE authenticated')
    await assert.rejects(db.query('SELECT sa_expire_sessions()'), /permission denied/)
    await assert.rejects(db.query("SELECT sa_session_command_before_auto_close('start','{}')"), /permission denied/)
    await db.exec('RESET ROLE')
  } finally { await db.close() }
})

test('Grace-period sessions stay open; an interrupted changeover is not new production', async () => {
  const { db, ids, command } = await createSyringeDb({ full: true })
  try {
    const { session_id } = await command('start', { machine_id: ids.machine, assortment_id: ids.assortment, shift_type: 'I' })
    const ch = await command('changeover_start', { session_id, to_assortment_id: ids.assortment2, counter_before: '0', print_before: '0' })
    await db.exec(migration)
    await db.query('UPDATE sa_sessions SET session_date=current_date+1 WHERE id=$1', [session_id])
    assert.equal((await db.query('SELECT sa_expire_sessions() n')).rows[0].n, 0)
    await assert.rejects(command('start', { machine_id: ids.machine, assortment_id: ids.assortment, shift_type: 'II' }, ids.other), /trwa już zmiana/)
    await db.query("UPDATE sa_sessions SET session_date='2020-01-01',started_at='2020-01-01 06:00 Europe/Warsaw',production_started_at='2020-01-01 06:00 Europe/Warsaw' WHERE id=$1", [session_id])
    await db.query("UPDATE sa_changeovers SET started_at='2020-01-01 13:00 Europe/Warsaw' WHERE id=$1", [ch.record_id])
    assert.equal((await db.query('SELECT sa_expire_sessions() n')).rows[0].n, 1)
    assert.equal((await db.query('SELECT auto_interrupted FROM sa_changeovers WHERE id=$1', [ch.record_id])).rows[0].auto_interrupted, true)
    const segments = (await db.query('SELECT * FROM sa_production_segments WHERE session_id=$1', [session_id])).rows
    assert.equal(segments.length, 1)
    assert.equal(segments[0].assortment_id, ids.assortment)
  } finally { await db.close() }
})
