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
);
