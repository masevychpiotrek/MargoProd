import { test, expect, type Page } from '@playwright/test'
// @ts-ignore — isolated PostgreSQL fixture shared with Node tests
import { createMessengerDb } from './messenger-db.mjs'

test('Two users: delivery retry, conversation switching, reply, unread badge and read receipt', async ({ page, context }, testInfo) => {
  const { db, users, rpc, as } = await createMessengerDb()
  let queue = Promise.resolve()
  const serial = (fn: () => Promise<any>) => {
    const result = queue.then(fn)
    queue = result.then(() => undefined, () => undefined)
    return result
  }
  let loseResponse = true
  const errors: string[] = []
  async function connect(target: Page, actor: any) {
    target.on('pageerror', e => errors.push(e.message))
    await target.addInitScript(profile => { (window as any).__chatProfile = profile }, actor)
    await target.route('http://127.0.0.1:4198/rest/v1/**', route => serial(async () => {
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers })
      const url = new URL(route.request().url())
      try {
        const name = url.pathname.split('/').pop()!
        if (url.pathname.includes('/rpc/')) {
          const args = route.request().postDataJSON() ?? {}
          const result = await rpc(actor, name, args)
          if (name === 'chat_send' && loseResponse) {
            loseResponse = false
            return route.fulfill({ status: 503, headers, body: JSON.stringify({ message: 'Połączenie przerwane po zapisie.' }) })
          }
          return route.fulfill({ status: 200, headers, body: JSON.stringify(name === 'chat_mark_read' ? null : result) })
        }
        if (name !== 'chat_messages') throw new Error('Unexpected table')
        const conversation = url.searchParams.get('conversation_id')!.replace('eq.', '')
        const before = url.searchParams.get('seq')?.replace('lt.', '')
        const result = await as(actor, `SELECT * FROM chat_messages WHERE conversation_id=$1 ${before ? 'AND seq<$2' : ''} ORDER BY seq DESC LIMIT 50`, before ? [conversation, Number(before)] : [conversation])
        return route.fulfill({ status: 200, headers, body: JSON.stringify(result.rows) })
      } catch (error: any) {
        return route.fulfill({ status: 400, headers, body: JSON.stringify({ message: error.message }) })
      }
    }))
    await target.goto('/tests/messenger.html')
  }
  const replyPage = await context.newPage()
  try {
    await connect(page, users.operator)
    await page.getByRole('button', { name: 'Nowa rozmowa', exact: true }).first().click()
    await page.getByRole('textbox', { name: 'Szukaj osoby' }).fill('strzykawki')
    await page.getByRole('button', { name: /Piotr Strzykawki/ }).click()
    await page.getByRole('textbox', { name: 'Treść wiadomości' }).fill('Czy możesz sprawdzić linię 5 ml?')
    await page.getByRole('button', { name: 'Wyślij wiadomość' }).click()
    await expect(page.getByRole('alert')).toContainText('Połączenie przerwane')
    await expect(page.getByRole('textbox', { name: 'Treść wiadomości' })).toHaveValue('Czy możesz sprawdzić linię 5 ml?')
    // Switching away must preserve the request ID as well as the text.
    if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Wróć do rozmów' }).click()
    await page.getByRole('button', { name: 'Nowa rozmowa', exact: true }).first().click()
    await page.getByRole('button', { name: /Maria Kierownik/ }).click()
    if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Wróć do rozmów' }).click()
    await page.getByRole('button', { name: 'Nowa rozmowa', exact: true }).first().click()
    await page.getByRole('button', { name: /Piotr Strzykawki/ }).click()
    await page.getByRole('button', { name: 'Wyślij wiadomość' }).click()
    await expect(page.getByRole('textbox', { name: 'Treść wiadomości' })).toHaveValue('')
    await expect(page.getByRole('log').getByText('Czy możesz sprawdzić linię 5 ml?', { exact: true })).toHaveCount(1)
    expect((await serial(() => db.query('SELECT count(*) n FROM chat_messages'))).rows[0].n).toBe(1)

    await connect(replyPage, users.syringe_operator)
    await expect(replyPage.getByRole('link', { name: 'Wiadomości, 1 nieprzeczytanych', exact: true })).toBeVisible()
    await replyPage.getByRole('button', { name: /Anna Operator/ }).click()
    await expect(replyPage.getByRole('log').getByText('Czy możesz sprawdzić linię 5 ml?', { exact: true })).toBeVisible()
    await expect(replyPage.getByRole('link', { name: 'Wiadomości', exact: true })).toBeVisible()
    await replyPage.getByRole('textbox', { name: 'Treść wiadomości' }).fill('Tak, już podchodzę.\nSprawdzę podajnik.')
    await replyPage.getByRole('button', { name: 'Wyślij wiadomość' }).click()
    await expect(replyPage.getByRole('log').getByText('Tak, już podchodzę.', { exact: false })).toBeVisible()
    await page.bringToFront()
    await expect(page.getByRole('log').getByText('Tak, już podchodzę.', { exact: false })).toBeVisible()
    await expect(page.getByText('Odczytano', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('messenger.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
  } finally { await replyPage.close(); await queue; await db.close() }
})

test('A missing migration shows an actionable error and supports retry', async ({ page }) => {
  let missing = true
  await page.addInitScript(() => { (window as any).__chatProfile = { id: 'operator-test', full_name: 'Anna Operator', role: 'operator' } })
  await page.route('http://127.0.0.1:4198/rest/v1/**', async route => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers })
    return route.fulfill({ status: missing ? 404 : 200, headers, body: JSON.stringify(missing ? { code: 'PGRST202', message: 'Function missing' } : []) })
  })
  await page.goto('/tests/messenger.html')
  await expect(page.getByRole('alert')).toContainText('Komunikator nie został jeszcze uruchomiony')
  missing = false
  await page.getByRole('button', { name: 'Spróbuj ponownie' }).click()
  await expect(page.getByText('Tu pojawią się Twoje rozmowy.')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
