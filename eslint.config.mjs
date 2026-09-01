import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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

  // ── Core / Feature boundary (ARCHITECTURE.md §2) ────────────────────────────
  // lib/core is the shared foundation all five capture sections depend on. It
  // must stay pure and feature-agnostic: if core can reach into a feature, a
  // change to that feature can break every section at once, which is the exact
  // failure this boundary exists to stop.
  //
  // Note `npm run build` runs with DISABLE_ESLINT_PLUGIN=true, so the build
  // will NOT catch a violation here. CI runs `npm run lint` separately.
  {
    files: ["lib/core/**/*.ts", "lib/core/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["@/features/*", "@/features", "**/features/*"],
            message:
              "lib/core must not import from features/. Core never knows a feature exists — features import core. See ARCHITECTURE.md §2.",
          },
          {
            group: ["@/app/*", "**/app/*"],
            message:
              "lib/core must not import from app/. Core is pure logic with no route or page coupling. See ARCHITECTURE.md §2.",
          },
          {
            group: ["react", "react-dom", "next/*"],
            message:
              "lib/core is pure logic — no React, no Next. Put the component in features/ or components/ and have it call core. See ARCHITECTURE.md §2.",
          },
          {
            group: ["@/lib/supabase/*", "**/lib/supabase/*"],
            message:
              "lib/core must not perform I/O. Take the data as an argument so the function stays pure and unit-testable. Exception: lib/core/ledger, which owns ledger access.",
          },
        ],
      }],
    },
  },

  // lib/core/ledger is the one part of core that owns database access, so it is
  // exempt from the no-I/O rule above (but not from the feature/app rules).
  {
    files: ["lib/core/ledger/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["@/features/*", "@/features", "**/features/*"],
            message:
              "lib/core must not import from features/. See ARCHITECTURE.md §2.",
          },
          {
            group: ["react", "react-dom"],
            message: "lib/core is pure logic — no React. See ARCHITECTURE.md §2.",
          },
        ],
      }],
    },
  },

  // Playwright fixtures take a callback named `use`, which the React hooks rule
  // mistakes for a hook call. There is no React in e2e/ at all.
  {
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },

  // A feature is self-contained: other code imports it through its index.ts and
  // nothing else. Deep-importing another feature's internals recreates the
  // tangle this structure removes.
  {
    files: ["features/**/*.ts", "features/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["@/features/*/*", "../*/components/*", "../*/actions"],
            message:
              "Import another feature through its index.ts only — its internals are private. See ARCHITECTURE.md §3.",
          },
        ],
      }],
    },
  },
]);

export default eslintConfig;
