import { test, expect } from '@playwright/test'
test('Combined history filters by module, machine and operator; exports and reports fetch errors', async ({ page }, testInfo) => {
  const tables: Record<string, unknown[]> = {
    machines: [{ id: 'm1', name: 'IS PRO 1' }], sa_machines: [{ id: 'm1', name: 'ST 50' }],
    shifts: [{ id: 's1', machine_id: 'm1', shift_date: '2026-10-05', shift_type: 'I', started_at: '2026-10-05T04:00:00Z', ended_at: '2026-10-05T12:00:00Z', operator_1_id: 'a', operator_2_id: 'b', operator_1: { full_name: 'Anna Kowalska' }, operator_2: { full_name: 'Bartek Nowak' } }],
    hourly_reports: [{ id: 'r1', shift_id: 's1', machine_id: 'm1', operator_id: 'a', report_date: '2026-10-05', good_count: 100, reject_count: 5, runtime_min: 40, downtime_min: 20, operator: { full_name: 'Anna Kowalska' } }],
    sa_sessions: [{ id: 'sa1', machine_id: 'm1', operator_id: 'a', session_date: '2026-10-05', shift_type: 'II', started_at: '2026-10-05T12:00:00Z', ended_at: null, total_good: 300, total_reject: 15, total_runtime_min: 120, total_downtime_min: 30, operator: { full_name: 'Anna Kowalska' }, assortment: { name: 'Strzykawka 50/60 ml' } }],
  }
  let fail = false
  await page.route('http://127.0.0.1:4198/**', async route => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ headers, body: '' })
    const name = new URL(route.request().url()).pathname.split('/').pop()!
    return route.fulfill({ status: fail && name === 'sa_sessions' ? 403 : 200, headers, body: JSON.stringify(fail && name === 'sa_sessions' ? { message: 'Brak dostępu testowego' } : tables[name] ?? []) })
  })
  await page.goto('/tests/operator-work.html')
  const history = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Kto, kiedy i na jakiej maszynie pracował' }) })
  await expect(history.locator('tbody tr')).toHaveCount(3)
  await expect(history).toContainText('ST 50')
  await expect(history).toContainText('Brak wpisów')
  await page.screenshot({ path: testInfo.outputPath('operator-work.png'), fullPage: true })
  await page.getByRole('combobox', { name: 'Moduł', exact: true }).selectOption('Automaty strzykawkowe')
  await expect(history.locator('tbody tr')).toHaveCount(1)
  await page.getByRole('combobox', { name: 'Maszyna', exact: true }).selectOption('sa:m1')
  await expect(history).toContainText('300')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Eksport CSV' }).click()
  expect((await downloadPromise).suggestedFilename()).toMatch(/^operatorzy-/)
  await page.getByRole('button', { name: 'Wyczyść filtry' }).click()
  await page.getByRole('combobox', { name: 'Operator', exact: true }).selectOption('b')
  await expect(history).toContainText('Bartek Nowak')
  await expect(history).not.toContainText('Anna Kowalska')
  fail = true
  await page.getByRole('button', { name: 'Odśwież', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Nie udało się pobrać pełnego wykazu')
  await expect(page.getByRole('button', { name: 'Eksport CSV' })).toBeDisabled()
})
