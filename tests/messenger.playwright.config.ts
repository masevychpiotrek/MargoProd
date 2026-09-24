import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: '.', testMatch: 'messenger-ui.spec.ts', workers: 1,
  timeout: 120000, expect: { timeout: 30000 },
  use: { baseURL: 'http://127.0.0.1:4181', channel: 'msedge', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  outputDir: '../test-results/messenger',
  webServer: { timeout: 120000, command: 'npx vite --config tests/messenger.vite.config.ts', cwd: fileURLToPath(new URL('..', import.meta.url)), url: 'http://127.0.0.1:4181/tests/messenger.html', reuseExistingServer: false },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
})
