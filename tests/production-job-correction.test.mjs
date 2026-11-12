import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('Manager correction validates access, recalculates confirmed jobs, audits and rejects stale edits', async () => {
 const db = new PGlite()
 const actor='00000000-0000-0000-0000-000000000001', job='00000000-0000-0000-0000-000000000002'
 try {
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${actor}'::uuid $$;
   CREATE TABLE profiles(id uuid,role text,is_active boolean,deleted_at timestamptz);
   CREATE TABLE production_jobs(id uuid PRIMARY KEY,order_number text UNIQUE,assortment_name text,assortment_length_cm int,label_count int,multiplier int,calculated_qty int,status text,updated_at timestamptz);
   CREATE TABLE audit_logs(user_id uuid,action text,table_name text,record_id uuid,old_values jsonb,new_values jsonb);
   INSERT INTO profiles VALUES('${actor}','operator',true,null);
   INSERT INTO production_jobs VALUES('${job}','Z/1/11/26','IS PRO 150 cm',150,1,700,700,'confirmed','2026-11-05');
   CREATE FUNCTION touch_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at:=clock_timestamp(); RETURN NEW; END $$;
   CREATE TRIGGER touch BEFORE UPDATE ON production_jobs FOR EACH ROW EXECUTE FUNCTION touch_job();`)
  await db.exec(await readFile(new URL('../supabase/migrations/084_production_job_correction.sql',import.meta.url),'utf8'))
  const correct=(expected='2026-11-05',assortment='IS PRO 180 cm',labels=2)=>db.query('SELECT * FROM production_job_correct($1,$2,$3,$4,$5,$6)',[job,expected,'Z/2/11/26',assortment,labels,'Poprawa błędnego asortymentu'])
  await assert.rejects(correct(),/uprawnień/)
  await db.exec("UPDATE profiles SET role='manager'")
  await assert.rejects(correct(undefined,'invalid'),/asortyment/)
  await assert.rejects(correct(undefined,undefined,0),/etykiet/)
  const result=(await correct()).rows[0]
  assert.equal(result.calculated_qty,1300)
  assert.equal(result.multiplier,650)
  assert.equal(result.status,'confirmed')
  const audit=(await db.query('SELECT * FROM audit_logs')).rows[0]
  assert.equal(audit.old_values.assortment_name,'IS PRO 150 cm')
  assert.equal(audit.new_values.assortment_name,'IS PRO 180 cm')
  assert.ok(audit.new_values.correction_reason)
  await assert.rejects(correct(),/zmienione/)
  await db.exec(`CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END $$;
   CREATE TRIGGER reject_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit();`)
  await assert.rejects(correct(result.updated_at,'IS PRO 150 cm'),/audit failure/)
  assert.equal((await db.query('SELECT assortment_name FROM production_jobs')).rows[0].assortment_name,'IS PRO 180 cm')
 } finally { await db.close() }
})
