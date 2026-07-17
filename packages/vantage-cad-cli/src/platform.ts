import { access, readFile } from "node:fs/promises";
import { homedir, platform as osPlatform } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export const DEFAULT_FUSION_PLUGIN_ENDPOINT = "http://127.0.0.1:32145";

export function browserCommand(url: string, platform = osPlatform()) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP(S) onboarding URLs may be opened");
  }
  if (platform === "win32") return { command: "explorer.exe", args: [parsed.toString()] };
  if (platform === "darwin") return { command: "open", args: [parsed.toString()] };
  return { command: "xdg-open", args: [parsed.toString()] };
}

export async function openBrowser(url: string) {
  const value = browserCommand(url);
  const child = spawn(value.command, value.args, { detached: true, stdio: "ignore", shell: false });
  child.unref();
}

export function fusionAddinPaths(
  platform = osPlatform(),
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
) {
  if (platform === "win32") {
    return [
      join(env.APPDATA ?? join(home, "AppData", "Roaming"), "Autodesk", "Autodesk Fusion 360", "API", "AddIns"),
    ];
  }
  if (platform === "darwin") {
    return [join(home, "Library", "Application Support", "Autodesk", "Autodesk Fusion 360", "API", "AddIns")];
  }
  return [];
}

export type InstalledAddinInfo = {
  path: string;
  version: string | null;
  protocol: string | null;
};

async function readInstalledAddin(addInsRoot: string): Promise<InstalledAddinInfo | null> {
  const path = join(addInsRoot, "VantageCadRelay");
  const py = join(path, "VantageCadRelay.py");
  const manifest = join(path, "VantageCadRelay.manifest");
  const hasPy = await access(py).then(() => true).catch(() => false);
  const hasManifest = await access(manifest).then(() => true).catch(() => false);
  if (!hasPy || !hasManifest) return null;
  let version: string | null = null;
  let protocol: string | null = null;
  try {
    const raw = await readFile(join(path, "VERSION.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string; protocol?: string };
    version = parsed.version ?? null;
    protocol = parsed.protocol ?? null;
  } catch {
    /* VERSION.json optional on older installs */
  }
  return { path, version, protocol };
}

export async function detectFusionPrerequisites() {
  const paths = fusionAddinPaths();
  const existing: string[] = [];
  const installed: InstalledAddinInfo[] = [];
  for (const path of paths) {
    if (await access(path).then(() => true).catch(() => false)) existing.push(path);
    const addin = await readInstalledAddin(path);
    if (addin) installed.push(addin);
  }
  const os = osPlatform();
  return {
    supported: os === "win32" || os === "darwin",
    paths,
    existing,
    installed,
    linuxNote:
      os === "linux"
        ? "Autodesk Fusion 360 is not available on Linux. Use Onshape hosted CAD or VANTAGE_CAD_MOCK=1 for relay protocol tests."
        : undefined,
  };
}

export function validatePluginEndpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("Fusion plugin endpoint must be loopback HTTP");
  }
  return url;
}

export type PluginHealth = {
  ok: boolean;
  reachable: boolean;
  mock?: boolean;
  protocol?: string;
  addinVersion?: string;
  documentName?: string;
  error?: string;
};

export async function probeFusionPluginHealth(
  endpoint = DEFAULT_FUSION_PLUGIN_ENDPOINT,
  timeoutMs = 2500,
): Promise<PluginHealth> {
  const url = validatePluginEndpoint(endpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("/health", url), { signal: controller.signal });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      return { ok: false, reachable: true, error: `HTTP ${response.status}` };
    }
    return {
      ok: Boolean(data.ok),
      reachable: true,
      mock: Boolean(data.mock),
      protocol: typeof data.protocol === "string" ? data.protocol : undefined,
      addinVersion: typeof data.addinVersion === "string" ? data.addinVersion : undefined,
      documentName: typeof data.documentName === "string" ? data.documentName : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      reachable: false,
      error: error instanceof Error ? error.message : "unreachable",
    };
  } finally {
    clearTimeout(timer);
  }
}
