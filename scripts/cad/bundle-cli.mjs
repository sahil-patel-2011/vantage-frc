#!/usr/bin/env node
/**
 * Emit packages/vantage-cad-cli/dist for npm bin + tarball packaging.
 * Uses esbuild (available via workspace) to bundle the CLI entry.
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const pkgRoot = join(root, "packages", "vantage-cad-cli");
const outDir = join(pkgRoot, "dist");
const require = createRequire(import.meta.url);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

async function loadEsbuild() {
  try {
    return await import("esbuild");
  } catch {
    // tsx vendors esbuild — try nested path
    try {
      return require("esbuild");
    } catch {
      return null;
    }
  }
}

const esbuild = await loadEsbuild();
if (!esbuild) {
  // Fallback: thin re-export stub so bin can still use tsx path
  writeFileSync(
    join(outDir, "cli.js"),
    [
      "#!/usr/bin/env node",
      `await import(${JSON.stringify(pathToFileURL(join(pkgRoot, "src", "cli.ts")).href)});`,
      "",
    ].join("\n"),
    { encoding: "utf8" },
  );
  console.warn("esbuild not found — wrote tsx-delegating dist/cli.js stub");
  process.exit(0);
}

await esbuild.build({
  entryPoints: [join(pkgRoot, "src", "cli.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: join(outDir, "cli.js"),
  packages: "external",
  logLevel: "info",
});

console.log(`Bundled CLI → ${join(outDir, "cli.js")}`);
