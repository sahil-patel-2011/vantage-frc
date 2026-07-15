import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      "**/dist/**",
      "playwright-report/**",
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
