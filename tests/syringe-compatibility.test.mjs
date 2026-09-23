import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { createSyringeDb } from './syringe-db.mjs'

test('UI compatibility fails closed and exposes only the two 2ml variants', async () => {
  const source = await readFile(new URL('../src/lib/syringeCompatibility.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  const { isSyringeCompatible } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
  const machine = { is_active: true, volume_ml: 2 }
  const variants = [2, 2, 5, 10, 20].map(volume_ml => ({ is_active: true, volume_ml }))
  assert.equal(variants.filter(a => isSyringeCompatible(machine, a)).length, 2)
  assert.equal(isSyringeCompatible({ ...machine, volume_ml: null }, variants[0]), false)
  assert.equal(isSyringeCompatible(machine, { ...variants[0], is_active: false }), false)
})

test('Full migrated backend: size guards, two variants, segment boundaries and results', async () => {
  const { db, ids, command } = await createSyringeDb({ full: true })
  try {
    const start = { machine_id: ids.machine, assortment_id: ids.assortment, shift_type: 'II' }
    await assert.rejects(command('start', { ...start, assortment_id: ids.incompatible }), /niezgodny/)
    await assert.rejects(command('start', { ...start, assortment_id: null }), /niedostępny/)
    const variants = (await db.query('SELECT variant FROM sa_assortments WHERE volume_ml = 2 ORDER BY variant')).rows
    assert.deepEqual(variants.map(a => a.variant), ['Nominał', 'Standard'])
    const session = await command('start', start)
    const sid = session.session_id
    await assert.rejects(command('changeover_end', { session_id: sid, event_id: randomUUID() }), /niedostępne/)
    await assert.rejects(command('changeover_start', { session_id: sid, to_assortment_id: ids.incompatible, counter_before: '0', print_before: '0' }), /niezgodny/)
    const first = await command('production', { session_id: sid, last_entry_id: null, print: '2000', assembly: '2000', defects: [], notes: 'Wynik przed przezbrojeniem' })
    await assert.rejects(command('changeover_start', { session_id: sid, to_assortment_id: ids.assortment2, counter_before: '2000', print_before: '2100' }), /Stan druku/)
    const ch = await command('changeover_start', { session_id: sid, to_assortment_id: ids.assortment2, counter_before: '2000', print_before: '2000' })
    assert.equal((await db.query('SELECT machine_status FROM sa_sessions WHERE id=$1', [sid])).rows[0].machine_status, 'changeover')
    await assert.rejects(command('changeover_start', { session_id: sid, to_assortment_id: ids.assortment2 }), /Najpierw zakończ/)
    await assert.rejects(command('production', { session_id: sid, last_entry_id: first.record_id, print: '2100', assembly: '2100', defects: [] }), /podczas przezbrojenia/)
    for (const item of (await db.query('SELECT id FROM sa_checklist_items WHERE is_required AND is_active')).rows) {
      await command('checklist', { session_id: sid, changeover_id: ch.record_id, item_id: item.id, completed: true })
    }
    await assert.rejects(command('changeover_end', { session_id: sid, event_id: ch.record_id, to_assortment_id: ids.incompatible }), /niezgodny/)
    assert.equal((await db.query('SELECT ended_at FROM sa_changeovers WHERE id=$1', [ch.record_id])).rows[0].ended_at, null)
    await db.query('UPDATE sa_assortments SET is_active=false WHERE id=$1', [ids.assortment2])
    await assert.rejects(command('changeover_end', { session_id: sid, event_id: ch.record_id }), /niezgodny/)
    await db.query('UPDATE sa_assortments SET is_active=true WHERE id=$1', [ids.assortment2])
    await db.query("UPDATE sa_changeovers SET started_at=clock_timestamp()-interval '15 minutes' WHERE id=$1", [ch.record_id])
    await command('changeover_end', { session_id: sid, event_id: ch.record_id })
    assert.equal((await db.query('SELECT duration_min FROM sa_changeovers WHERE id=$1', [ch.record_id])).rows[0].duration_min, 15)
    await assert.rejects(command('changeover_end', { session_id: sid, event_id: ch.record_id }), /niedostępne/)
    // Place the real records on the requested 200 + 15 + 265 minute timeline.
    const base = Date.now() - 480 * 60000
    const at = minutes => new Date(base + minutes * 60000).toISOString()
    await db.query('UPDATE sa_sessions SET started_at=$2, production_started_at=$3 WHERE id=$1', [sid, at(0), at(215)])
    await db.query('UPDATE sa_production_entries SET recorded_at=$2 WHERE id=$1', [first.record_id, at(200)])
    await db.query('UPDATE sa_changeovers SET started_at=$2, ended_at=$3, duration_min=15 WHERE id=$1', [ch.record_id, at(200), at(215)])
    await assert.rejects(command('production_edit', { session_id: sid, last_entry_id: first.record_id, correction_reason: 'Poprawa poprzedniego segmentu' }), /poprzedniego asortymentu/)
    const second = await command('production', { session_id: sid, last_entry_id: first.record_id, print: '4650', assembly: '4650', defects: [], notes: 'Wynik po przezbrojeniu' })
    const rows = (await db.query('SELECT assortment_id, good_qty, per_hour FROM sa_production_entries WHERE session_id=$1 ORDER BY recorded_at', [sid])).rows
    assert.deepEqual(rows.map(r => [r.assortment_id, r.good_qty]), [[ids.assortment, 2000], [ids.assortment2, 2650]])
    assert.equal(Number(rows[1].per_hour), 600)
    const totals = (await db.query('SELECT * FROM sa_sessions WHERE id=$1', [sid])).rows[0]
    assert.equal(totals.total_runtime_min, 465)
    assert.equal(totals.total_downtime_min, 15)
    assert.equal(totals.total_good, 4650)
    assert.equal(totals.machine_status, 'production')
    const segments = (await db.query('SELECT * FROM sa_production_segments WHERE session_id=$1 ORDER BY started_at', [sid])).rows
    assert.equal(segments.length, 2)
    assert.equal((segments[0].ended_at - segments[0].started_at) / 60000, 200)
    assert.equal(segments[1].started_at.toISOString(), at(215))
    assert.equal(segments[1].assortment_id, ids.assortment2)
    await assert.rejects(db.query('UPDATE sa_machines SET volume_ml=5 WHERE id=$1', [ids.machine]), /Nie można zmienić rozmiaru/)
    await assert.rejects(db.query('UPDATE sa_assortments SET volume_ml=5 WHERE id=$1', [ids.assortment2]), /Nie można zmienić rozmiaru/)
    await assert.rejects(db.query('INSERT INTO sa_orders(order_number,machine_id,assortment_id,target_qty) VALUES($1,$2,$3,100)', [randomUUID(), ids.machine, ids.incompatible]), /niezgodny/)
    await db.exec('SET ROLE authenticated')
    await assert.rejects(db.query('UPDATE sa_sessions SET assortment_id=$2 WHERE id=$1', [sid, ids.incompatible]), /permission denied/)
    await db.exec('RESET ROLE')
    const auditSql = await readFile(new URL('../supabase/diagnostics/syringe_size_audit.sql', import.meta.url), 'utf8')
    assert.equal((await db.exec(auditSql))[0].rows.length, 0)
    // Simulate a historical mismatch without treating it as valid new production.
    await db.exec('BEGIN; ALTER TABLE sa_sessions DISABLE TRIGGER sa_compat_session;')
    await db.query("INSERT INTO sa_sessions(machine_id, operator_id, assortment_id, shift_type, session_date, ended_at) VALUES($1,$2,$3,'I',current_date,clock_timestamp())", [ids.machine2, ids.other, ids.incompatible])
    assert.equal((await db.exec(auditSql))[0].rows[0].source, 'session')
    await db.exec('ROLLBACK')
    assert.ok(second.record_id)
  } finally { await db.close() }
})

test('A new segment resets the entry limit and excludes changeover from the low-output norm', async () => {
  const { db, ids, command } = await createSyringeDb({ full: true })
  try {
    const { session_id } = await command('start', { machine_id: ids.machine, assortment_id: ids.assortment, shift_type: 'I' })
    let last = null
    for (let i = 1; i <= 8; i++) {
      last = (await command('production', { session_id, last_entry_id: last, print: String(i * 100), assembly: String(i * 100), defects: [] })).record_id
    }
    await assert.rejects(command('production', { session_id, last_entry_id: last, print: '900', assembly: '900', defects: [] }), /8 wpisów/)
    await db.query("UPDATE sa_sessions SET started_at=clock_timestamp()-interval '3 hours' WHERE id=$1", [session_id])
    await db.query("UPDATE sa_production_entries SET recorded_at=clock_timestamp()-interval '2 hours' WHERE id=$1", [last])
    // Keep the final counter as the latest entry despite the simulated historical time.
    await db.query("UPDATE sa_production_entries SET recorded_at=clock_timestamp()-interval '150 minutes' WHERE session_id=$1 AND id<>$2", [session_id, last])
    const ch = await command('changeover_start', { session_id, to_assortment_id: ids.assortment2, counter_before: '800', print_before: '800' })
    for (const item of (await db.query('SELECT id FROM sa_checklist_items WHERE is_required AND is_active')).rows) {
      await command('checklist', { session_id, changeover_id: ch.record_id, item_id: item.id, completed: true })
    }
    await command('changeover_end', { session_id, event_id: ch.record_id })
    // No reason is required: the new segment just started, despite a two-hour-old counter.
    await command('production', { session_id, last_entry_id: last, print: '900', assembly: '900', defects: [] })
    assert.equal((await db.query('SELECT total_good FROM sa_sessions WHERE id=$1', [session_id])).rows[0].total_good, 900)
  } finally { await db.close() }
})
