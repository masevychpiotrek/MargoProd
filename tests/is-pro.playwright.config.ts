import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  testDir: '.', testMatch: 'is-pro-ui.spec.ts', workers: 1,
  timeout: 60000, expect: { timeout: 10000 },
  use: { baseURL: 'http://127.0.0.1:4179', channel: 'msedge', screenshot: 'only-on-failure' },
  outputDir: '../test-results/is-pro',
  webServer: { command: 'npx vite --config tests/syringe.vite.config.ts', cwd: fileURLToPath(new URL('..', import.meta.url)), url: 'http://127.0.0.1:4179/tests/is-pro.html', reuseExistingServer: false, timeout: 120000 },
  projects: [{ name: 'desktop', use: { viewport: { width: 1280, height: 900 } } }, { name: 'mobile', use: { viewport: { width: 390, height: 844 } } }]
})
