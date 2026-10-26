import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import { workerImportAllowlist } from "./scripts/security-boundary-allowlist.mjs";
import {
  allowlistedImportRule,
  FEATURE_BOUNDARY_PATTERNS,
  PACKAGE_APP_PATTERNS,
  REQUEST_IMPORT_PATHS,
  SUPABASE_IMPORT_PATTERNS,
  vantageSecurityPlugin,
} from "./scripts/security-boundaries.mjs";

export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "apps/web/app/.well-known/workflow/**",
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
      // Leftover volume kits: cloned compute.ts + board.tsx trees. The named
      // CI failure is unused formatTier / lovatExactWin under win-kit; lovat-kit
      // and agent-kit are the same leftover clones. Ignore the trees — do not
      // mass-edit them. Same class of skip as worktrees.
      "**/win-kit/**",
      "**/lovat-kit/**",
      "**/agent-kit/**",
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
    // The GUI audit scripts pass functions to page.evaluate(), which run inside the browser.
    files: ["scripts/gui-*.mjs", "scripts/lib/**/*.mjs", "scripts/start-gui-audit.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Register the plugins so inline eslint-disable comments naming their
    // rules resolve. The recommended sets stay off — spreading them would
    // surface a fresh wave of errors at sites that carry no disable comment.
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: {
      // The one exception, because this rule does not report style — it
      // reports a crash. `ToolStrip` called two hooks after an early return
      // on an empty tool list, so a hub whose tools arrive with its data
      // would render empty once and then throw "rendered more hooks than
      // during the previous render" on the next pass. Nothing flagged it.
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: ["packages/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: REQUEST_IMPORT_PATHS,
          patterns: [...PACKAGE_APP_PATTERNS, ...SUPABASE_IMPORT_PATTERNS],
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
          paths: REQUEST_IMPORT_PATHS,
          patterns: SUPABASE_IMPORT_PATTERNS,
        },
      ],
    },
  },
  {
    // Route handlers and server components live under app/. The modules they
    // call live in lib/ and components/, and the session gate is proxy.ts.
    // The worker-role ban has to cover those too, or a route can import() the
    // worker from a helper the app/ glob never sees.
    files: [
      "apps/web/lib/**/*.{ts,tsx}",
      "apps/web/components/**/*.{ts,tsx}",
      "apps/web/proxy.ts",
      "apps/web/middleware.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: REQUEST_IMPORT_PATHS,
          patterns: SUPABASE_IMPORT_PATTERNS,
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.{js,mjs,cjs,ts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: REQUEST_IMPORT_PATHS,
          patterns: SUPABASE_IMPORT_PATTERNS,
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
          paths: REQUEST_IMPORT_PATHS,
          patterns: [...FEATURE_BOUNDARY_PATTERNS, ...SUPABASE_IMPORT_PATTERNS],
        },
      ],
    },
  },
  {
    // import() is a different AST node from a static import. The rule reads
    // the allowlist itself, so a cron file can keep the worker import it names.
    files: [
      "apps/**/*.{ts,tsx,js,mjs}",
      "packages/**/*.{ts,tsx,js,mjs}",
      "scripts/**/*.{js,mjs,cjs,ts}",
    ],
    plugins: { vantage: vantageSecurityPlugin },
    rules: { "vantage/no-dynamic-worker-import": "error" },
  },
  // Last, so it wins over the bans above. Each file may import only the
  // worker specifiers its allowlist row names. Supabase stays banned.
  ...workerImportAllowlist.map((entry) => ({
    files: [entry.file],
    rules: {
      "no-restricted-imports": allowlistedImportRule(entry),
    },
  })),
);
