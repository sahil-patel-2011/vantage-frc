import { homedir } from "node:os";
import { join } from "node:path";

/** Provider credentials and unrelated connector settings never enter a personal CLI. */
export function personalEnvironment(userId: string, engine: "codex" | "claude", inherited: NodeJS.ProcessEnv = process.env, home = homedir()) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw new Error("Pair this connection to a personal Vantage account.");
  const directory = join(home, ".vantage", "profiles", userId.toLowerCase(), engine);
  const env: Record<string, string> = {};
  for (const key of ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
    if (inherited[key] !== undefined) env[key] = inherited[key]!;
  }
  env[engine === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR"] = directory;
  return { env, directory };
}
