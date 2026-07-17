#!/usr/bin/env node
/**
 * Package desktop CAD artifacts for distribution (unsigned).
 * Produces dist/cad-relay/ with CLI tarball metadata + Fusion add-in zip-ready folder.
 * Signing/notarization hooks are stubs until certs are available.
 */
import { cpSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { platform } from "node:os";

const root = resolve(import.meta.dirname, "../..");
const out = join(root, "dist", "cad-relay");
const addinSrc = join(root, "packages", "fusion360-official-connector", "VantageCadRelay");
const cliPkg = join(root, "packages", "vantage-cad-cli");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(addinSrc, join(out, "VantageCadRelay"), { recursive: true });
cpSync(cliPkg, join(out, "vantage-cad-cli"), {
  recursive: true,
  filter: (src) => !src.includes("node_modules"),
});

const matrix = {
  generatedAt: new Date().toISOString(),
  hostPlatform: platform(),
  artifacts: {
    fusionAddin: "VantageCadRelay/",
    cliPackage: "vantage-cad-cli/",
    installScripts: {
      windowsCli: "scripts/cad/install-cli.ps1",
      unixCli: "scripts/cad/install-cli.sh",
      windowsFusion: "scripts/cad/install-fusion-addin.ps1",
      macosFusion: "scripts/cad/install-fusion-addin.sh",
    },
  },
  osSupport: {
    windows: { cli: true, fusionAddin: true, onshape: true },
    macos: { cli: true, fusionAddin: true, onshape: true },
    linux: { cli: true, fusionAddin: false, onshape: true, note: "Fusion Autodesk app unavailable" },
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
    "",
    "Install CLI from repo:",
    "  Windows: powershell -File scripts/cad/install-cli.ps1",
    "  macOS/Linux: bash scripts/cad/install-cli.sh",
    "",
    "Install Fusion add-in:",
    "  Windows: powershell -File scripts/cad/install-fusion-addin.ps1",
    "  macOS: bash scripts/cad/install-fusion-addin.sh",
    "  Linux: not supported (use Onshape or VANTAGE_CAD_MOCK=1)",
    "",
    "Pair: VANTAGE_URL=… vantage-cad setup && vantage-cad start",
    "",
  ].join("\n"),
);

if (!existsSync(join(cliPkg, "dist"))) {
  console.warn("Warning: packages/vantage-cad-cli/dist missing — run npm run build --workspace=@vantage/cad-cli before shipping.");
}

console.log(`Packaged unsigned CAD relay artifacts → ${out}`);
