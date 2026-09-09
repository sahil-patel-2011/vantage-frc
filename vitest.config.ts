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
    // Every pattern here has to start with `**/`. Vitest REPLACES its default
    // exclude list when you set this key, and a bare `node_modules/**` is
    // anchored at the repo root — so `apps/web/node_modules`, and every agent
    // worktree under `.claude/worktrees/*/node_modules`, were all being
    // scanned. That is where "27 failed" in a clean checkout came from: they
    // are pg-protocol, tsconfig-paths and zod's own test suites, which have
    // nothing to do with this repo and cannot pass under our config. It also
    // pulled ~45,000 foreign tests into `npm test`.
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      // Agent worktrees are whole duplicate checkouts of this repo. Running
      // their copy of our tests would double every run and report failures
      // against code that is not what is committed here.
      "**/.claude/worktrees/**",
      "**/.freebuff/**",
    ],
  }
});
