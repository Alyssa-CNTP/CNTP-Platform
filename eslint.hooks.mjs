/**
 * The Rules of Hooks, on their own, as a blocking gate.
 *
 *     npm run lint:hooks
 *
 * ── Why this is a separate config, like eslint.boundaries.mjs ───────────────
 *
 * `react-hooks/rules-of-hooks` is already on — it arrives with
 * eslint-config-next and is wired into eslint.config.mjs. It was on when this
 * shipped to staging on 2026-09-01:
 *
 *     app/(app)/production/capture/[section]/page.tsx
 *     1810:26  error  React Hook "useMemo" is called conditionally. React Hooks
 *     must be called in the exact same order in every component render. Did you
 *     accidentally call a React Hook after an early return?
 *
 * It reported the defect precisely, and it changed nothing, because the full
 * lint is a RATCHET in CI — it fails only when the total rises above a baseline
 * of roughly 3,000 pre-existing errors. One more error in three thousand does
 * not move a baseline anyone reads, so the capture screen went down with
 * "This page couldn't load" for every section that had an assignment, and
 * stayed down for two days.
 *
 * A ratchet is the right shape for stylistic debt being paid off slowly. It is
 * the wrong shape for a rule whose violations are page-killers: hooks called
 * conditionally do not degrade a screen, they white-screen it, and an operator
 * mid-shift loses a half-captured session. So this rule gets what the
 * Core/Feature boundary already has — its own config, its own script, and a
 * hard zero in CI.
 *
 * The repo is at zero violations as of 2026-09-03. Keep it there.
 */
import reactHooks from 'eslint-plugin-react-hooks'
import tsParser from '@typescript-eslint/parser'

export default [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      // Agent worktrees are full copies of the repo; linting them multiplies
      // every finding by the number of worktrees.
      '.claude/**',
      // Playwright fixtures take a callback named `use`, which the rule reads as
      // a hook call. There is no React in e2e/ at all — the same exemption
      // eslint.config.mjs already makes.
      'e2e/**',
      'playwright.config.ts',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    linterOptions: {
      // Inline comments cannot weaken this gate. Two reasons: source files carry
      // `eslint-disable` comments naming rules this standalone config does not
      // load, which ESLint reports as errors and would make the gate fail on
      // noise; and Rules of Hooks has no legitimate per-line exception, so a
      // `// eslint-disable-next-line react-hooks/rules-of-hooks` should not be
      // able to put a page-killer back.
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'off',
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Only this one. Not exhaustive-deps — that one has real false positives
      // and a large existing backlog, and bundling it here would make this gate
      // unpassable and therefore ignored, which is how we got here.
      'react-hooks/rules-of-hooks': 'error',
    },
  },
]
