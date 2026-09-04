import { test, expect, requireAuthState, AUTH_STATE } from './fixtures'

/**
 * THE ACCEPTANCE TEST for the read-modify-write fix.
 *
 * This reproduces the incident that cost 44% of the Fine/Coarse Leaf bags and,
 * on another day, emptied Sieving Tower's bagging rows entirely: two people with
 * the same capture session open, both saving. The save path resolves this by
 * deleting the session's rows and re-inserting from its own in-memory copy, so
 * whichever tab saves last erases the other's bags. `bag_no` is allocated the
 * same way — read the held numbers, pick the free ones — which races too.
 *
 * It is marked `fixme` because it is EXPECTED TO FAIL against the current save
 * path. That is the point: it is the definition of done for the ledger cutover
 * (plan Phase 7). Playwright reports it as expected-to-fail rather than green,
 * so it neither breaks CI nor pretends the bug is fixed.
 *
 * DO NOT delete or skip this to make a run clean. Remove the `.fixme` only when
 * per-row upsert on a stable id has replaced the delete-then-insert, and it
 * passes for real. See ARCHITECTURE.md §8.
 *
 * Before removing `.fixme`, fill in the three selector-dependent steps marked
 * below against the real capture DOM — they are intentionally left explicit
 * rather than guessed, so this test never silently asserts the wrong thing.
 */

const SECTION = 'sieving'

test.describe('concurrent save on one session', () => {
  test.beforeEach(() => {
    requireAuthState(test)
  })

  test.fixme('two operators saving the same session both keep their bags', async ({ browser }) => {
    // Two genuinely independent sessions — separate contexts, not two tabs
    // sharing one, so neither shares in-memory state with the other.
    const a = await browser.newContext({ storageState: AUTH_STATE })
    const b = await browser.newContext({ storageState: AUTH_STATE })
    const pageA = await a.newPage()
    const pageB = await b.newPage()

    try {
      await pageA.goto(`/production/capture/${SECTION}`)
      await pageB.goto(`/production/capture/${SECTION}`)

      for (const p of [pageA, pageB]) {
        await p.getByText('Capture', { exact: true }).first().click()
      }

      // STEP 1 — add a distinctly-weighted bag in each context.
      //   const bagA = await addBag(pageA, { kg: '11.1' })
      //   const bagB = await addBag(pageB, { kg: '22.2' })

      // STEP 2 — force both saves to overlap. The autosave debounce is 2.5s with
      // a 20s interval, so triggering both explicitly and close together is what
      // reproduces the race; waiting for autosave makes this flaky.
      //   await Promise.all([save(pageA), save(pageB)])

      // STEP 3 — reload BOTH and assert each bag survived. Today the later save
      // wins and one of these is gone, which is the failure this test exists to
      // capture.
      //   await pageA.reload()
      //   await expect(pageA.getByText(bagA)).toBeVisible()
      //   await expect(pageA.getByText(bagB)).toBeVisible()

      expect(true, 'selector steps above must be completed before un-fixme-ing').toBe(false)
    } finally {
      await a.close()
      await b.close()
    }
  })
})
