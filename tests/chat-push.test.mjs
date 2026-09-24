import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createECDH, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import webpush from 'web-push'
import { createMessengerDb } from './messenger-db.mjs'

const sql = await readFile(new URL('../supabase/migrations/074_chat_web_push.sql', import.meta.url), 'utf8')
const sw = await readFile(new URL('../public/chat-push-sw.js', import.meta.url), 'utf8')
const source = await readFile(new URL('../supabase/functions/send-chat-push/delivery.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { deliverPush, allowedPushEndpoint } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
function subscription() {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys()
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`, p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') }
}

test('Push subscriptions are private; recipient-only jobs skip read messages and old device owners', async () => {
  const { db, users, rpc, as } = await createMessengerDb()
  try {
    await db.exec('CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public, auth TO service_role;')
    await db.exec(sql)
    const own = subscription(), other = subscription()
    const register = (user, sub) => as(user, 'SELECT chat_push_register($1,$2,$3) id', [sub.endpoint, sub.p256dh, sub.auth])
    await register(users.operator, own)
    const subId = (await register(users.manager, other)).rows[0].id
    assert.equal((await as(users.operator, 'SELECT * FROM chat_push_subscriptions')).rows.length, 1)
    await assert.rejects(as(users.operator, 'SELECT * FROM chat_push_jobs'), /permission denied/)
    await assert.rejects(as(users.operator, 'SELECT * FROM chat_push_claim()'), /permission denied/)
    await assert.rejects(register(users.viewer, subscription()), /Brak dostępu/)
    for (const endpoint of ['http://127.0.0.1/admin','https://fcm.googleapis.com.evil.test/send','https://fcm.googleapis.com:443/send','https://user@fcm.googleapis.com/send']) {
      await assert.rejects(register(users.operator, { ...own, endpoint }), /Nieprawidłowa/)
    }
    const [first] = await rpc(users.operator, 'chat_send', { p_recipient: users.manager.id, p_body: 'Poufna treść', p_request_id: randomUUID() })
    const jobs = (await db.query('SELECT * FROM chat_push_jobs')).rows
    assert.equal(jobs.length, 1); assert.equal(jobs[0].subscription_id, subId)
    await rpc(users.manager, 'chat_mark_read', { p_conversation: first.conversation_id, p_through_seq: first.seq })
    assert.equal((await as(null, 'SELECT * FROM chat_push_claim()', [], 'service_role')).rows.length, 0)
    await rpc(users.operator, 'chat_send', { p_recipient: users.manager.id, p_body: 'Druga', p_request_id: randomUUID() })
    // Reassigning the same browser does not send the previous account's queue.
    await register(users.syringe_operator, other)
    assert.equal((await as(null, 'SELECT * FROM chat_push_claim()', [], 'service_role')).rows.length, 0)
    await as(users.operator, 'SELECT chat_push_unregister($1)', [other.endpoint])
    assert.equal((await db.query('SELECT count(*) n FROM chat_push_subscriptions')).rows[0].n, 2)
    await as(users.syringe_operator, 'SELECT chat_push_unregister($1)', [other.endpoint])
    assert.equal((await db.query('SELECT count(*) n FROM chat_push_subscriptions')).rows[0].n, 1)
  } finally { await db.close() }
})

test('Push jobs lease once, retry transient failures and remove expired subscriptions', async () => {
  const { db, users, rpc, as } = await createMessengerDb()
  try {
    await db.exec('CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public, auth TO service_role;')
    await db.exec(sql)
    const sub = subscription()
    await as(users.manager, 'SELECT chat_push_register($1,$2,$3)', [sub.endpoint, sub.p256dh, sub.auth])
    const payload = { p_recipient: users.manager.id, p_body: 'Test', p_request_id: randomUUID() }
    await rpc(users.operator, 'chat_send', payload); await rpc(users.operator, 'chat_send', payload)
    const [job] = (await db.query('SELECT * FROM chat_push_claim()')).rows
    assert.ok(job.lease_token)
    assert.equal((await db.query('SELECT * FROM chat_push_claim()')).rows.length, 0)
    await db.query('SELECT chat_push_complete($1,$2,201)', [job.job_id, randomUUID()])
    assert.equal((await db.query('SELECT completed_at FROM chat_push_jobs')).rows[0].completed_at, null)
    await db.query('SELECT chat_push_complete($1,$2,503)', [job.job_id, job.lease_token])
    assert.equal((await db.query('SELECT * FROM chat_push_claim()')).rows.length, 0)
    await db.exec("UPDATE chat_push_jobs SET available_at=now()-interval '1 second'")
    const [retry] = (await db.query('SELECT * FROM chat_push_claim()')).rows
    assert.notEqual(retry.lease_token, job.lease_token)
    await db.query('SELECT chat_push_complete($1,$2,410)', [retry.job_id, retry.lease_token])
    assert.equal((await db.query('SELECT count(*) n FROM chat_push_subscriptions')).rows[0].n, 0)
    assert.equal((await db.query('SELECT count(*) n FROM chat_push_jobs')).rows[0].n, 0)
  } finally { await db.close() }
})

test('Delivery encrypts the payload, restricts destinations and does not follow redirects', async () => {
  const sub = subscription(), vapid = webpush.generateVAPIDKeys()
  const job = { ...sub, auth_key: sub.auth, recipient_id: randomUUID(), conversation_id: randomUUID(), sender_id: randomUUID() }
  let encrypted
  const status = await deliverPush(job, payload => {
    assert.equal(JSON.parse(payload).recipientId, job.recipient_id)
    encrypted = webpush.generateRequestDetails({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload,
      { vapidDetails: { ...vapid, subject: 'https://margoprod.vercel.app' }, TTL: 3600 })
    return encrypted
  }, async (url, options) => {
    assert.equal(url, sub.endpoint); assert.equal(options.redirect, 'error')
    assert.ok(options.headers.Authorization.startsWith('vapid '))
    assert.ok(options.body.length > 100)
    assert.ok(!Buffer.from(options.body).includes(Buffer.from(job.recipient_id)))
    return new Response(null, { status: 201 })
  })
  assert.equal(status, 201)
  for (const endpoint of ['https://localhost/send','http://fcm.googleapis.com/send','https://fcm.googleapis.com.evil.org/send','https://user:pass@fcm.googleapis.com/send']) assert.equal(allowedPushEndpoint(endpoint), false)
  assert.equal(await deliverPush({ ...job, endpoint: 'https://localhost/private' }, () => { throw new Error('must not encrypt') }), 410)
  assert.equal(await deliverPush(job, () => encrypted, async () => { throw new Error('network') }), 0)
})

test('Service worker displays generic push only for the opted-in owner and opens a safe chat URL', async () => {
  const handlers = {}, shown = [], opened = []
  const recipientId = randomUUID(), senderId = randomUUID(), conversationId = randomUUID()
  let owner = { enabled: true, userId: recipientId }
  vm.runInNewContext(sw, {
    self: { addEventListener: (name, fn) => { handlers[name] = fn }, location: { origin: 'https://margoprod.vercel.app' },
      registration: { showNotification: async (...args) => { shown.push(args) } },
      clients: { matchAll: async () => [], openWindow: async url => opened.push(url) } },
    caches: { open: async () => ({ match: async () => ({ json: async () => owner }) }), delete: async () => true }, URL,
  })
  async function event(name, data) {
    let work
    handlers[name]({ ...data, waitUntil: promise => { work = promise } })
    await work
  }
  await event('push', { data: { json: () => ({ type: 'chat-message', recipientId, senderId, conversationId }) } })
  assert.equal(shown.length, 1)
  assert.equal(shown[0][0], 'MargoLine — nowa wiadomość')
  await event('notificationclick', { notification: { tag: `chat-${conversationId}`, data: { recipientId, senderId }, close() {} } })
  assert.equal(new URL(opened[0]).searchParams.get('person'), senderId)
  owner = { enabled: true, userId: randomUUID() }
  await event('push', { data: { json: () => ({ type: 'chat-message', recipientId }) } })
  assert.equal(shown.length, 1)
  owner = null
  await event('push', { data: { json: () => ({ type: 'chat-message', recipientId }) } })
  assert.equal(shown.length, 1)
})
