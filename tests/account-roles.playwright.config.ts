import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  testDir: '.', testMatch: 'account-roles-ui.spec.ts', workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4181', channel: 'msedge', screenshot: 'only-on-failure' },
  outputDir: '../test-results/account-roles',
  webServer: { command: 'npx vite --config tests/messenger.vite.config.ts', cwd: fileURLToPath(new URL('..', import.meta.url)), url: 'http://127.0.0.1:4181/tests/account-roles.html', reuseExistingServer: false },
  projects: [{ name: 'tablet', use: { viewport: { width: 768, height: 1024 }, hasTouch: true } }],
})
