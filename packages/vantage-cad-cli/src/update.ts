import { access, readFile } from "node:fs/promises";
import { homedir, platform as osPlatform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const MARKER_NAME = "vantage";

async function isRepoRoot(dir: string) {
  try {
    const raw = await readFile(join(dir, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { name?: string; workspaces?: unknown };
    return pkg.name === MARKER_NAME && Boolean(pkg.workspaces);
  } catch {
    return false;
  }
}

/** Resolve the Vantage monorepo root for local reinstall / update. */
export async function findVantageRepoRoot(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  cliEntry = fileURLToPath(import.meta.url),
): Promise<string | null> {
  if (env.VANTAGE_REPO) {
    const candidate = resolve(env.VANTAGE_REPO);
    if (await isRepoRoot(candidate)) return candidate;
  }
  let dir = resolve(cwd);
  for (let i = 0; i < 12; i++) {
    if (await isRepoRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Walk up from installed CLI package (…/packages/vantage-cad-cli/dist)
  dir = resolve(dirname(cliEntry), "../../..");
  for (let i = 0; i < 8; i++) {
    if (await isRepoRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const homeGuess = join(homedir(), "Cursor Projects", "Vantage FRC Robotics AIO APP");
  if (await isRepoRoot(homeGuess)) return homeGuess;
  return null;
}

function run(command: string, args: string[], cwd: string) {
  return new Promise<number>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });
}

export type UpdateResult = {
  repoRoot: string;
  cliUpdated: boolean;
  addinUpdated: boolean;
  notes: string[];
};

/** Reinstall CLI + Fusion add-in from a local checkout (unsigned script path). */
export async function runLocalCadUpdate(options?: {
  skipAddin?: boolean;
  forceAddin?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<UpdateResult> {
  const env = options?.env ?? process.env;
  const repoRoot = await findVantageRepoRoot(env);
  if (!repoRoot) {
    throw new Error(
      "Could not find the Vantage repository. Set VANTAGE_REPO to the checkout root, or run from the monorepo, then retry `vantage-cad update`.",
    );
  }

  const notes: string[] = [`Repo: ${repoRoot}`];
  const os = osPlatform();
  let cliUpdated = false;
  let addinUpdated = false;

  if (os === "win32") {
    const script = join(repoRoot, "scripts", "cad", "install-windows.ps1");
    await access(script);
    const args = ["-ExecutionPolicy", "Bypass", "-File", script, "-SkipNpmInstall"];
    if (options?.skipAddin) args.push("-SkipAddin");
    if (options?.forceAddin) args.push("-ForceAddin");
    const code = await run("powershell", args, repoRoot);
    if (code !== 0) throw new Error(`Windows update script failed with exit ${code}`);
    cliUpdated = true;
    addinUpdated = !options?.skipAddin;
    notes.push("Ran scripts/cad/install-windows.ps1");
  } else {
    const cliScript = join(repoRoot, "scripts", "cad", "install-cli.sh");
    await access(cliScript);
    const cliCode = await run("bash", [cliScript], repoRoot);
    if (cliCode !== 0) throw new Error(`install-cli.sh failed with exit ${cliCode}`);
    cliUpdated = true;
    notes.push("Ran scripts/cad/install-cli.sh");

    if (!options?.skipAddin && os === "darwin") {
      const addinScript = join(repoRoot, "scripts", "cad", "install-fusion-addin.sh");
      await access(addinScript);
      const addinCode = await run("bash", [addinScript], repoRoot);
      if (addinCode !== 0) throw new Error(`install-fusion-addin.sh failed with exit ${addinCode}`);
      addinUpdated = true;
      notes.push("Ran scripts/cad/install-fusion-addin.sh");
    } else if (!options?.skipAddin && os === "linux") {
      notes.push("Skipped Fusion add-in (unsupported on Linux). Use Onshape or VANTAGE_CAD_MOCK=1.");
    }
  }

  return { repoRoot, cliUpdated, addinUpdated, notes };
}
