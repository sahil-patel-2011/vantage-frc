import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cadLearnShellCopy, classifyCadLearnShell } from "../cad-learn/cad-learn-related";
import { cadVaultShellCopy } from "../cad-vault/cad-vault-related";
import { EDIT_IN_FUSION, fusionEditHref } from "../cad/fusion-edit-link";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

const THIS_SLICE = [
  "lib/cad/fusion-edit-link.ts",
  "lib/cad/fusion-setup-strings.ts",
  "app/cad/fusion-edit-board.tsx",
  "app/cad/setup/setup-client.tsx",
  "app/cad/connections/connections-client.tsx",
  "app/cad-vault/link-cad.tsx",
  "app/cad-vault/cad-vault-document-card.tsx",
] as const;

describe("Fusion CAD GUI human-edit slice", () => {
  it("Edit in Fusion is the student verb and never names OAuth", () => {
    expect(EDIT_IN_FUSION).toBe("Edit in Fusion");
    expect(fusionEditHref("https://a360.co/3AbCdEf")).toContain("a360.co/3AbCdEf");
    expect(cadVaultShellCopy("setup").badge).toBe("Needs setup");
    expect(cadVaultShellCopy("setup").title).toBe("Choose your team");
    expect(classifyCadLearnShell({ authBlocked: true })).toBe("setup");
    expect(cadLearnShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(cadLearnShellCopy("setup").description);
  });

  it("vault, setup, and connections keep gold last-snapshot and Edit in Fusion", () => {
    const vault = readFileSync(join(WEB, "app/cad-vault/cad-vault-client.tsx"), "utf8");
    expect(vault).toMatch(/if \(!view\)/);
    expect(vault).toMatch(/putFeatureSnapshot\("cad-vault"/);
    expect(vault).toMatch(/clearFeatureSnapshot\("cad-vault"/);
    expect(vault).toMatch(/response\.status === 401 \|\| response\.status === 403/);

    const link = readFileSync(join(WEB, "app/cad-vault/link-cad.tsx"), "utf8");
    expect(link).toMatch(/FusionEditButton/);
    expect(link).toMatch(/a360\.co/);

    const card = readFileSync(join(WEB, "app/cad-vault/cad-vault-document-card.tsx"), "utf8");
    expect(card).toMatch(/FusionEditButton/);
    expect(card).toMatch(/fusionEditHref/);

    const setup = readFileSync(join(WEB, "app/cad/setup/setup-client.tsx"), "utf8");
    expect(setup).toMatch(/if \(!view\)/);
    expect(setup).toMatch(/Choose your team/);
    expect(setup).toMatch(/FusionEditBoard/);
    expect(setup).toMatch(/Needs setup/);
    expect(setup).toMatch(/fusionReady/);

    const connections = readFileSync(join(WEB, "app/cad/connections/connections-client.tsx"), "utf8");
    expect(connections).toMatch(/FusionEditBoard/);
    expect(connections).toMatch(/Choose your team/);
    expect(connections).toMatch(/fusionReady/);
    expect(connections).toMatch(/Needs setup/);
  });

  it("does not rewrite the Onshape viewport or dump env names on this slice", () => {
    const viewport = readFileSync(join(WEB, "app/cad/cad-viewport.tsx"), "utf8");
    expect(viewport).toMatch(/OnshapeEditButton/);
    expect(viewport).not.toMatch(/FusionEditButton/);
    expect(viewport).not.toMatch(/FusionEditBoard/);

    for (const rel of THIS_SLICE) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/FUSION_RELAY_SIGNING_SECRET/);
      expect(src, rel).not.toMatch(/CLIENT_SECRET/);
      expect(src, rel).not.toMatch(/vantage-cad/);
    }
  });
});
