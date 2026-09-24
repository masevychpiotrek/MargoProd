import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createMessengerDb } from './messenger-db.mjs'

test('Private conversations, role boundaries, safe contacts and no direct writes', async () => {
  const { db, users, as, rpc } = await createMessengerDb()
  try {
    const contacts = await rpc(users.operator, 'chat_contacts')
    assert.equal(contacts.length, 5)
    assert.deepEqual(Object.keys(contacts[0]).sort(), ['full_name', 'id', 'role'])
    assert.ok(contacts.some(p => p.id === users.admin.id))
    const [message] = await rpc(users.operator, 'chat_send', { p_recipient: users.manager.id, p_body: 'Proszę podejść do linii 2 ml.', p_request_id: randomUUID() })
    assert.equal((await as(users.manager, 'SELECT * FROM chat_messages')).rows.length, 1)
    for (const observer of [users.syringe_operator, users.admin, users.viewer]) {
      assert.equal((await as(observer, 'SELECT * FROM chat_messages')).rows.length, 0)
      assert.equal((await as(observer, 'SELECT * FROM chat_conversations')).rows.length, 0)
    }
    await assert.rejects(rpc(users.admin, 'chat_mark_read', { p_conversation: message.conversation_id, p_through_seq: message.seq }), /Brak dostępu/)
    await assert.rejects(as(users.operator, 'UPDATE chat_messages SET body=$1 WHERE id=$2', ['Sfałszowana', message.id]), /permission denied/)
    await assert.rejects(as(users.operator, 'UPDATE chat_conversations SET read_high_seq=999'), /permission denied/)
    await assert.rejects(as(users.operator, 'DELETE FROM chat_messages'), /permission denied/)
    await assert.rejects(as(users.operator, 'INSERT INTO chat_messages(conversation_id,sender_id,request_id,body) VALUES($1,$2,$3,$4)', [message.conversation_id, users.manager.id, randomUUID(), 'Podszycie']), /permission denied/)
    await assert.rejects(rpc(users.viewer, 'chat_contacts'), /Brak dostępu/)
    await assert.rejects(rpc(null, 'chat_inbox'), /Brak dostępu/)
    await assert.rejects(as(null, 'SELECT * FROM chat_contacts()', [], 'anon'), /permission denied/)
    await db.query('UPDATE profiles SET is_active=false WHERE id=$1', [users.operator.id])
    assert.equal((await as(users.operator, 'SELECT * FROM chat_messages')).rows.length, 0)
    await assert.rejects(rpc(users.operator, 'chat_send', { p_recipient: users.manager.id, p_body: 'Nie', p_request_id: randomUUID() }), /Brak dostępu/)
    assert.equal((await rpc(users.manager, 'chat_inbox'))[0].can_send, false)
  } finally { await db.close() }
})

test('Delivery retry, reverse replies, unread counts and monotonic read receipts', async () => {
  const { db, users, rpc } = await createMessengerDb()
  try {
    const payload = { p_recipient: users.syringe_operator.id, p_body: '  Pierwsza wiadomość  ', p_request_id: randomUUID() }
    const [first] = await rpc(users.operator, 'chat_send', payload)
    assert.deepEqual(await rpc(users.operator, 'chat_send', payload), [first])
    await assert.rejects(rpc(users.operator, 'chat_send', { ...payload, p_body: 'Inna' }), /już użyty/)
    await assert.rejects(rpc(users.operator, 'chat_send', { ...payload, p_recipient: users.admin.id }), /już użyty/)
    const [second] = await rpc(users.operator, 'chat_send', { ...payload, p_body: 'Druga', p_request_id: randomUUID() })
    assert.equal((await rpc(users.syringe_operator, 'chat_inbox'))[0].unread_count, 2)
    await rpc(users.syringe_operator, 'chat_mark_read', { p_conversation: first.conversation_id, p_through_seq: first.seq })
    assert.equal((await rpc(users.syringe_operator, 'chat_inbox'))[0].unread_count, 1)
    await rpc(users.syringe_operator, 'chat_mark_read', { p_conversation: first.conversation_id, p_through_seq: second.seq })
    await rpc(users.syringe_operator, 'chat_mark_read', { p_conversation: first.conversation_id, p_through_seq: first.seq })
    assert.equal((await rpc(users.syringe_operator, 'chat_inbox'))[0].unread_count, 0)
    assert.equal((await rpc(users.operator, 'chat_inbox'))[0].other_read_seq, second.seq)
    await assert.rejects(rpc(users.syringe_operator, 'chat_mark_read', { p_conversation: first.conversation_id, p_through_seq: 99999 }), /Nieprawidłowe/)
    const [reply] = await rpc(users.syringe_operator, 'chat_send', { p_recipient: users.operator.id, p_body: 'Odpowiedź', p_request_id: randomUUID() })
    assert.equal(reply.conversation_id, first.conversation_id)
    assert.equal((await rpc(users.operator, 'chat_inbox'))[0].unread_count, 1)
    assert.equal((await db.query('SELECT count(*) n FROM chat_conversations')).rows[0].n, 1)
    assert.equal((await db.query('SELECT count(*) n FROM chat_messages')).rows[0].n, 3)
  } finally { await db.close() }
})

test('Message validation, inactive recipients and cursor pagination without gaps', async () => {
  const { db, users, rpc, as } = await createMessengerDb()
  try {
    const payload = { p_recipient: users.admin.id, p_body: 'Dzień dobry', p_request_id: randomUUID() }
    for (const body of ['', '   ', '\n\t\r ', 'x'.repeat(4001), null]) await assert.rejects(rpc(users.operator, 'chat_send', { ...payload, p_body: body }), /4000 znaków/)
    for (const recipient of [users.operator.id, users.viewer.id, randomUUID(), null]) await assert.rejects(rpc(users.operator, 'chat_send', { ...payload, p_recipient: recipient }))
    await assert.rejects(rpc(users.operator, 'chat_send', { ...payload, p_request_id: null }), /identyfikatora/)
    await db.query('UPDATE profiles SET deleted_at=now() WHERE id=$1', [users.manager.id])
    await assert.rejects(rpc(users.operator, 'chat_send', { ...payload, p_recipient: users.manager.id }), /niedostępna|nie jest dostępna/)
    let latest
    for (let i = 0; i < 55; i++) [latest] = await rpc(users.operator, 'chat_send', { ...payload, p_body: `Wiadomość ${i}`, p_request_id: randomUUID() })
    const page1 = (await as(users.admin, 'SELECT * FROM chat_messages WHERE conversation_id=$1 ORDER BY seq DESC LIMIT 50', [latest.conversation_id])).rows
    await rpc(users.operator, 'chat_send', { ...payload, p_body: 'Nowa w trakcie czytania', p_request_id: randomUUID() })
    const page2 = (await as(users.admin, 'SELECT * FROM chat_messages WHERE conversation_id=$1 AND seq<$2 ORDER BY seq DESC LIMIT 50', [latest.conversation_id, page1.at(-1).seq])).rows
    assert.equal(page2.length, 5)
    assert.equal(new Set([...page1, ...page2].map(m => m.seq)).size, 55)
  } finally { await db.close() }
})
