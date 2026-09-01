import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { boundaryRules } from "./eslint.boundaries.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees are full copies of the repo. Linting them multiplies
    // every finding by the number of worktrees and hides the real ones.
    ".claude/worktrees/**",
  ]),

  // Playwright fixtures take a callback named `use`, which the React hooks rule
  // mistakes for a hook call. There is no React in e2e/ at all.
  {
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },

  // ── Core / Feature boundary (ARCHITECTURE.md §2) ────────────────────────────
  // Defined in eslint.boundaries.mjs so the same rules can be run on their own
  // as a fast, blocking CI gate — `npm run lint:boundaries`. A full lint of this
  // repo currently reports ~3000 pre-existing errors, so it cannot be the gate
  // that protects the architecture without the real finding being lost in them.
  ...boundaryRules,
]);

export default eslintConfig;
