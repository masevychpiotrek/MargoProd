import { test, expect, type Page } from '@playwright/test'

const id = '00000000-0000-0000-0000-000000000002'
const dual = { id, full_name: 'Jan Testowy', role: 'operator', operator_manager_access: true, is_active: true, deleted_at: null, must_change_password: false }

async function mockApi(page: Page, options: { initial?: Record<string, unknown>; signedOut?: boolean } = {}) {
  let profile = { ...dual, ...options.initial }
  let failSwitch = false
  const patches: unknown[] = []
  if (!options.signedOut) await page.addInitScript(profile => { (window as any).__roleProfile = profile }, profile)
  await page.route('http://127.0.0.1:4198/**', async route => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' }
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ headers, body: '' })
    const path = new URL(request.url()).pathname
    if (path.endsWith('/token') || path.endsWith('/verify')) {
      const payload = btoa(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 }))
      return route.fulfill({ headers, body: JSON.stringify({ access_token: `e30.${payload}.signature`, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user: { id, email: 'jan@example.com', aud: 'authenticated' } }) })
    }
    if (path.endsWith('/rfid-login')) return route.fulfill({ headers, body: JSON.stringify({ email: 'jan@example.com', token_hash: 'test-hash', full_name: profile.full_name }) })
    if (path.endsWith('/switch_operator_manager_role')) {
      if (failSwitch) return route.fulfill({ status: 403, headers, body: JSON.stringify({ message: 'Denied' }) })
      profile = { ...profile, role: request.postDataJSON().p_role }
      return route.fulfill({ headers, body: JSON.stringify(profile) })
    }
    if (path.endsWith('/profiles')) {
      if (request.method() === 'PATCH') {
        const patch = request.postDataJSON()
        patches.push(patch)
        profile = { ...profile, ...patch }
        return route.fulfill({ headers, body: '' })
      }
      return route.fulfill({ headers, body: JSON.stringify([profile]) })
    }
    return route.fulfill({ headers, body: '[]' })
  })
  return { fail: () => { failSwitch = true }, get patches() { return patches } }
}

test('dual account chooses a function, switches back and retains the choice on reload', async ({ page }, testInfo) => {
  await mockApi(page)
  await page.goto('/tests/account-roles.html?path=/manager')
  await expect(page.getByRole('heading', { name: 'Wybierz funkcję' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('choose-function.png') })
  await page.getByRole('button', { name: 'Kierownik', exact: false }).click()
  await expect(page.getByRole('heading', { name: 'Panel kierownika' })).toBeVisible()
  await page.getByRole('button', { name: 'Zmień funkcję' }).click()
  await page.getByRole('button', { name: 'Operator', exact: false }).click()
  await expect(page.getByRole('heading', { name: 'Panel operatora' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Panel operatora' })).toBeVisible()
})

test('failed server switch keeps the user on the function chooser', async ({ page }) => {
  const api = await mockApi(page)
  api.fail()
  await page.goto('/tests/account-roles.html')
  await page.getByRole('button', { name: 'Kierownik', exact: false }).click()
  await expect(page.getByRole('alert')).toContainText('Nie udało się zmienić funkcji')
  await expect(page.getByRole('heading', { name: 'Wybierz funkcję' })).toBeVisible()
})

test('single-role accounts cannot enter the manager panel', async ({ page }) => {
  await mockApi(page, { initial: { operator_manager_access: false } })
  await page.goto('/tests/account-roles.html?path=/manager')
  await expect(page.getByRole('heading', { name: 'Panel operatora' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Wybierz funkcję' })).toHaveCount(0)
})

test('password change is required before choosing a function', async ({ page }) => {
  await mockApi(page, { initial: { must_change_password: true } })
  await page.goto('/tests/account-roles.html')
  await expect(page.getByRole('heading', { name: 'Zmień hasło' })).toBeVisible()
})

test('administrator assigns and removes the second function', async ({ page }) => {
  const api = await mockApi(page, { initial: { role: 'admin', operator_manager_access: false } })
  await page.goto('/tests/account-roles.html?path=/admin/users')
  const select = page.getByRole('combobox', { name: 'Funkcje: Jan Testowy' })
  await select.selectOption('operator_manager')
  await expect(select).toHaveValue('operator_manager')
  expect(api.patches[0]).toEqual({ role: 'operator', operator_manager_access: true })
  await select.selectOption('operator')
  await expect(select).toHaveValue('operator')
  expect(api.patches[1]).toEqual({ role: 'operator', operator_manager_access: false })
})

for (const mode of ['password', 'rfid']) {
  test(`${mode} login leads to function selection`, async ({ page }) => {
    await mockApi(page, { signedOut: true })
    await page.goto('/tests/account-roles.html?path=/login')
    if (mode === 'password') {
      await page.getByPlaceholder('twoje.imie@margomed.pl').fill('jan@example.com')
      await page.locator('input[type=password]').fill('Password123')
      await page.getByRole('button', { name: 'Zaloguj sie' }).click()
    } else {
      await page.getByRole('button', { name: 'RFID', exact: true }).click()
      await page.keyboard.type('123456789')
      await page.keyboard.press('Enter')
    }
    await expect(page.getByRole('heading', { name: 'Wybierz funkcję' })).toBeVisible({ timeout: 15000 })
  })
}
