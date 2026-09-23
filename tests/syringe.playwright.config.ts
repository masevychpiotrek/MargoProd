import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: '.', testMatch: 'syringe-ui.spec.ts', fullyParallel: false, workers: 1,
  timeout: 180000, expect: { timeout: 15000 },
  use: { actionTimeout: 15000, baseURL: 'http://127.0.0.1:4179', channel: 'msedge', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  outputDir: '../test-results/syringe',
  webServer: { timeout: 180000, command: 'npx vite --config tests/syringe.vite.config.ts', cwd: fileURLToPath(new URL('..', import.meta.url)), url: 'http://127.0.0.1:4179/tests/syringe.html', reuseExistingServer: false },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } }
  ]
})
