import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'
const source = await readFile(new URL('../src/lib/dayReportCorrection.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { distributeQuantity, correctedHourlyRate } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
test('Correction lowers hourly increments and rate without losing pieces to rounding', () => {
  assert.deepEqual(distributeQuantity(150, [100, 200]), [50, 100])
  assert.deepEqual(distributeQuantity(10, [1, 1, 1]), [4, 3, 3])
  assert.deepEqual(distributeQuantity(5, [0, 0]), [3, 2])
  assert.deepEqual(distributeQuantity(0, [100, 200]), [0, 0])
  assert.equal(correctedHourlyRate(150, 120), 75)
  assert.equal(correctedHourlyRate(150, 0), null)
  assert.throws(() => distributeQuantity(-1, [1]))
  assert.throws(() => distributeQuantity(1.5, [1]))
})
test('Atomic correction updates counters, summaries and audit; stale or unauthorized requests roll back', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
      CREATE ROLE authenticated;
      CREATE TABLE profiles(id uuid, role text, is_active boolean, deleted_at timestamptz);
      INSERT INTO profiles VALUES(auth.uid(),'manager',true,null);
      CREATE TABLE shifts(id uuid PRIMARY KEY, updated_at timestamptz, summary_good_count int, summary_reject_count int);
      CREATE TABLE hourly_reports(id uuid PRIMARY KEY, shift_id uuid, updated_at timestamptz, deleted_at timestamptz, hour_start int, good_count int, reject_count int, counter_good int, counter_reject int, total_count int, target int DEFAULT 100, efficiency_pct numeric GENERATED ALWAYS AS (good_count::numeric/target*100) STORED);
      CREATE TABLE audit_logs(user_id uuid,action text,table_name text,record_id uuid,old_values jsonb,new_values jsonb);
      INSERT INTO shifts VALUES('00000000-0000-0000-0000-000000000010','2026-10-12',300,30);
      INSERT INTO hourly_reports(id,shift_id,updated_at,hour_start,good_count,reject_count) VALUES
        ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000010','2026-10-12',23,100,10),
        ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000010','2026-10-12',0,200,20);`)
    await db.exec(await readFile(new URL('../supabase/migrations/077_day_report_shift_correction.sql', import.meta.url),'utf8'))
    const entries = [11,12].map((id,i)=>({id:`00000000-0000-0000-0000-0000000000${id}`,updated_at:'2026-10-12',good_count:(i+1)*50,reject_count:(i+1)*5}))
    const save = (payload=entries) => db.query("SELECT correct_day_report_shift('00000000-0000-0000-0000-000000000010',150,15,'Counter correction','2026-10-12',$1::jsonb)",[JSON.stringify(payload)])
    await save()
    assert.deepEqual((await db.query('SELECT good_count,counter_good,efficiency_pct FROM hourly_reports ORDER BY hour_start DESC')).rows, [{good_count:50,counter_good:50,efficiency_pct:'50.00000000000000000000'},{good_count:100,counter_good:150,efficiency_pct:'100.00000000000000000000'}])
    assert.equal((await db.query('SELECT summary_good_count FROM shifts')).rows[0].summary_good_count,150)
    assert.equal((await db.query('SELECT count(*) n FROM audit_logs')).rows[0].n,1)
    await assert.rejects(save([{...entries[0],updated_at:'2026-10-11'},entries[1]]), /Wpis godzinowy/)
    await assert.rejects(save([entries[0],entries[0]]), /Lista wpisów/)
    await assert.rejects(save([{...entries[0],good_count:0},entries[1]]), /Suma wpisów/)
    await db.exec("UPDATE profiles SET role='operator'")
    await assert.rejects(save(), /Brak uprawnień/)
    assert.equal((await db.query('SELECT count(*) n FROM audit_logs')).rows[0].n,1)
  } finally { await db.close() }
})
