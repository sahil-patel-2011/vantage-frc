#!/usr/bin/env node
/** Source-only release recipe. Run only in an authorized release environment.
 * Consumes already provisioned desktop browser resources. Never installs,
 * downloads, invokes a shell, starts the connector or changes client settings.
 */
import { cp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNativeTarget, assertRelocatableTree } from "./packaging-resources.mjs";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (!["darwin", "win32"].includes(process.platform)) throw new Error("Stage the extension on its authorized target macOS or Windows release host.");
const target = `${process.platform}-${process.arch}`;
const resources = join(root, "apps", "desktop", "resources", "onshape-ui", target);
const metadata = JSON.parse(await readFile(join(resources, "manifest.json"), "utf8"));
if (metadata.version !== 1 || metadata.platform !== process.platform || metadata.arch !== process.arch ||
    typeof metadata.browserExecutable !== "string" || isAbsolute(metadata.browserExecutable) ||
    metadata.browserExecutable.split(/[\\/]/).includes("..") ||
    !/^browser[/\\]/.test(metadata.browserExecutable)) throw new Error("Matching staged browser resources are required.");
const actualResources = await realpath(resources);
const executable = await realpath(resolve(actualResources, metadata.browserExecutable));
const relativeExecutable = relative(actualResources, executable);
if (!relativeExecutable || relativeExecutable.startsWith("..") || isAbsolute(relativeExecutable) || !(await stat(executable)).isFile()) throw new Error("The staged browser executable is missing or outside its release resources.");
const playwrightPackage = JSON.parse(await readFile(join(resources, "node_modules", "playwright", "package.json"), "utf8"));
const corePackage = JSON.parse(await readFile(join(resources, "node_modules", "playwright-core", "package.json"), "utf8"));
if (playwrightPackage.version !== metadata.playwrightVersion || corePackage.version !== metadata.playwrightVersion) throw new Error("The staged browser and Playwright package versions must match.");
await assertNativeTarget(executable, process.platform, process.arch);
await assertRelocatableTree(join(resources, "browser"));
await assertRelocatableTree(join(resources, "node_modules"));

// Resolve and inspect native credential support before replacing any staged
// extension. A package.json without its compiled adapter is not a working vault.
const keytarArg = process.argv.indexOf("--keytar-dir");
if (keytarArg >= 0 && !process.argv[keytarArg + 1]) throw new Error("--keytar-dir requires an already provisioned target keytar package directory.");
let keytarRoot;
if (keytarArg >= 0) keytarRoot = await realpath(resolve(process.argv[keytarArg + 1]));
else {
  try { keytarRoot = dirname(require.resolve("keytar/package.json")); }
  catch (error) { if (error?.code !== "MODULE_NOT_FOUND") throw error; }
}
if (process.platform === "win32" && !keytarRoot) throw new Error("Windows MCPB requires an already provisioned native keytar adapter; provide --keytar-dir. Nothing was installed.");
if (keytarRoot) {
  const keytarPackage = JSON.parse(await readFile(join(keytarRoot, "package.json"), "utf8"));
  if (keytarPackage.name !== "keytar" || keytarPackage.main !== "./lib/keytar.js") throw new Error("Use the approved native keytar package layout.");
  if (!(await stat(join(keytarRoot, "lib", "keytar.js"))).isFile()) throw new Error("The keytar loader is missing.");
  await assertNativeTarget(join(keytarRoot, "build", "Release", "keytar.node"), process.platform, process.arch);
  await assertRelocatableTree(keytarRoot);
}

const esbuild = await import("esbuild");
const source = join(root, "packages", "vantage-cad-cli");
const template = JSON.parse(await readFile(join(source, "mcpb", "manifest.json"), "utf8"));
if (!Array.isArray(template.privacy_policies) || !template.privacy_policies.length) throw new Error("Reviewed privacy policy URLs are required before staging a distributable extension.");
const output = join(root, "dist", "onshape-mcpb", target);
await rm(output, { recursive: true, force: true });
await mkdir(join(output, "server"), { recursive: true });
await esbuild.build({
  entryPoints: [join(source, "src", "onshape-ui", "extension-entry.ts")],
  outfile: join(output, "server", "index.mjs"), bundle: true, platform: "node",
  target: "node22", format: "esm", external: ["playwright", "keytar"], logLevel: "info",
});
await cp(join(resources, "node_modules"), join(output, "node_modules"), { recursive: true, verbatimSymlinks: true });
await cp(join(resources, "browser"), join(output, "browser"), { recursive: true, verbatimSymlinks: true });
// Preserve existing OS-vault pairings when the target release environment already
// provides the optional matching native credential adapter. Never install one.
const keytarBundled = Boolean(keytarRoot);
if (keytarRoot) {
  await cp(keytarRoot, join(output, "node_modules", "keytar"), { recursive: true, verbatimSymlinks: true });
}
template.compatibility.platforms = [process.platform];
await writeFile(join(output, "manifest.json"), JSON.stringify(template, null, 2) + "\n");
await writeFile(join(output, "browser-manifest.json"), JSON.stringify(metadata, null, 2) + "\n");
await writeFile(join(output, "package.json"), JSON.stringify({ name: template.name, version: template.version, private: true, type: "module" }, null, 2) + "\n");
await cp(join(source, "mcpb", "GETTING-STARTED.md"), join(output, "GETTING-STARTED.md"));
await writeFile(join(output, "RELEASE-CHECKS.json"), JSON.stringify({ target, keytarBundled, acceptance: "unverified", checksRequired: ["MCPB validation and signing", "host Node runtime compatibility", "existing credential storage compatibility", "installation in supported AI clients", "team approval and revocation", "browser cleanup", "disposable model verification"] }, null, 2) + "\n");
console.log(`Staged ${output}. Validate, pack and sign with the pre-provisioned official MCPB release tooling; no archive was generated or installed.`);
