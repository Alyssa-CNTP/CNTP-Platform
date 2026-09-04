import { test, expect, requireAuthState } from './fixtures'

/**
 * Regression guard for the operator capture screen (ARCHITECTURE.md §8).
 *
 * This is deliberately shallow and stable: it asserts the screen loads, its tabs
 * are present, and nothing threw during render. Its job is to catch the failure
 * mode this whole rework exists to prevent — a change in one section taking
 * another section's screen down — not to re-test business logic that the vitest
 * suite covers far faster.
 */

const SECTIONS = ['sieving', 'refining1', 'refining2', 'granule', 'blender', 'pasteuriser']

test.beforeEach(() => {
  requireAuthState(test)
})

for (const section of SECTIONS) {
  test(`${section}: capture screen loads with its tabs intact`, async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', e => consoleErrors.push(String(e)))

    await page.goto(`/production/capture/${section}`)

    // Not bounced by the route guard.
    await expect(page).toHaveURL(new RegExp(`/production/capture/${section}`))

    // The tab strip is the skeleton of the screen — if a section's data shape
    // breaks the shared page, this is what disappears.
    for (const label of ['Checks', 'Capture', 'Cleaning', 'Overview', 'Sign-off']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }

    // The Overview tab is where the section union is duck-typed today, so it is
    // the most likely place for one section's change to surface as another
    // section's crash. Visit it explicitly rather than trusting the default tab.
    await page.getByText('Overview', { exact: true }).first().click()
    await expect(page.getByText('Overview', { exact: true }).first()).toBeVisible()

    // A React render crash surfaces here even when the page looks passable.
    const fatal = consoleErrors.filter(e =>
      /Cannot read|is not a function|undefined is not|Minified React error/i.test(e))
    expect(fatal, `console errors on ${section}: ${fatal.join(' | ')}`).toHaveLength(0)
  })
}
