import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/release/**",
      "playwright-report/**",
      "test-results/**",
      // Agent worktrees are full duplicate checkouts living inside this repo.
      // Left in, each one adds a second tsconfig at a second root, and
      // typescript-eslint refuses the whole run with "multiple candidate
      // TSConfigRootDirs are present" — `npm run lint` reports thousands of
      // parse errors on files that are not what is committed here. Same trap
      // the vitest config had.
      "**/.claude/worktrees/**",
      "**/.freebuff/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Register the plugins so inline eslint-disable comments naming their
    // rules resolve. Deliberately no rules enabled here: spreading the
    // recommended rule sets would surface a fresh wave of errors at sites
    // that carry no disable comment.
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
  },
  {
    files: ["packages/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["apps/*", "**/apps/**"],
              message: "Domain packages must not import apps/web. Put UI in the composition root.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/**/app/**/*.{ts,tsx}", "apps/**/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@vantage/db/admin",
              message:
                "dbAdmin is worker-only and must never enter request paths.",
            },
            {
              name: "@vantage/reference/admin-store",
              message:
                "Reference writes are worker-only and must never enter request paths.",
            },
            {
              name: "@vantage/reference/production-worker",
              message:
                "Reference workers are privileged and must never enter request paths.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "apps/web/lib/dashboard/**/*.{ts,tsx}",
      "apps/web/lib/offline/**/*.{ts,tsx}",
      "apps/web/lib/drive/**/*.{ts,tsx}",
      "apps/web/lib/workspace/**/*.{ts,tsx}",
      "apps/web/lib/account/**/*.{ts,tsx}",
      "apps/web/lib/invite/**/*.{ts,tsx}",
      "apps/web/lib/connectors/**/*.{ts,tsx}",
      "apps/web/lib/onboarding/**/*.{ts,tsx}",
      "apps/web/lib/help/**/*.{ts,tsx}",
      "apps/web/lib/bugbot/**/*.{ts,tsx}",
      "apps/web/lib/business/**/*.{ts,tsx}",
      "apps/web/lib/cad-vault/**/*.{ts,tsx}",
      "apps/web/lib/packing.ts",
      "apps/web/lib/season-calendar.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/lib/scouting/**", "**/lib/messages/**", "**/lib/pit/**", "**/lib/hours/**"],
              message: "This feature folder may not import another feature's internals. Put shared helpers in lib/ui, lib/nav, or a package.",
            },
          ],
        },
      ],
    },
  },
);
