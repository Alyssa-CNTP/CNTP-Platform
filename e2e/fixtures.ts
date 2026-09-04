import fs from 'node:fs'
import path from 'node:path'
import { test as base, expect } from '@playwright/test'

/**
 * Shared fixture: an authenticated page.
 *
 * The app signs in through Microsoft SSO. Rather than scripting credentials
 * (which should never live in a repo or a CI secret used this way), these tests
 * reuse a storage state you capture once by signing in yourself — see the
 * comment at the top of playwright.config.ts for the one-line command.
 *
 * When that file is absent the specs SKIP with an explanatory message instead of
 * failing, so a fresh clone reports honestly rather than going red for a missing
 * local artefact.
 *
 * ── The skip must not be able to lie ────────────────────────────────────────
 *
 * A skip is the right answer on a developer's machine and the WRONG answer in
 * CI: every spec would skip, the job would go green, and the green tick would
 * prove nothing at all. That is why the Playwright suite is deliberately not in
 * ci.yml today (see the note at the bottom of that file).
 *
 * So `requireAuthState()` turns the skip into a hard failure whenever CI is set.
 * If anyone wires this suite into a pipeline before a session artefact is
 * available, they get a red build that names what is missing, instead of a
 * silent pass. Set E2E_ALLOW_SKIP=1 to opt out deliberately.
 */
export const AUTH_STATE = path.join(process.cwd(), 'e2e', '.auth', 'user.json')

export const hasAuthState = () => fs.existsSync(AUTH_STATE)

export const SKIP_REASON =
  'No saved session at e2e/.auth/user.json. Create one with: ' +
  'npx playwright open --save-storage=e2e/.auth/user.json http://localhost:3000 ' +
  '(sign in, reach /home, close the window). See playwright.config.ts.'

/**
 * Call from a spec's beforeEach. Skips locally, fails in CI.
 * Returns true when the suite may run.
 */
export function requireAuthState(testApi: { skip: (cond: boolean, reason: string) => void }): void {
  if (hasAuthState()) return
  const inCI = !!process.env.CI && process.env.E2E_ALLOW_SKIP !== '1'
  if (inCI) {
    throw new Error(
      'E2E ran in CI with no saved session, so every spec would have skipped and the ' +
      'job would have passed without testing anything. ' + SKIP_REASON +
      ' To allow skipping here on purpose, set E2E_ALLOW_SKIP=1.',
    )
  }
  testApi.skip(true, SKIP_REASON)
}

export const test = base.extend({
  storageState: async ({}, use) => {
    await use(hasAuthState() ? AUTH_STATE : undefined)
  },
})

export { expect }
