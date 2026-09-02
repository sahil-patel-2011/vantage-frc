// Dev server with the E2E auth fixture enabled, so the product shell renders
// without a real session. Non-production only (proxy.ts refuses it otherwise).
// Preloads the OneDrive Dirent fix so Next discovers every route on this box.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = process.argv[2] || "3401";
const preload = path.join(here, "dirent-onedrive-fix.cjs");
const nodeOptions = [process.env.NODE_OPTIONS, `--require=${JSON.stringify(preload)}`]
  .filter(Boolean)
  .join(" ");

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "dev", "--port", port],
  {
    cwd: path.join(here, "..", "apps", "web"),
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, E2E_AUTH_FIXTURE: "1", NODE_OPTIONS: nodeOptions },
  },
);
child.on("exit", (code) => process.exit(code ?? 0));
