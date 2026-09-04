/**
 * The Core/Feature import boundary (ARCHITECTURE.md §2).
 *
 * Defined here on its own, and imported by eslint.config.mjs, so it can also be
 * run in isolation:
 *
 *     npm run lint:boundaries
 *
 * That matters because the repo currently has ~3000 pre-existing lint errors
 * (mostly no-explicit-any). A full `npm run lint` cannot be a blocking CI gate
 * without being red permanently, and the one rule that protects the
 * architecture would be buried in the noise. Running these rules alone is fast,
 * clean, and can therefore actually fail a build.
 *
 * Rules live in one place so the two entry points can never drift apart.
 */

import tsParser from '@typescript-eslint/parser'

const CORE_FORBIDDEN = [
  {
    group: ['@/features/*', '@/features', '**/features/*'],
    message:
      'lib/core must not import from features/. Core never knows a feature exists — features import core. See ARCHITECTURE.md §2.',
  },
  {
    group: ['@/app/*', '**/app/*'],
    message:
      'lib/core must not import from app/. Core is pure logic with no route or page coupling. See ARCHITECTURE.md §2.',
  },
  {
    group: ['react', 'react-dom', 'next/*'],
    message:
      'lib/core is pure logic — no React, no Next. Put the component in features/ or components/ and have it call core. See ARCHITECTURE.md §2.',
  },
  {
    group: ['@/lib/supabase/*', '**/lib/supabase/*'],
    message:
      'lib/core must not perform I/O. Take the data as an argument so the function stays pure and unit-testable. Exception: lib/core/ledger, which owns ledger access.',
  },
  {
    // Added 2026-09-04. This rule listed features/, app/, React/Next and
    // lib/supabase/ but NOT components/ — so lib/core/capture-rows importing
    // its five section data types from the capture components was legal by the
    // letter of the rule and against every word of ARCHITECTURE.md §2. Core was
    // already through the gap.
    //
    // `import type` is caught too, deliberately. It is erased at runtime, so it
    // looks free, but it makes core's contract depend on a 'use client' React
    // component parsing — and it is what stopped lib/core being liftable to
    // another branch on its own.
    //
    // If core needs a shape a component owns, DECLARE THE SHAPE core reads, as
    // lib/core/types/capture-data.ts and mass-balance/sieving.ts both do, and
    // pin it with a Conforms<> alias on the components side.
    group: ['@/components/*', '@/components', '**/components/*'],
    message:
      'lib/core must not import from components/. Declare the shape core reads in lib/core/types/ and assert conformance from the component side — see lib/core/types/capture-data.ts. This applies to `import type` as well: an erased import still couples core to a client component. See ARCHITECTURE.md §2.',
  },
]

// lib/core/ledger is the one part of core that owns database access, so it is
// exempt from the no-I/O rule — but not from the feature/app/React rules.
const LEDGER_FORBIDDEN = CORE_FORBIDDEN.filter(
  r => !r.group.some(g => g.includes('supabase')) && !r.group.includes('next/*'),
)

const FEATURE_FORBIDDEN = [
  {
    group: ['@/features/*/*', '../*/components/*', '../*/actions'],
    message:
      "Import another feature through its index.ts only — its internals are private. See ARCHITECTURE.md §3.",
  },
]

export const boundaryRules = [
  {
    files: ['lib/core/**/*.ts', 'lib/core/**/*.tsx'],
    rules: { 'no-restricted-imports': ['error', { patterns: CORE_FORBIDDEN }] },
  },
  {
    files: ['lib/core/ledger/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: LEDGER_FORBIDDEN }] },
  },
  {
    files: ['features/**/*.ts', 'features/**/*.tsx'],
    rules: { 'no-restricted-imports': ['error', { patterns: FEATURE_FORBIDDEN }] },
  },
]

// Standalone config: ONLY the boundary rules, nothing inherited from Next.
// The TypeScript parser is wired in explicitly because nothing else here brings
// one, and without it every .ts file fails to parse. It is available
// transitively via eslint-config-next.
export default [
  { ignores: ['node_modules/**', '.next/**', '.claude/**'] },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  },
  ...boundaryRules,
]
