import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveExtensionBrowser } from "./extension-resources";
import { runOnshapeUiMcp } from "./runtime";

// The release helper places this entry at <extension>/server/index.mjs.
// No legacy CLI dispatcher, shell command, installer or Onshape API is imported.
try {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  await runOnshapeUiMcp("https://cad.onshape.com/documents", { resolveBrowser: () => resolveExtensionBrowser(root) });
} catch (error) {
  process.stderr.write(`Vantage CAD setup: ${error instanceof Error ? error.message : "The connector could not start."}\nSee GETTING-STARTED.md in the approved extension.\n`);
  process.exitCode = 1;
}
