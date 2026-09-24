import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export async function createMessengerDb() {
  const db = new PGlite()
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, full_name text NOT NULL, role text NOT NULL,
      is_active boolean NOT NULL DEFAULT true, deleted_at timestamptz);
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/073_internal_messenger.sql', import.meta.url), 'utf8'))
  const users = {}
  for (const [role, full_name] of Object.entries({ operator: 'Anna Operator', syringe_operator: 'Piotr Strzykawki', manager: 'Maria Kierownik', specialist: 'Jan Technik', executive: 'Ewa Zarząd', admin: 'Petro Admin', viewer: 'Gość Demo' })) {
    users[role] = { id: randomUUID(), role, full_name }
    await db.query('INSERT INTO profiles(id,full_name,role) VALUES($1,$2,$3)', [users[role].id, full_name, role])
  }
  async function as(user, sql, params = [], role = 'authenticated') {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [user?.id ?? ''])
    await db.exec(`SET ROLE ${role}`)
    try { return await db.query(sql, params) } finally { await db.exec('RESET ROLE') }
  }
  async function rpc(user, name, args = {}) {
    const names = { chat_contacts: [], chat_inbox: [], chat_send: ['p_recipient', 'p_body', 'p_request_id'], chat_mark_read: ['p_conversation', 'p_through_seq'] }
    if (!Object.hasOwn(names, name)) throw new Error('Unknown test RPC')
    return (await as(user, `SELECT * FROM ${name}(${names[name].map((_, i) => '$' + (i + 1)).join(',')})`, names[name].map(k => args[k]))).rows
  }
  return { db, users, as, rpc }
}
