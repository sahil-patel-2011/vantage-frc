#!/usr/bin/env node
/**
 * Package desktop CAD artifacts for distribution (unsigned).
 * Produces dist/cad-relay/ with CLI sources, Fusion add-in, install scripts,
 * protocol VERSION.json, and MANIFEST.json for CI reproducibility.
 * Signing/notarization hooks are stubs until certs are available.
 */
import { cpSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { platform } from "node:os";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const out = join(root, "dist", "cad-relay");
const addinSrc = join(root, "packages", "fusion360-official-connector", "VantageCadRelay");
const cliPkg = join(root, "packages", "vantage-cad-cli");
const scriptsSrc = join(root, "scripts", "cad");

const PROTOCOL = "2026-07-1";
const ADDIN_VERSION = "0.1.1";
const CLI_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(cliPkg, "package.json"), "utf8"));
    return pkg.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
})();

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(join(out, "scripts"), { recursive: true });

cpSync(addinSrc, join(out, "VantageCadRelay"), { recursive: true });
writeFileSync(
  join(out, "VantageCadRelay", "VERSION.json"),
  JSON.stringify(
    {
      version: ADDIN_VERSION,
      protocol: PROTOCOL,
      packagedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

cpSync(cliPkg, join(out, "vantage-cad-cli"), {
  recursive: true,
  filter: (src) => !src.includes("node_modules") && !src.endsWith(".tsbuildinfo"),
});

for (const name of [
  "install-cli.ps1",
  "install-cli.sh",
  "install-fusion-addin.ps1",
  "install-fusion-addin.sh",
  "install-linux-relay.sh",
  "install-windows.ps1",
  "package-relay.mjs",
  "package-macos.sh",
  "package-linux.sh",
  "bundle-cli.mjs",
]) {
  const src = join(scriptsSrc, name);
  if (existsSync(src)) cpSync(src, join(out, "scripts", name));
}

for (const dir of ["macos", "linux", "windows"]) {
  const src = join(scriptsSrc, dir);
  if (existsSync(src)) cpSync(src, join(out, "scripts", dir), { recursive: true });
}

const sha256File = (relPath) => {
  const abs = join(out, relPath);
  if (!existsSync(abs)) return null;
  const hash = createHash("sha256");
  hash.update(readFileSync(abs));
  return hash.digest("hex");
};

const matrix = {
  generatedAt: new Date().toISOString(),
  hostPlatform: platform(),
  protocol: {
    current: PROTOCOL,
    supported: [PROTOCOL],
    minCliVersion: "0.1.0",
    minAddinVersion: "0.1.0",
    addinVersion: ADDIN_VERSION,
    cliVersion: CLI_VERSION,
  },
  artifacts: {
    fusionAddin: "VantageCadRelay/",
    cliPackage: "vantage-cad-cli/",
    installScripts: {
      windowsOneShot: "scripts/install-windows.ps1",
      windowsCli: "scripts/install-cli.ps1",
      unixCli: "scripts/install-cli.sh",
      linuxRelay: "scripts/install-linux-relay.sh",
      windowsFusion: "scripts/install-fusion-addin.ps1",
      macosFusion: "scripts/install-fusion-addin.sh",
      packageMacos: "scripts/package-macos.sh",
      packageLinux: "scripts/package-linux.sh",
      wixStub: "scripts/windows/VantageCadRelay.wxs",
    },
    packaging: {
      macos: "scripts/macos/",
      linux: "scripts/linux/",
      windows: "scripts/windows/",
    },
  },
  checksums: {
    "VantageCadRelay/VantageCadRelay.py": sha256File("VantageCadRelay/VantageCadRelay.py"),
    "VantageCadRelay/VantageCadRelay.manifest": sha256File("VantageCadRelay/VantageCadRelay.manifest"),
    "VantageCadRelay/VERSION.json": sha256File("VantageCadRelay/VERSION.json"),
  },
  osSupport: {
    windows: { cli: true, fusionAddin: true, onshape: true },
    macos: { cli: true, fusionAddin: true, onshape: true },
    linux: { cli: true, fusionAddin: false, onshape: true, note: "Fusion Autodesk app unavailable" },
  },
  endpoints: {
    compatibility: "/api/cad/compatibility",
  },
  signing: {
    status: "unsigned",
    nextSteps: [
      "Windows: wrap vantage-cad + add-in with WiX/Advanced Installer and Authenticode-sign when cert available",
      "macOS: pkgbuild/productbuild then notarize with Apple Developer ID when certs available",
      "Linux: ship install-cli.sh + tarball/AppImage of CLI only (no Fusion add-in)",
    ],
  },
};

writeFileSync(join(out, "MANIFEST.json"), JSON.stringify(matrix, null, 2));
writeFileSync(
  join(out, "README.txt"),
  [
    "Vantage CAD relay package (unsigned)",
    `Protocol: ${PROTOCOL}`,
    `CLI package version: ${CLI_VERSION}`,
    `Add-in version: ${ADDIN_VERSION}`,
    "",
    "Install CLI from repo (preferred) or this tree:",
    "  Windows: powershell -File scripts/install-cli.ps1",
    "  macOS/Linux: bash scripts/install-cli.sh",
    "",
    "Install Fusion add-in:",
    "  Windows: powershell -File scripts/install-fusion-addin.ps1",
    "  macOS: bash scripts/install-fusion-addin.sh",
    "  Linux: not supported (use Onshape or VANTAGE_CAD_MOCK=1)",
    "",
    "Compatibility probe:",
    "  GET $VANTAGE_URL/api/cad/compatibility?cliVersion=0.1.0&protocol=" + PROTOCOL,
    "",
    "Pair: VANTAGE_URL=… vantage-cad setup && vantage-cad start",
    "",
  ].join("\n"),
);

if (!existsSync(join(cliPkg, "dist"))) {
  console.warn(
    "Warning: packages/vantage-cad-cli/dist missing — run npm run build --workspace=@vantage/cad-cli before shipping.",
  );
}

const archiveName = `vantage-cad-relay-${PROTOCOL.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
const archivesDir = join(root, "dist", "cad-archives");
mkdirSync(archivesDir, { recursive: true });

if (!existsSync(join(out, "MANIFEST.json"))) {
  throw new Error("MANIFEST.json missing after package — aborting archive");
}

try {
  // Prefer tar (available on modern Windows + Unix) for a stable, reproducible archive.
  const archivePath =
    platform() === "win32"
      ? join(archivesDir, `${archiveName}.zip`)
      : join(archivesDir, `${archiveName}.tar.gz`);
  rmSync(archivePath, { force: true });
  if (platform() === "win32") {
    execSync(`tar -a -cf "${archivePath}" -C "${out}" .`, { stdio: "inherit" });
  } else {
    execSync(`tar -czf "${archivePath}" -C "${out}" .`, { stdio: "inherit" });
  }
  console.log(`Archive: ${archivePath}`);
} catch (error) {
  console.warn(`Archive step skipped: ${error instanceof Error ? error.message : String(error)}`);
}

console.log(`Packaged unsigned CAD relay artifacts → ${out}`);
