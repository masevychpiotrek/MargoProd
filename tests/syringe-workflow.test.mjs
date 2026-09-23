import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createSyringeDb } from './syringe-db.mjs'

test('Full shift: counters, rejects, retries, lost response, stops, handover, new shift from zero', async () => {
  const { db, ids, command } = await createSyringeDb()
  try {
    const start = { machine_id: ids.machine, assortment_id: ids.assortment, shift_type: 'I', plan_qty: 10000, request_id: randomUUID() }
    const s = await command('start', start)
    assert.deepEqual(await command('start', start), s)
    await assert.rejects(command('start', { ...start, request_id: randomUUID(), machine_id: ids.machine2 }), /Masz już/)
    await assert.rejects(command('start', { ...start, request_id: randomUUID() }, ids.other), /trwa już zmiana/)
    const payload = { session_id: s.session_id, last_entry_id: null, print: '1000', assembly: '950', defects: [{ category_id: ids.defect, qty: 50 }] }
    await assert.rejects(command('production', { ...payload, print: '1000.8' }), /całkowitymi/)
    await assert.rejects(command('production', { ...payload, defects: [] }), /Suma kategorii/)
    assert.equal((await db.query('SELECT count(*) n FROM sa_production_entries')).rows[0].n, 0)
    const receipt = { ...payload, request_id: randomUUID() }
    const e1 = await command('production', receipt)
    assert.deepEqual(await command('production', receipt), e1)
    await assert.rejects(command('production', payload), /W międzyczasie/)
    await assert.rejects(command('production', { ...payload, last_entry_id: e1.record_id }, ids.other), /dostępu/)
    await db.query("UPDATE sa_sessions SET started_at = clock_timestamp() - interval '2 hours' WHERE id = $1", [s.session_id])
    await db.query("UPDATE sa_production_entries SET recorded_at = clock_timestamp() - interval '1 hour' WHERE id = $1", [e1.record_id])
    const e2 = await command('production', { ...payload, last_entry_id: e1.record_id, print: '3000', assembly: '2800', defects: [{ category_id: ids.defect, qty: 100 }, { category_id: ids.tech, qty: 50 }] })
    const row = (await db.query('SELECT * FROM sa_sessions WHERE id = $1', [s.session_id])).rows[0]
    assert.equal(row.total_produced, 3000); assert.equal(row.total_good, 2800); assert.equal(row.total_reject, 200)
    assert.equal(Number(row.plan_pct), 28); assert.equal(row.total_tech_reject, 50)
    assert.ok(Math.abs(Number(row.avg_per_hour) - 1400) < 1)
    assert.equal(Number((await db.query('SELECT per_hour FROM sa_production_entries WHERE id = $1', [e2.record_id])).rows[0].per_hour), 1850)
    await assert.rejects(command('production', { ...payload, last_entry_id: e2.record_id, print: '100', assembly: '90', defects: [{ category_id: ids.defect, qty: 10 }] }), /maleć/)
    const reset = await command('production', { ...payload, last_entry_id: e2.record_id, print: '100', assembly: '90', print_reset: true, assembly_reset: true, print_reset_reason: 'Reset PLC', assembly_reset_reason: 'Reset PLC', defects: [{ category_id: ids.defect, qty: 10 }] })
    await assert.rejects(command('production', { ...payload, last_entry_id: reset.record_id, print: '100', assembly: '100', defects: [] }), /montażu/)
    const stop = await command('downtime_start', { session_id: s.session_id, category_id: ids.downtime })
    await assert.rejects(command('downtime_start', { session_id: s.session_id, category_id: ids.downtime }), /Najpierw zakończ/)
    await assert.rejects(command('finish', { session_id: s.session_id, final_print: '100', final_assembly: '90' }), /przestój/)
    await db.query("UPDATE sa_downtime_events SET started_at = clock_timestamp() - interval '30 minutes' WHERE id = $1", [stop.record_id])
    await command('downtime_end', { session_id: s.session_id, event_id: stop.record_id, fully_resolved: true })
    await assert.rejects(command('finish', { session_id: s.session_id, final_print: '200', final_assembly: '190' }), /Najpierw zapisz produkcję/)
    const finish = { session_id: s.session_id, final_print: '100', final_assembly: '90', request_id: randomUUID() }
    await command('finish', finish); await command('finish', finish)
    const closed = (await db.query('SELECT * FROM sa_sessions WHERE id = $1', [s.session_id])).rows[0]
    assert.ok(closed.ended_at); assert.equal(closed.total_good, 2890); assert.equal(closed.total_reject, 210)
    assert.equal(closed.total_downtime_min, 30); assert.equal(closed.total_runtime_min, 90)
    assert.equal((await db.query('SELECT count(*) n FROM sa_handovers')).rows[0].n, 1)
    assert.equal((await db.query('SELECT count(*) n FROM sa_production_entries')).rows[0].n, 3)
    await assert.rejects(command('production', { ...payload, last_entry_id: reset.record_id }), /zakończona/)
    const next = await command('start', { ...start, shift_type: 'II', request_id: randomUUID() })
    await command('production', { ...payload, session_id: next.session_id, print: '500', assembly: '500', defects: [] })
    assert.equal((await db.query('SELECT total_good FROM sa_sessions WHERE id = $1', [next.session_id])).rows[0].total_good, 500)
  } finally { await db.close() }
})

