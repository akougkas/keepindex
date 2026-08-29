import { defineConfig, devices } from '@playwright/test'

const requestedPort = process.env.KEEPINDEX_E2E_PORT ?? '5174'
if (!/^\d+$/.test(requestedPort) || Number(requestedPort) < 1024 || Number(requestedPort) > 65535) {
  throw new Error('KEEPINDEX_E2E_PORT must be an integer from 1024 through 65535')
}
const baseURL = `http://127.0.0.1:${requestedPort}`

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${requestedPort} --strictPort`,
    url: baseURL,
    // scripts/test-e2e.sh starts and owns the only server eligible for reuse.
    reuseExistingServer: true,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 1_000 },
  },
  timeout: 30_000,
})
