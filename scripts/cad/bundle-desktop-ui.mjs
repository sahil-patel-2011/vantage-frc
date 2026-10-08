#!/usr/bin/env node
/** Explicit release staging only. No installs, browser downloads or execution.
 * Requires a release operator's already provisioned matching Playwright browser.
 * Run separately for each target platform/architecture; never as an install hook.
 */
import { cp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNativeTarget, assertRelocatableTree, pathIsWithin } from "./packaging-resources.mjs";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const browserDir = argument("--browser-dir");
const executable = argument("--browser-executable");
if (!browserDir || !executable) throw new Error("Provide --browser-dir and --browser-executable for an already provisioned matching Playwright Chromium build.");
if (!["darwin", "win32"].includes(process.platform)) throw new Error("Stage desktop CAD resources on the target macOS or Windows release host.");
const browserRoot = await realpath(resolve(browserDir));
const browserExecutable = await realpath(resolve(executable));
const executableRelative = relative(browserRoot, browserExecutable);
if (!executableRelative || executableRelative.startsWith("..") || isAbsolute(executableRelative) || !(await stat(browserExecutable)).isFile()) throw new Error("The browser executable must be inside the supplied browser directory.");
// Replace only this host's bundle; retain other architecture bundles when
// assembling a universal shell's resources in the authorized release pipeline.
const stage = join(root, "apps", "desktop", "resources", "onshape-ui", `${process.platform}-${process.arch}`);
if (pathIsWithin(browserRoot, stage) || pathIsWithin(stage, browserRoot)) throw new Error("The browser source and generated staging folder must not overlap.");
const esbuild = await import("esbuild");
const playwrightRoot = dirname(require.resolve("playwright/package.json"));
const playwrightCoreRoot = dirname(require.resolve("playwright-core/package.json"));
const playwrightVersion = JSON.parse(await readFile(join(playwrightRoot, "package.json"), "utf8")).version;
const coreVersion = JSON.parse(await readFile(join(playwrightCoreRoot, "package.json"), "utf8")).version;
if (playwrightVersion !== coreVersion) throw new Error("Playwright and playwright-core must use the same pinned version.");
await assertNativeTarget(browserExecutable, process.platform, process.arch);
await assertRelocatableTree(browserRoot);
await assertRelocatableTree(playwrightRoot);
await assertRelocatableTree(playwrightCoreRoot);
await rm(stage, { recursive: true, force: true });
await mkdir(join(stage, "node_modules"), { recursive: true });
await esbuild.build({ entryPoints: [join(root, "scripts", "cad", "desktop-ui-worker.ts")], outfile: join(stage, "worker.cjs"), bundle: true, platform: "node", target: "node22", format: "cjs", external: ["playwright"], logLevel: "info" });
await cp(playwrightRoot, join(stage, "node_modules", "playwright"), { recursive: true, verbatimSymlinks: true });
await cp(playwrightCoreRoot, join(stage, "node_modules", "playwright-core"), { recursive: true, verbatimSymlinks: true });
await cp(browserRoot, join(stage, "browser"), { recursive: true, verbatimSymlinks: true });
await writeFile(join(stage, "manifest.json"), JSON.stringify({ version: 1, platform: process.platform, arch: process.arch, playwrightVersion, browserExecutable: join("browser", executableRelative) }, null, 2) + "\n");
console.log("Staged desktop CAD resources. Signing, packaging and target-platform acceptance remain required.");
