import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formBuilderNextActions,
  formBuilderSetupSteps,
  formBuilderShellCopy,
} from "../scouting/form-builder";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student chrome not skip-list and not in open PRs #2–#41:
 * Form builder still said schemas / org-scoped / TBA; Chemistry still named
 * TBA/Statbotics; Inventory / Inspection / Learning / My Kit / Kickoff still
 * badged Setup required; CAD API still said Onshape OAuth and API keys.
 */
const FILES = [
  "lib/scouting/form-builder.ts",
  "app/scouting/forms/forms-chrome.tsx",
  "app/chemistry/chemistry-client.tsx",
  "app/inventory/inventory-chrome.tsx",
  "app/inspection-copilot/inspection-chrome.tsx",
  "app/inspection-copilot/inspection-copilot-client.tsx",
  "app/learning/learning-client.tsx",
  "app/my-kit/my-kit-client.tsx",
  "app/kickoff/kickoff-intelligence.tsx",
  "app/api/cad/route.ts",
  "app/api/cad/onshape/route.ts",
  "app/api/cad/agent/route.ts",
] as const;

describe("leftover schema / OAuth / Setup required student chrome", () => {
  it("does not print leftover engineering copy on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/org-isolated storage/);
      expect(src, rel).not.toMatch(/org- and season-scoped/);
      expect(src, rel).not.toMatch(/versioned match or pit schemas/);
      expect(src, rel).not.toMatch(/published schemas/);
      expect(src, rel).not.toMatch(/blocked schemas/);
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/own rows inside one team/);
      expect(src, rel).not.toMatch(/AI provider not configured/);
      expect(src, rel).not.toMatch(/Configure an AI provider key/);
      expect(src, rel).not.toMatch(/Hard usage cutoffs/);
      expect(src, rel).not.toMatch(/Connect Onshape with OAuth/);
      expect(src, rel).not.toMatch(/Server API keys do not count/);
      expect(src, rel).not.toMatch(/API keys alone are not a connected workspace/);
      if (rel.includes("inspection-copilot-client")) {
        expect(src, rel).not.toMatch(/>Subsystems</);
      }
    }
  });

  it("form builder empty/setup/error copy is student-readable", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = formBuilderShellCopy(kind);
      expectPlainCopy(copy.description);
      expect(copy.description).not.toMatch(/schema/i);
      expect(copy.title).not.toMatch(/schema/i);
    }
    expect(formBuilderShellCopy("setup").badge).toBe("Needs setup");
    for (const step of formBuilderSetupSteps(null)) {
      expectPlainCopy(step.detail);
    }
    for (const action of formBuilderNextActions({ orgId: null, shell: "setup" })) {
      expectPlainCopy(action.detail);
    }
  });

  it("CAD hosted routes tell students to connect Onshape, not OAuth", () => {
    const cad = readFileSync(join(WEB, "app/api/cad/route.ts"), "utf8");
    const onshape = readFileSync(join(WEB, "app/api/cad/onshape/route.ts"), "utf8");
    const agent = readFileSync(join(WEB, "app/api/cad/agent/route.ts"), "utf8");
    expect(cad).toMatch(/Connect Onshape in CAD Connections/);
    expect(cad).toMatch(/your Onshape account/);
    expect(cad).toMatch(/saved team password/);
    expect(cad).toMatch(/studentOnshapeApiSetup/);
    expect(cad).not.toMatch(/\.\.\.onshapeSetupStatus\(\)/);
    expect(onshape).toMatch(/studentOnshapeApiSetup/);
    expect(onshape).not.toMatch(/\.\.\.onshapeSetupStatus\(\)/);
    expect(agent).toMatch(/Connect Onshape in CAD Connections/);
    expect(agent).toMatch(/saved Onshape password/);
    expect(agent).not.toMatch(/\.\.\.onshapeSetupStatus\(\)/);
  });
});
