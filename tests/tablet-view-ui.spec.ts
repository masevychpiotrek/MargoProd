import { test, expect } from '@playwright/test'

test('keyboard keeps the entry row and save button visible on tablets', async ({ page }, testInfo) => {
  await page.goto('/tests/tablet-view.html')
  const field = page.getByLabel('Numer serii drenu')
  await expect(field).not.toBeFocused()
  await expect(page.locator('.app-toolbar')).toBeVisible()
  await field.fill('16380422')
  // Simulate Safari: the keyboard reduces only the visual viewport.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, get: () => window.innerHeight - 350 })
    window.visualViewport!.dispatchEvent(new Event('resize'))
  })
  await expect(page.locator('html')).toHaveAttribute('data-touch-editing', '')
  await expect(page.locator('.app-toolbar')).toBeHidden()
  await expect(page.locator('.app-assistant')).toBeHidden()
  await expect.poll(async () => {
    const rect = await page.locator('[data-input-context]').boundingBox()
    return !!rect && rect.y >= 0 && rect.y + rect.height <= page.viewportSize()!.height - 350
  }).toBe(true)
  expect(await field.evaluate(element => getComputedStyle(element).fontSize)).toBe('16px')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('keyboard-open.png') })
  await field.evaluate(element => element.blur())
  await expect(page.locator('.app-toolbar')).toBeVisible()
  await expect(field).toHaveValue('16380422')
})

test('fullscreen button can enter and leave fullscreen', async ({ page }) => {
  await page.goto('/tests/tablet-view.html')
  const supported = await page.evaluate(() => document.fullscreenEnabled)
  test.skip(!supported, 'Fullscreen is unavailable in this browser')
  await page.getByRole('button', { name: 'Pełny ekran', exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  await page.getByRole('button', { name: 'Wyłącz pełny ekran' }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false)
})
