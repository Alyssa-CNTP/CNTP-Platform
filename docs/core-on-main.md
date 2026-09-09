# `lib/core` on `main` — what is wired, and what is not

`main` and `staging` are a **fork**, not a lead and a lag. `main` carries a large
number of capture fixes that `staging` has never had. `lib/core` was built on
`staging`, and every module in it was characterised against **staging's**
behaviour.

That is the whole reason this file exists. Copying a core module onto `main` is
safe. *Calling* it from `main`'s code is not automatically safe, because the
`main` behaviour it would replace may be the more correct one.

---

## Status

Everything under `lib/core/**` is **present and inert** unless listed as wired
below. Nothing in `app/`, `components/` or `lib/production/` imports it yet, so
the build output is unchanged by its arrival — that was the acceptance test for
the commit that added it.

| Module | On main | Notes |
|---|---|---|
| `num.ts` | inert | 13 copies of the same `n()` helper still live in `app/` and `components/` |
| `variants.ts` | inert | 4 copies of the family rule live in `lib/production/{scan-utils,validate-scan,bucket-elevator,capture-config}.ts` |
| `metrics.ts` | inert | |
| `mesh.ts` · `product-names.ts` | inert | |
| `types/capture.ts` | inert | `SECTION_KIND`, `sectionKindFor`, `assertNever` |
| `types/capture-data.ts` | inert | structural declarations of the shapes core reads |
| `mass-balance/**` | inert | **see the tolerance note below** |
| `serials.ts` | inert | superset of `capture-config.ts`'s `makeSerial`, which is byte-equivalent |
| `capture-rows/**` | inert | **the dangerous one — see below** |
| `changeover.ts` | inert | `main` removed the changeover button; not applicable until it returns |
| `labels/**` | inert | the pasteuriser label feature does not exist on `main` at all |

## Two things to read before wiring anything

### `capture-rows/` was characterised against staging's capture page

`buildDebag` and `buildBag` were extracted from **staging's**
`app/(app)/production/capture/[section]/page.tsx` and pinned by 33
characterisation tests written against it. `main`'s capture page is a different
file with a different history.

Rewiring `main`'s `persist()` to call these would silently adopt staging's
behaviour wherever the two disagree — and some of what it would overwrite are
hotfixes for data loss. Before that swap: characterise `main`'s builders first,
diff the two, and decide which behaviour survives, per row of the diff. It is
not a drop-in.

### There are two mass-balance tolerance regimes on `main` right now

- `lib/production/capture-config.ts` — `MASS_BALANCE_TOLERANCE_KG = 15`, with a
  100 kg special case for `refining2`.
- `app/(app)/production/orders/[id]/page.tsx` — `MASS_BALANCE_TOLERANCE_PCT = 0.01`.

So the capture screen and the production order can disagree about whether the
same shift is in tolerance. `lib/core/mass-balance/tolerance.ts` is the single
±1%-of-input rule that resolves it (ARCHITECTURE.md §5 explains why a flat kg
figure cannot work across a 200 kg trial and a 4 t shift). Adopting it is a
**behaviour change on production** — it will flag runs that used to pass and
pass runs that used to flag — so it needs to be its own change, announced, not a
side effect of tidying.

## The order to wire them in

Cheapest and safest first, each one its own PR with the duplicates deleted in
the same commit so the copy cannot come back:

1. `num.ts` — 13 identical copies, pure, no behaviour to change.
2. `variants.ts` — 4 copies that already disagree. This is what let a production
   order drop 5 950 kg of input on 2026-09-07: the order page compared variant
   strings instead of families, so `RA-Conventional` counted as a different pool
   from `Conventional`.
3. `types/capture.ts` — dispatch on the section kind instead of duck-typing.
4. `mass-balance/**` — announced, as above.
5. `capture-rows/**` — only after the diff described above.

## Running the gates

```bash
npm run test              # vitest over lib/core/** (472), then the hooks gate
npm run lint:boundaries   # lib/core may not import features/ or app/
npx tsc --noEmit          # ratchet — baseline 32, see .github/workflows/ci.yml
```

`npm run test` chains `posttest → lint:hooks`, which is the React error #310
gate. The first thing it found on `main` was a real one: `useCallback` sitting
*below* the non-admin early return in `app/(app)/admin/inventory-import/page.tsx`,
so the hook count went 6 → 7 the moment `useAuth()` resolved the role. The page
crashed for the only people allowed to open it. Fixed in the same commit that
added the gate, because the gate cannot be a gate while it is red.

## What is deliberately NOT here

`features/`, `e2e/`, `playwright.config.ts` and `@playwright/test` stayed on
`staging`.

- `features/**` is mounted by the capture page, and `main`'s capture page is the
  forked one. Bringing the features across is the rewiring work, not this.
- The Playwright suite needs a saved browser session — SSO cannot be scripted —
  so on `main` it would skip every spec and report a green tick proving nothing.
