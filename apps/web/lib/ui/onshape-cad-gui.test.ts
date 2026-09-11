import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cadLearnShellCopy, classifyCadLearnShell } from "../cad-learn/cad-learn-related";
import { cadVaultShellCopy } from "../cad-vault/cad-vault-related";
import { EDIT_IN_ONSHAPE, onshapeEditHref } from "../cad/onshape-edit-link";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

const THIS_SLICE = [
  "lib/cad/onshape-edit-link.ts",
  "app/cad/onshape-edit-board.tsx",
  "app/cad/cad-viewport.tsx",
  "app/cad/cad-ready-view.tsx",
  "app/cad/setup/setup-client.tsx",
  "app/cad-vault/link-cad.tsx",
  "app/cad-vault/cad-vault-document-card.tsx",
  "app/cad-learn/cad-learn-client.tsx",
  "app/cad-learn/cad-learn-chrome.tsx",
] as const;

describe("Onshape CAD GUI human-edit slice", () => {
  it("Edit in Onshape is the student verb and never names OAuth", () => {
    expect(EDIT_IN_ONSHAPE).toBe("Edit in Onshape");
    expect(
      onshapeEditHref(
        "https://cad.onshape.com/documents/aaa111/w/bbb222/e/ccc333",
      ),
    ).toContain("cad.onshape.com/documents/");
    expect(cadVaultShellCopy("setup").badge).toBe("Needs setup");
    expect(cadVaultShellCopy("setup").title).toBe("Choose your team");
    expect(classifyCadLearnShell({ authBlocked: true })).toBe("setup");
    expect(cadLearnShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(cadLearnShellCopy("setup").description);
  });

  it("viewport, vault, Learn, and setup keep gold last-snapshot and Edit in Onshape", () => {
    const viewport = readFileSync(join(WEB, "app/cad/cad-viewport.tsx"), "utf8");
    expect(viewport).toMatch(/OnshapeEditButton/);
    expect(viewport).toMatch(/OnshapeDocumentEmbed/);
    expect(viewport).toMatch(/Needs setup/);
    expect(viewport).not.toMatch(/setup required/i);
    expect(viewport).not.toMatch(/OAuth|ONSHAPE_|vantage-cad/);

    const vault = readFileSync(join(WEB, "app/cad-vault/cad-vault-client.tsx"), "utf8");
    expect(vault).toMatch(/if \(!view\)/);
    expect(vault).toMatch(/putFeatureSnapshot\("cad-vault"/);
    expect(vault).toMatch(/clearFeatureSnapshot\("cad-vault"/);
    expect(vault).toMatch(/response\.status === 401 \|\| response\.status === 403/);

    const learn = readFileSync(join(WEB, "app/cad-learn/cad-learn-client.tsx"), "utf8");
    expect(learn).toMatch(/if \(!view\)/);
    expect(learn).toMatch(/putFeatureSnapshot\("cad-learn"/);
    expect(learn).toMatch(/clearFeatureSnapshot\("cad-learn"/);
    expect(learn).toMatch(/OnshapeEditBoard/);

    const setup = readFileSync(join(WEB, "app/cad/setup/setup-client.tsx"), "utf8");
    expect(setup).toMatch(/if \(!view\)/);
    expect(setup).toMatch(/Choose your team/);
    expect(setup).toMatch(/OnshapeEditBoard/);
    expect(setup).toMatch(/Needs setup/);

    const ready = readFileSync(join(WEB, "app/cad/cad-ready-view.tsx"), "utf8");
    expect(ready).toMatch(/OnshapeEditButton/);
    expect(ready).toMatch(/variant=\{editHref \? "secondary" : "primary"\}/);
    expect(ready).not.toMatch(/cad-agent-open/);
  });

  it("does not print leftover Setup required / VANTAGE / OAuth on this slice", () => {
    for (const rel of THIS_SLICE) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/ONSHAPE_OAUTH/);
      expect(src, rel).not.toMatch(/CLIENT_SECRET/);
      expect(src, rel).not.toMatch(/Connect Onshape with OAuth/);
    }
  });
});
