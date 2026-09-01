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
 * failing, so a fresh clone and CI both report honestly rather than going red for
 * a missing local artefact.
 */
export const AUTH_STATE = path.join(process.cwd(), 'e2e', '.auth', 'user.json')

export const hasAuthState = () => fs.existsSync(AUTH_STATE)

export const SKIP_REASON =
  'No saved session at e2e/.auth/user.json. Create one with: ' +
  'npx playwright open --save-storage=e2e/.auth/user.json http://localhost:3000 ' +
  '(sign in, reach /home, close the window). See playwright.config.ts.'

export const test = base.extend({
  storageState: async ({}, use) => {
    await use(hasAuthState() ? AUTH_STATE : undefined)
  },
})

export { expect }
