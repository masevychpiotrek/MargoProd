import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

export async function createSyringeDb() {
  const db = new PGlite()
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
    CREATE TYPE user_role AS ENUM ('admin', 'manager', 'operator', 'specialist', 'executive', 'viewer');
    CREATE TABLE profiles(id uuid PRIMARY KEY, role user_role NOT NULL, full_name text, is_active boolean DEFAULT true, deleted_at timestamptz);
    GRANT USAGE ON SCHEMA public, auth TO authenticated;
  `)
  const base = await readFile(new URL('../supabase/migrations/035_syringe_operator_module.sql', import.meta.url), 'utf8')
  await db.exec(base.replace(/^ALTER PUBLICATION .*;\r?$/gm, ''))
  await db.exec(await readFile(new URL('../supabase/migrations/042_syringe_dual_counter_and_targets.sql', import.meta.url), 'utf8'))
  await db.exec('GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;')
  await db.exec(await readFile(new URL('../supabase/migrations/060_syringe_workflow_hardening.sql', import.meta.url), 'utf8'))
  const ids = { operator: randomUUID(), other: randomUUID(), manager: randomUUID(), machine: randomUUID(), machine2: randomUUID() }
  await db.query(`INSERT INTO profiles(id, role, full_name) VALUES ($1, 'syringe_operator', 'Operator Testowy'), ($2, 'syringe_operator', 'Drugi Operator'), ($3, 'manager', 'Kierownik Testowy')`, [ids.operator, ids.other, ids.manager])
  await db.query(`INSERT INTO sa_machines(id, name, code, nominal_per_hour) VALUES($1, 'Linia testowa 1', 'TEST1', 2400), ($2, 'Linia testowa 2', 'TEST2', 2400)`, [ids.machine, ids.machine2])
  ids.assortment = (await db.query("SELECT id FROM sa_assortments WHERE code = 'SYR_2ML'")).rows[0].id
  ids.assortment2 = (await db.query("SELECT id FROM sa_assortments WHERE code = 'SYR_5ML'")).rows[0].id
  ids.defect = (await db.query("SELECT id FROM sa_defect_categories WHERE code = 'PRINT_BAD'")).rows[0].id
  ids.tech = (await db.query("SELECT id FROM sa_defect_categories WHERE code = 'TECH_STARTUP'")).rows[0].id
  ids.otherDefect = (await db.query("SELECT id FROM sa_defect_categories WHERE code = 'OTHER'")).rows[0].id
  ids.downtime = (await db.query("SELECT id FROM sa_downtime_categories WHERE code = 'MECH_FAILURE'")).rows[0].id
  const command = async (action, payload, actor = ids.operator) => {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [actor])
    await db.exec('SET ROLE authenticated')
    try {
      return (await db.query('SELECT sa_session_command($1, $2::jsonb) result', [action, JSON.stringify({ request_id: randomUUID(), ...payload })])).rows[0].result
    } finally { await db.exec('RESET ROLE') }
  }
  return { db, ids, command }
}
