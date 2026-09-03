import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Unit tests are node-only: pure logic, no DOM, no network. Anything that needs a
// browser belongs in the Playwright suite instead (ARCHITECTURE.md §8).
//
// components/** is included for ONE thing: FeatureBoundary, the crash guard from
// §3. Its contract — that it is a class with a static
// getDerivedStateFromError, and what it renders once it has caught — is checkable
// without a DOM, because React elements are plain objects. This is not an
// invitation to unit-test components generally; those go to Playwright.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'features/**/*.test.ts', 'components/shared/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', '.claude/worktrees/**'],
  },
})
