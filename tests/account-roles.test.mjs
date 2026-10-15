import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('only assigned accounts can switch functions; existing RLS follows the chosen role', async () => {
  const db = new PGlite()
  const admin = '00000000-0000-0000-0000-000000000001'
  const dual = '00000000-0000-0000-0000-000000000002'
  const single = '00000000-0000-0000-0000-000000000003'
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE TYPE public.user_role AS ENUM ('operator', 'manager', 'admin', 'syringe_operator');
      CREATE TABLE public.profiles(id uuid PRIMARY KEY, role user_role NOT NULL, full_name text, is_active boolean DEFAULT true, deleted_at timestamptz, updated_at timestamptz DEFAULT now(), must_change_password boolean DEFAULT false);
      CREATE TABLE public.audit_logs(user_id uuid, action text, table_name text, record_id uuid, old_values jsonb, new_values jsonb);
      CREATE FUNCTION public.current_user_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT role::text FROM profiles WHERE id = auth.uid() AND is_active AND deleted_at IS NULL $$;
      ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
      CREATE POLICY own_read ON profiles FOR SELECT USING (id = auth.uid() OR current_user_role() = 'admin');
      CREATE POLICY own_update ON profiles FOR UPDATE USING (id = auth.uid() OR current_user_role() = 'admin');
      GRANT USAGE ON SCHEMA auth, public TO authenticated;
      GRANT SELECT, UPDATE ON profiles TO authenticated;
      CREATE TABLE manager_secret(value text);
      INSERT INTO manager_secret VALUES ('restricted');
      ALTER TABLE manager_secret ENABLE ROW LEVEL SECURITY;
      CREATE POLICY managers ON manager_secret FOR SELECT USING (current_user_role() = 'manager');
      GRANT SELECT ON manager_secret TO authenticated;
      INSERT INTO profiles(id, role) VALUES ('${admin}', 'admin'), ('${dual}', 'operator'), ('${single}', 'operator');
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/080_operator_manager_access.sql', import.meta.url), 'utf8'))
    const as = async (actor, sql, args = []) => {
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [actor])
      await db.exec('SET ROLE authenticated')
      try { return await db.query(sql, args) } finally { await db.exec('RESET ROLE') }
    }
    await assert.rejects(as(single, "SELECT switch_operator_manager_role('manager')"), /przypisanych obu/)
    await assert.rejects(as(single, 'UPDATE profiles SET operator_manager_access = true WHERE id = $1', [single]), /administrator/)
    await assert.rejects(as(single, "UPDATE profiles SET role = 'admin' WHERE id = $1", [single]), /administrator/)
    await as(admin, 'UPDATE profiles SET operator_manager_access = true WHERE id = $1', [dual])
    assert.equal((await as(dual, 'SELECT * FROM manager_secret')).rows.length, 0)
    await as(dual, "SELECT switch_operator_manager_role('manager')")
    assert.equal((await as(dual, 'SELECT * FROM manager_secret')).rows.length, 1)
    assert.equal((await as(dual, 'SELECT role FROM profiles WHERE id = $1', [single])).rows.length, 0)
    await assert.rejects(as(dual, "SELECT switch_operator_manager_role('admin')"), /Niedozwolona/)
    await assert.rejects(as(dual, "SELECT switch_operator_manager_role(NULL)"), /Niedozwolona/)
    await as(dual, "SELECT switch_operator_manager_role('operator')")
    assert.equal((await as(dual, 'SELECT * FROM manager_secret')).rows.length, 0)
    assert.equal((await db.query('SELECT * FROM audit_logs WHERE user_id = $1', [dual])).rows.length, 2)
    await as(dual, 'UPDATE profiles SET must_change_password = false WHERE id = $1', [dual])
    await as(admin, 'UPDATE profiles SET operator_manager_access = false WHERE id = $1', [dual])
    await assert.rejects(as(dual, "SELECT switch_operator_manager_role('manager')"), /przypisanych obu/)
    await as(admin, 'UPDATE profiles SET operator_manager_access = true, is_active = false WHERE id = $1', [dual])
    await assert.rejects(as(dual, "SELECT switch_operator_manager_role('manager')"), /przypisanych obu/)
    await assert.rejects(as(dual, 'UPDATE profiles SET is_active = true WHERE id = $1', [dual]), /administrator/)
    await as(admin, 'UPDATE profiles SET is_active = true, deleted_at = now() WHERE id = $1', [dual])
    await assert.rejects(as(dual, "SELECT switch_operator_manager_role('manager')"), /przypisanych obu/)
    await assert.rejects(as(null, "SELECT switch_operator_manager_role('manager')"), /Niedozwolona/)
    assert.equal((await db.query('SELECT role FROM profiles WHERE id = $1', [single])).rows[0].role, 'operator')
  } finally { await db.close() }
})
