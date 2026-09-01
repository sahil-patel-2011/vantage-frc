import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "strip-cli-shebang-for-tests",
      enforce: "pre",
      transform(code, id) {
        if (!id.endsWith(".mjs") || !code.startsWith("#!")) return null;
        return { code: code.replace(/^#![^\r\n]*(?:\r?\n|$)/, ""), map: null };
      },
    },
  ],
  // The repo's tsconfig sets `jsx: "preserve"` for Next's own SWC/babel transform.
  // Vite (v8, via its Oxc transformer) reads that same tsconfig by default and,
  // seeing "preserve", leaves JSX untransformed — which the bundler's import-
  // analysis parser cannot read. A small handful of component tests render shared
  // `components/ui/*.tsx` primitives via `react-dom/server`; this override lets
  // Oxc transform their JSX for the test run only, without touching the shared
  // Next-facing tsconfig.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "dist/**"]
  }
});
