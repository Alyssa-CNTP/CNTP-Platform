import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Unit tests are node-only: pure logic, no DOM, no network.
//
// This used to say anything touching a component belongs in Playwright instead.
// That was written assuming Playwright could run in CI. It cannot — the app
// signs in through Microsoft SSO, so every spec skips and the job proves nothing
// (ARCHITECTURE.md §8). Two kinds of component test therefore live here, and
// both stay node-only:
//
//   components/shared/FeatureBoundary.test.ts
//     The crash guard from §3. Its contract — a class with a static
//     getDerivedStateFromError, and what it renders once it has caught — is
//     checkable without a DOM, because React elements are plain objects.
//
//   components/production/capture/render-smoke.test.tsx
//     Renders each section component with renderToStaticMarkup, which runs the
//     render pass in plain node. It catches a component that THROWS while
//     rendering — the failure that used to blank the whole capture route. No
//     jsdom, no auth, no mocking: useEffect does not run during a server render,
//     so nothing reaches the database.
//
// Neither is an invitation to unit-test components generally, and neither
// replaces Playwright for anything involving effects, events or a real browser.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'lib/**/*.test.ts',
      'features/**/*.test.ts',
      'components/shared/*.test.ts',
      'components/production/capture/*.test.tsx',
    ],
    exclude: ['node_modules/**', '.next/**', '.claude/worktrees/**'],
  },
})
