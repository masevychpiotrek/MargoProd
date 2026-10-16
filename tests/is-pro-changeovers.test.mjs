import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'

async function setup() {
  const db = new PGlite()
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
    CREATE TABLE profiles(id uuid PRIMARY KEY,role text,is_active boolean DEFAULT true,deleted_at timestamptz);
    CREATE TABLE machines(id uuid PRIMARY KEY);
    CREATE TABLE assortments(id uuid PRIMARY KEY,name text,is_active boolean DEFAULT true);
    CREATE TABLE shifts(id uuid PRIMARY KEY,machine_id uuid REFERENCES machines,operator_1_id uuid,operator_2_id uuid,
      shift_date date DEFAULT current_date,started_at timestamptz DEFAULT now(),ended_at timestamptz,
      summary_good_count integer,summary_reject_count integer);
    CREATE TABLE hourly_reports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shift_id uuid REFERENCES shifts,
      machine_id uuid,operator_id uuid,hour_block text,report_date date,hour_start integer,
      good_count integer DEFAULT 0,reject_count integer DEFAULT 0,counter_good integer,counter_reject integer,
      target integer DEFAULT 3200,runtime_min integer DEFAULT 0,downtime_reason text,deleted_at timestamptz);
    GRANT USAGE ON SCHEMA public,auth TO authenticated;
    GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/081_is_pro_assortment_changeovers.sql', import.meta.url), 'utf8'))
  const ids = { operator: randomUUID(), stranger: randomUUID(), machine: randomUUID(), shift: randomUUID(), a: randomUUID(), b: randomUUID() }
  await db.query("INSERT INTO profiles(id,role) VALUES($1,'operator'),($2,'operator')", [ids.operator, ids.stranger])
  await db.query('INSERT INTO machines VALUES($1)', [ids.machine])
  await db.query("INSERT INTO assortments(id,name) VALUES($1,'A'),($2,'B')", [ids.a, ids.b])
  await db.query('INSERT INTO shifts(id,machine_id,operator_1_id) VALUES($1,$2,$3)', [ids.shift, ids.machine, ids.operator])
  await db.query("SELECT set_config('test.actor',$1,false)", [ids.operator])
  const command = async (action, segment = null, assortment = null, good = null, reject = null) => {
    await db.exec('SET ROLE authenticated')
    try { return (await db.query('SELECT is_pro_command($1,$2,$3,$4,$5,$6) id', [ids.shift, action, segment, assortment, good, reject])).rows[0].id }
    finally { await db.exec('RESET ROLE') }
  }
  const report = async (segment, hour, good, counter, reject = 0, rejectCounter = 0) => {
    await db.exec('SET ROLE authenticated')
    try { return await db.query(`INSERT INTO hourly_reports(shift_id,machine_id,operator_id,hour_start,good_count,counter_good,reject_count,counter_reject,segment_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [ids.shift,ids.machine,ids.operator,hour,good,counter,reject,rejectCounter,segment]) }
    finally { await db.exec('RESET ROLE') }
  }
  return { db, ids, command, report }
}

test('Cumulative counters reset per assortment, closing tail is saved once, shift total remains correct', async () => {
  const { db, ids, command, report } = await setup()
  try {
    const a = await command('start',null,ids.a)
    await report(a,6,2000,2000)
    await report(a,7,2560,4560)
    await assert.rejects(command('changeover',a,null,4000,0), /mniejszy/)
    await command('changeover',a,null,5100,20)
    await command('changeover',a,null,5100,20)
    assert.equal((await db.query('SELECT count(*) n FROM is_pro_changeovers')).rows[0].n, 1)
    await assert.rejects(report(a,8,10,5110), /zakończonego/)
    const b = await command('start',null,ids.b)
    // Both products can have an entry in the same clock hour.
    await report(b,7,150,150)
    await report(b,8,2191,2341)
    await assert.rejects(report(b,9,1,1), /nieaktualny/)
    await db.query('UPDATE shifts SET summary_good_count=7441,summary_reject_count=20,ended_at=now() WHERE id=$1', [ids.shift])
    const segments = (await db.query('SELECT final_good,final_reject FROM is_pro_segments ORDER BY started_at')).rows
    assert.deepEqual(segments, [{ final_good: 5100, final_reject: 20 }, { final_good: 2341, final_reject: 0 }])
    assert.equal((await db.query('SELECT sum(good_count) n FROM hourly_reports')).rows[0].n, 7441)
    assert.ok((await db.query('SELECT ended_at FROM is_pro_changeovers')).rows[0].ended_at)
  } finally { await db.close() }
})

test('Final shift counter includes the unreported remainder without duplicating hourly readings', async () => {
  const { db, ids, command, report } = await setup()
  try {
    const a = await command('start',null,ids.a)
    await report(a,6,2000,2000)
    await db.query('UPDATE shifts SET summary_good_count=2100,summary_reject_count=5,ended_at=now() WHERE id=$1', [ids.shift])
    assert.equal((await db.query('SELECT sum(good_count) n FROM hourly_reports')).rows[0].n, 2100)
    assert.equal((await db.query('SELECT final_good FROM is_pro_segments')).rows[0].final_good, 2100)
    await assert.rejects(command('start',null,ids.b), /dostępu/)
  } finally { await db.close() }
})

test('Transitions require shift ownership; table writes cannot bypass the command', async () => {
  const { db, ids, command } = await setup()
  try {
    await db.query("SELECT set_config('test.actor',$1,false)", [ids.stranger])
    await assert.rejects(command('start',null,ids.a), /dostępu/)
    await db.exec('SET ROLE authenticated')
    await assert.rejects(db.query('INSERT INTO is_pro_segments(shift_id,assortment_id) VALUES($1,$2)', [ids.shift,ids.a]), /permission denied/)
    await db.exec('RESET ROLE')
  } finally { await db.close() }
})

test('Changeover survives shift handover and is split by overlap, not counted twice', async () => {
  const { db, ids, command } = await setup()
  try {
    const a = await command('start',null,ids.a)
    await command('changeover',a,null,4560,0)
    await db.query('UPDATE shifts SET ended_at=now() WHERE id=$1', [ids.shift])
    const next = randomUUID()
    await db.query('INSERT INTO shifts(id,machine_id,operator_1_id) VALUES($1,$2,$3)', [next,ids.machine,ids.operator])
    const before = (await db.query('SELECT * FROM is_pro_changeovers')).rows[0]
    assert.equal(before.ended_at,null)
    await db.query("SELECT is_pro_command($1,'start',null,$2)", [next,ids.b])
    assert.ok((await db.query('SELECT ended_at FROM is_pro_changeovers')).rows[0].ended_at)
    const source = await readFile(new URL('../src/lib/isProProduction.ts', import.meta.url), 'utf8')
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
    const { overlapMilliseconds: overlap } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
    assert.equal(overlap(0,30,-10,10)+overlap(0,30,10,40),30)
    assert.equal(overlap(0,30,40,50),0)
    assert.equal(overlap(0,30,10,10),0)
  } finally { await db.close() }
})
