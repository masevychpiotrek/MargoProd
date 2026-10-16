import { test, expect } from '@playwright/test'

test('operator closes A, sees elapsed changeover time, and starts B from zero', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  const assortments = [{ id: 'a', name: 'Produkt A' }, { id: 'b', name: 'Produkt B' }]
  const segments: any[] = [{ id: 'seg-a', shift_id: 's1', assortment_id: 'a', started_at: '2026-10-16T04:00:00Z', ended_at: null, final_good: null, final_reject: null, assortment: assortments[0] }]
  const changes: any[] = []
  const reports: any[] = [{ id: 'r1', segment_id: 'seg-a', good_count: 4560, reject_count: 0 }]
  await page.route('http://127.0.0.1:4199/**', async route => {
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ headers, body: '' })
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/rpc/is_pro_command')) {
      const body = route.request().postDataJSON()
      if (body.p_action === 'changeover') {
        segments[0].ended_at = new Date().toISOString(); segments[0].final_good = body.p_good; segments[0].final_reject = body.p_reject
        reports.push({ id: 'tail', segment_id: 'seg-a', good_count: body.p_good - 4560, reject_count: body.p_reject })
        changes.push({ id: 'c1', started_at: new Date(Date.now() - 18000).toISOString(), ended_at: null })
      } else {
        changes[0].ended_at = new Date().toISOString()
        segments.push({ id: 'seg-b', shift_id: 's1', assortment_id: 'b', started_at: new Date().toISOString(), ended_at: null, final_good: null, final_reject: null, assortment: assortments[1] })
      }
      return route.fulfill({ headers, body: JSON.stringify(segments[segments.length - 1].id) })
    }
    const rows = path.endsWith('/is_pro_segments') ? segments : path.endsWith('/is_pro_changeovers') ? changes : path.endsWith('/assortments') ? assortments : reports
    return route.fulfill({ headers, body: JSON.stringify(rows) })
  })
  await page.goto('/tests/is-pro.html')
  await page.getByRole('button', { name: 'Rozpocznij przezbrojenie', exact: true }).click()
  await page.getByLabel('Dobre sztuki — licznik końcowy').fill('5100')
  await page.getByRole('button', { name: 'Zapisz wynik i rozpocznij przezbrojenie' }).click()
  await expect(page.getByText('Przezbrojenie w toku', { exact: true })).toBeVisible()
  await expect(page.getByText(/Czas: 00:00:/)).toBeVisible()
  await expect(page.getByRole('row', { name: 'Produkt A 5100 0' })).toBeVisible()
  await page.getByLabel('Nowy asortyment').selectOption('b')
  await expect(page.getByRole('button', { name: 'Rozpocznij produkcję' })).toBeDisabled()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Rozpocznij produkcję' }).click()
  await expect(page.getByText('Produkt B', { exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: 'Produkt B · teraz 0 0' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('is-pro-production.png'), fullPage: true })
})

