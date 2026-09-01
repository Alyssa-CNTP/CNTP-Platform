import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end regression guard for the capture flow (ARCHITECTURE.md §8).
 *
 * AUTH: the app signs in through Microsoft SSO, which is not automatable and
 * should not be scripted with stored credentials. These tests instead reuse a
 * browser storage state you create once yourself:
 *
 *   1. npx playwright open --save-storage=e2e/.auth/user.json http://localhost:3000
 *   2. Sign in normally in the window that opens, land on /home, then close it.
 *
 * e2e/.auth/ is gitignored — the file holds a live session token and must never
 * be committed. Specs skip themselves with a clear message when it is absent, so
 * a machine without it (including CI) reports "skipped", not "failed".
 *
 * Run against staging instead of a local server with:
 *   E2E_BASE_URL=https://cntpplatform-staging.rooibostea.co.za npm run test:e2e
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  // The capture flow is stateful — bags accumulate in a session — so specs must
  // not race each other against the same database.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Only start a local server when pointing at localhost; when E2E_BASE_URL is
  // set to staging we attach to what is already running there.
  webServer: baseURL.includes('localhost')
    ? {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      }
    : undefined,
})
