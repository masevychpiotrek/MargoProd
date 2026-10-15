import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: '.', testMatch: 'tablet-view-ui.spec.ts', workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4181', channel: 'msedge', hasTouch: true, screenshot: 'only-on-failure' },
  outputDir: '../test-results/tablet-view',
  webServer: { command: 'npx vite --config tests/messenger.vite.config.ts', cwd: fileURLToPath(new URL('..', import.meta.url)), url: 'http://127.0.0.1:4181/tests/tablet-view.html', reuseExistingServer: false },
  projects: [
    { name: 'tablet-portrait', use: { viewport: { width: 768, height: 1024 } } },
    { name: 'tablet-landscape', use: { viewport: { width: 1024, height: 768 } } },
  ],
})
