import { test, expect } from '@playwright/test'
import { createSyringeDb } from './syringe-db.mjs'

test('start, two entries, downtime, handover and next shift from zero', async ({ page }, testInfo) => {
  const { db, ids, command } = await createSyringeDb()
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  let rejectNext = false
  let loseNextResponse = false
  const apiErrors: string[] = []
  await page.addInitScript(profile => { (window as any).__syringeProfile = profile }, { id: ids.operator, role: 'syringe_operator', full_name: 'Operator Testowy', is_active: true })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === 'http://127.0.0.1:4179') return route.continue()
    if (url.origin !== 'http://127.0.0.1:4199') return route.abort()
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers })
    try {
      if (url.pathname.endsWith('/rpc/sa_session_command')) {
        if (rejectNext) { rejectNext = false; return route.fulfill({ status: 500, headers, body: JSON.stringify({ message: 'Test: chwilowy brak połączenia' }) }) }
        const body = route.request().postDataJSON()
        const result = await command(body.p_action, body.p_payload)
        if (loseNextResponse) { loseNextResponse = false; return route.abort('failed') }
        return route.fulfill({ status: 200, headers, body: JSON.stringify(result) })
      }
      const table = url.pathname.split('/').pop()!
      if (!/^sa_[a-z_]+$/.test(table)) return route.fulfill({ status: 200, headers, body: '[]' })
      let rows = (await db.query(`SELECT * FROM ${table}`)).rows as any[]
      const sessions = (await db.query('SELECT * FROM sa_sessions')).rows as any[]
      const machines = (await db.query('SELECT * FROM sa_machines')).rows as any[]
      const assortments = (await db.query('SELECT * FROM sa_assortments')).rows as any[]
      const entries = (await db.query('SELECT * FROM sa_production_entries')).rows as any[]
      const defects = (await db.query('SELECT * FROM sa_defect_categories')).rows as any[]
      const downtime = (await db.query('SELECT * FROM sa_downtime_categories')).rows as any[]
      const normalize = (r: any) => r ? { ...r, session_date: r.session_date instanceof Date ? r.session_date.toISOString().slice(0, 10) : r.session_date } : r
      const enrich = (r: any) => ({ ...normalize(r), machine: machines.find(m => m.id === r.machine_id), assortment: assortments.find(a => a.id === r.assortment_id),
        from_assortment: assortments.find(a => a.id === r.from_assortment_id), to_assortment: assortments.find(a => a.id === r.to_assortment_id), order: null })
      rows = rows.map(r => ({ ...enrich(r), session: normalize(sessions.find(s => s.id === r.session_id)),
        entry: entries.find(e => e.id === r.entry_id), category: [...defects, ...downtime].find(c => c.id === r.category_id) }))
      if (table === 'sa_production_entries') {
        const allocations = (await db.query('SELECT * FROM sa_defect_entries')).rows as any[]
        rows = rows.map(r => ({ ...r, defect_entries: allocations.filter(d => d.entry_id === r.id) }))
      }
      for (const [key, filter] of url.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(key)) continue
        const [op, ...rest] = filter.split('.')
        const value = rest.join('.')
        const read = (r: any) => key.split('.').reduce((o, k) => o?.[k], r)
        if (op === 'eq') rows = rows.filter(r => String(read(r)) === value)
        else if (op === 'is' && value === 'null') rows = rows.filter(r => read(r) == null)
        else if (op === 'gte') rows = rows.filter(r => String(read(r)) >= value)
        else if (op === 'lte') rows = rows.filter(r => String(read(r)) <= value)
        else if (op === 'in') rows = rows.filter(r => value.slice(1, -1).split(',').includes(String(read(r))))
      }
      for (const order of (url.searchParams.get('order') ?? '').split(',').reverse()) {
        if (!order) continue
        const [key, direction] = order.split('.')
        rows.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (direction === 'desc' ? -1 : 1))
      }
      rows = rows.slice(Number(url.searchParams.get('offset') || 0), Number(url.searchParams.get('offset') || 0) + Number(url.searchParams.get('limit') || 10000))
      const single = route.request().headers().accept?.includes('vnd.pgrst.object')
      return route.fulfill({ status: 200, headers, body: JSON.stringify(single ? rows[0] ?? null : rows) })
    } catch (e: any) {
      apiErrors.push(e.message)
      return route.fulfill({ status: 400, headers, body: JSON.stringify({ message: e.message }) })
    }
  })
  const go = (path: string) => page.goto('/tests/syringe.html#/syringe' + path)
  try {
    await go('/start')
    await page.getByRole('button', { name: /Linia testowa 1/ }).click()
    await page.getByRole('button', { name: /^Strzykawka 2 ml/ }).click()
    await page.getByRole('button', { name: 'Zmiana I', exact: true }).click()
    await page.getByRole('spinbutton').fill('10000')
    await page.getByRole('button', { name: 'Rozpocznij zmianę', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Linia testowa 1' })).toBeVisible()
    await page.getByRole('button', { name: /Wpisz produkcję/ }).click()
    await page.getByLabel('Licznik druku', { exact: true }).fill('1000')
    await page.getByLabel('Licznik montażu', { exact: true }).fill('950')
    await page.getByRole('button', { name: 'Zapisz produkcję' }).click()
    await expect(page.getByText(/Rozlicz braki na kategorie/)).toBeVisible()
    await page.getByRole('button', { name: '+ Nieprawidłowy nadruk', exact: true }).click()
    rejectNext = true
    await page.getByRole('button', { name: 'Zapisz produkcję' }).click()
    await expect(page.getByText('Test: chwilowy brak połączenia', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Zapisz produkcję' }).click()
    await expect(page.getByRole('heading', { name: 'Linia testowa 1' })).toBeVisible()
    await page.getByRole('button', { name: /Wpisz produkcję/ }).click()
    await expect(page.getByText('Poprzedni wpis', { exact: true })).toBeVisible()
    await page.getByLabel('Licznik druku', { exact: true }).fill('2000')
    await page.getByLabel('Licznik montażu', { exact: true }).fill('1900')
    await page.getByRole('button', { name: '+ Nieprawidłowy nadruk', exact: true }).click()
    loseNextResponse = true
    await page.getByRole('button', { name: 'Zapisz produkcję' }).click()
    await expect(page.getByText(/Failed to fetch|NetworkError|Load failed/)).toBeVisible()
    await page.getByRole('button', { name: 'Zapisz produkcję' }).click()
    await expect(page.getByRole('heading', { name: 'Linia testowa 1' })).toBeVisible()
    let session = (await db.query('SELECT * FROM sa_sessions')).rows[0] as any
    expect(session.total_good).toBe(1900); expect(session.total_reject).toBe(100); expect(Number(session.plan_pct)).toBe(19)
    expect((await db.query('SELECT count(*) n FROM sa_production_entries')).rows[0].n).toBe(2)
    await page.getByRole('button', { name: 'Popraw ostatni wpis' }).click()
    await expect(page.getByLabel('Licznik montażu', { exact: true })).toHaveValue('1900')
    await page.getByLabel('Licznik montażu', { exact: true }).fill('1920')
    await page.getByPlaceholder('Ilość', { exact: true }).fill('30')
    await page.getByLabel('Powód korekty', { exact: true }).fill('Poprawa odczytu')
    await page.getByRole('button', { name: 'Zapisz korektę' }).click()
    await expect(page.getByRole('heading', { name: 'Linia testowa 1' })).toBeVisible()
    expect((await db.query('SELECT total_good FROM sa_sessions')).rows[0].total_good).toBe(1920)
    await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true })
    await page.getByRole('button', { name: /Rozpocznij przestój/ }).click()
    await page.getByRole('button', { name: 'Awaria mechaniczna', exact: true }).click()
    await page.getByRole('button', { name: 'Rozpocznij przestój', exact: true }).click()
    await expect(page.getByText('Aktywny przestój', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Tak, usunięto' }).click()
    await page.getByRole('button', { name: 'Zakończ przestój', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Linia testowa 1' })).toBeVisible()
    await page.getByRole('button', { name: /Przekaż zmianę i zakończ/ }).click()
    await page.getByLabel('Końcowy licznik druku').fill('2000')
    await page.getByLabel('Końcowy licznik montażu').fill('1920')
    await page.getByRole('button', { name: /Zakończ zmianę/ }).click()
    await expect(page.getByRole('heading', { name: 'Zmiana zakończona' })).toBeVisible()
    session = (await db.query('SELECT * FROM sa_sessions')).rows[0] as any
    expect(session.ended_at).not.toBeNull(); expect(session.total_good).toBe(1920)
    await page.getByRole('button', { name: 'Nowa zmiana' }).click()
    await page.getByRole('button', { name: 'Zmiana II', exact: true }).click()
    await page.getByRole('button', { name: /Linia testowa 1/ }).click()
    await page.getByRole('button', { name: /^Strzykawka 2 ml/ }).click()
    await page.getByRole('button', { name: 'Rozpocznij zmianę', exact: true }).click()
    await page.getByRole('button', { name: /Wpisz produkcję/ }).click()
    await page.getByLabel('Licznik druku', { exact: true }).fill('100')
    await page.getByLabel('Licznik montażu', { exact: true }).fill('100')
    await page.getByRole('button', { name: 'Zapisz produkcję' }).click()
    await expect(page.getByRole('heading', { name: 'Linia testowa 1' })).toBeVisible()
    expect((await db.query('SELECT total_good FROM sa_sessions WHERE ended_at IS NULL')).rows[0].total_good).toBe(100)
    await go('/components')
    await page.getByPlaceholder('np. Korpus 5ml PP').fill('Korpus testowy')
    await page.getByPlaceholder('0', { exact: true }).fill('100')
    await page.getByRole('button', { name: 'Zapisz komponent' }).click()
    await expect(page.getByText('Korpus testowy', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Zakończ użycie' }).click()
    await expect(page.getByRole('button', { name: 'Zakończ użycie' })).toHaveCount(0)
    await go('/changeover')
    await page.getByRole('button', { name: /^Strzykawka 5 ml/ }).click()
    await page.getByPlaceholder('np. 123456', { exact: true }).fill('100')
    await page.getByRole('button', { name: 'Rozpocznij przezbrojenie' }).click()
    await expect(page.getByText('Przezbrojenie w toku', { exact: true })).toBeVisible()
    for (const checkbox of await page.getByRole('checkbox').all()) {
      await checkbox.click()
      await expect(checkbox).toBeChecked()
    }
    await page.getByRole('button', { name: 'Zakończ przezbrojenie i uruchom produkcję' }).click()
    await expect(page.getByRole('heading', { name: 'Linia testowa 1' })).toBeVisible()
    expect((await db.query('SELECT assortment_id FROM sa_sessions WHERE ended_at IS NULL')).rows[0].assortment_id).toBe(ids.assortment2)
    await go('/quality')
    await page.getByPlaceholder(/Dokładny opis wykrytej niezgodności/).fill('Nieprawidłowy nadruk w partii testowej')
    await page.getByPlaceholder('np. 500', { exact: true }).fill('10')
    await page.getByRole('button', { name: 'Wyślij zgłoszenie' }).click()
    await expect(page.getByRole('heading', { name: 'Problem zgłoszony' })).toBeVisible()
    expect((await db.query('SELECT count(*) n FROM sa_quality_issues')).rows[0].n).toBe(1)
    await go('/failure')
    await page.getByPlaceholder(/Opisz dokładnie, co się dzieje/).fill('Zacięcie podajnika na linii testowej')
    await page.getByRole('button', { name: 'Wyślij zgłoszenie' }).click()
    await expect(page.getByRole('heading', { name: 'Zgłoszenie wysłane' })).toBeVisible()
    expect((await db.query('SELECT count(*) n FROM sa_failure_reports')).rows[0].n).toBe(1)
    await go('/reports')
    await expect(page.getByText('Braki wg kategorii', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'CSV', exact: true })).toBeEnabled()
    await page.getByRole('combobox').selectOption('I')
    await expect(page.getByRole('button', { name: 'CSV', exact: true })).toBeEnabled()
    await expect(page.getByText('Sztuki dobre', { exact: true }).locator('..')).toContainText('1920')
    await expect(page.getByText('Braki wg kategorii', { exact: true }).locator('..')).toContainText('80 szt')
    await page.screenshot({ path: testInfo.outputPath('report.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([]); expect(apiErrors).toEqual([])
  } finally { await db.close() }
})