test('Changeover checklist, new assortment, loss time, zero rejects validation and permissions', async () => {
  const { db, ids, command } = await createSyringeDb()
  try {
    const s = await command('start', { machine_id: ids.machine, assortment_id: ids.assortment, shift_type: 'III' })
    const c = await command('changeover_start', { session_id: s.session_id, to_assortment_id: ids.assortment2, counter_before: '0', print_before: '0' })
    await assert.rejects(command('changeover_end', { session_id: s.session_id, event_id: c.record_id }), /checklisty/)
    await assert.rejects(command('finish', { session_id: s.session_id, final_print: '0', final_assembly: '0' }), /przezbrojenie/)
    const items = (await db.query('SELECT id FROM sa_checklist_items WHERE is_required')).rows
    for (const i of items) await command('checklist', { session_id: s.session_id, changeover_id: c.record_id, item_id: i.id, completed: true })
    await db.query("UPDATE sa_changeovers SET started_at = clock_timestamp() - interval '10 minutes' WHERE id = $1", [c.record_id])
    await db.query("UPDATE sa_sessions SET started_at = clock_timestamp() - interval '20 minutes' WHERE id = $1", [s.session_id])
    await command('changeover_end', { session_id: s.session_id, event_id: c.record_id })
    const row = (await db.query('SELECT * FROM sa_sessions WHERE id = $1', [s.session_id])).rows[0]
    assert.equal(row.assortment_id, ids.assortment2); assert.equal(row.total_downtime_min, 10)
    await assert.rejects(command('production', { session_id: s.session_id, last_entry_id: null, print: '100', assembly: '100', defects: [{ category_id: ids.defect, qty: 1 }] }), /Suma kategorii/)
    await assert.rejects(command('production', { session_id: s.session_id, last_entry_id: null, print: '100', assembly: '90', defects: [{ category_id: ids.otherDefect, qty: 10, notes: ' ' }] }), /komentarza/)
    await db.exec('SET ROLE authenticated')
    await assert.rejects(db.query('UPDATE sa_sessions SET total_good = 999 WHERE id = $1', [s.session_id]), /permission denied/)
    await db.exec('RESET ROLE')
    const f = await command('failure', { session_id: s.session_id, symptoms: 'Zacięcie podajnika', priority: 'high', production_stopped: true })
    assert.ok(f.record_id)
    assert.equal((await db.query('SELECT count(*) n FROM sa_downtime_events WHERE ended_at IS NULL')).rows[0].n, 1)
  } finally { await db.close() }
})

test('Correction replaces only latest entry, updates totals and next baseline; failed correction rolls back', async () => {
  const { db, ids, command } = await createSyringeDb()
  try {
    const s = await command('start', { machine_id: ids.machine, assortment_id: ids.assortment, shift_type: 'I', plan_qty: 1000 })
    const p = { session_id: s.session_id, last_entry_id: null, print: '1000', assembly: '900', defects: [{ category_id: ids.defect, qty: 100 }] }
    const e = await command('production', p)
    await assert.rejects(command('production_edit', { ...p, last_entry_id: e.record_id, print: '950', defects: [] , correction_reason: 'Błędny odczyt' }), /Suma kategorii/)
    assert.equal((await db.query('SELECT is_cancelled FROM sa_production_entries WHERE id = $1', [e.record_id])).rows[0].is_cancelled, false)
    const corrected = await command('production_edit', { ...p, last_entry_id: e.record_id, assembly: '950', defects: [{ category_id: ids.defect, qty: 50 }], correction_reason: 'Błędny odczyt' })
    assert.equal((await db.query('SELECT total_good FROM sa_sessions WHERE id = $1', [s.session_id])).rows[0].total_good, 950)
    await command('production', { ...p, last_entry_id: corrected.record_id, print: '2000', assembly: '1950', defects: [] })
    const total = (await db.query('SELECT total_good, total_reject, plan_pct FROM sa_sessions WHERE id = $1', [s.session_id])).rows[0]
    assert.equal(total.total_good, 1950); assert.equal(total.total_reject, 50); assert.equal(Number(total.plan_pct), 195)
    await assert.rejects(command('production_edit', { ...p, last_entry_id: corrected.record_id, correction_reason: 'Stary wpis' }), /W międzyczasie/)
  } finally { await db.close() }
})
