import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export function validateExtensionResourceManifest(value: unknown, platform: string, arch: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The CAD extension resource manifest is missing.");
  const manifest = value as Record<string, unknown>;
  if (manifest.version !== 1 || manifest.platform !== platform || manifest.arch !== arch) {
    throw new Error("Install the Vantage CAD extension matching this computer's operating system and processor.");
  }
  const executable = manifest.browserExecutable;
  if (typeof executable !== "string" || !executable || executable.includes("\0") || isAbsolute(executable) ||
    !executable.startsWith("browser/") && !executable.startsWith("browser\\") ||
    executable.split(/[\\/]/).includes("..")) {
    throw new Error("The CAD extension browser path is invalid. Reinstall the approved extension.");
  }
  return executable;
}

/** Resolve only the release's own browser. Never accept an executable from a tool or environment variable. */
export async function resolveExtensionBrowser(root: string, platform = process.platform, arch = process.arch): Promise<string> {
  const raw: unknown = JSON.parse(await readFile(join(root, "browser-manifest.json"), "utf8"));
  const executable = validateExtensionResourceManifest(raw, platform, arch);
  const actualRoot = await realpath(root);
  const browser = await realpath(resolve(actualRoot, executable));
  const child = relative(actualRoot, browser);
  if (!child || child.startsWith("..") || isAbsolute(child) || !(await stat(browser)).isFile()) {
    throw new Error("The packaged browser is missing or outside this extension. Nothing was downloaded or installed.");
  }
  return browser;
}
