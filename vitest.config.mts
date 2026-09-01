import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Unit tests cover lib/core/** — pure logic, no DOM, no network. Anything that
// needs a browser belongs in the Playwright suite instead (ARCHITECTURE.md §8).
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'features/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', '.claude/worktrees/**'],
  },
})
