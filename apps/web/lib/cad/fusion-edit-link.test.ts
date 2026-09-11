import { describe, expect, it } from "vitest";
import { expectPlainCopy } from "../ui/copy-assertions";
import {
  EDIT_IN_FUSION,
  FUSION_EDIT_BOARD_HINT,
  FUSION_EDIT_BOARD_TITLE,
  FUSION_PASTE_LINK_HINT,
  FUSION_PASTE_LINK_LABEL,
  fusionEditHref,
  fusionEditLabel,
  parsePastedFusionLink,
} from "./fusion-edit-link";
import { hostedFusionSetup } from "./fusion-setup";
import { FUSION_MISSING_CONFIG_MESSAGE, FUSION_READY_MESSAGE } from "./fusion-setup-strings";

const LIVE = "https://a360.co/3AbCdEf";

describe("Fusion human-edit URLs", () => {
  it("accepts a pasted Autodesk share as Edit in Fusion", () => {
    expect(fusionEditHref(LIVE)).toBe(`${LIVE}`);
    expect(fusionEditHref("https://myhub.autodesk360.com/g/projects/1234")).toContain("autodesk360.com");
    expect(fusionEditHref("https://example.com/not-fusion")).toBeNull();
    expect(fusionEditHref("https://a360.co/demo-doc")).toBeNull();
    expect(fusionEditHref("")).toBeNull();
  });

  it("parses a share link and refuses DEMO paste", () => {
    expect(parsePastedFusionLink(LIVE)).toEqual({
      url: LIVE,
      host: "a360.co",
    });
    expect(() => parsePastedFusionLink("")).toThrow(/Paste a Fusion/i);
    expect(() => parsePastedFusionLink("https://a360.co/demo-doc")).toThrow(/demo/i);
    expect(() => parsePastedFusionLink("https://example.com/not-fusion")).toThrow(/Fusion link/i);
  });

  it("labels Edit in Fusion without OAuth or env-var names", () => {
    expect(fusionEditLabel("Intake")).toBe("Edit Intake in Fusion");
    expect(fusionEditLabel(null)).toBe(EDIT_IN_FUSION);
    expect(FUSION_EDIT_BOARD_TITLE).toBe("Edit a Fusion document");
    expect(FUSION_PASTE_LINK_LABEL).toBe("Paste a Fusion link");
    expectPlainCopy(FUSION_EDIT_BOARD_HINT);
    expectPlainCopy(FUSION_PASTE_LINK_HINT);
    const copy = [FUSION_EDIT_BOARD_HINT, FUSION_PASTE_LINK_HINT, EDIT_IN_FUSION].join(" ");
    expect(copy).not.toMatch(/OAuth|FUSION_RELAY|vantage-cad|CLIENT_SECRET/i);
  });
});

describe("hosted Fusion setup", () => {
  it("Needs setup when the signing secret is missing, without naming it", () => {
    const blocked = hostedFusionSetup({});
    expect(blocked.setupRequired).toBe(true);
    expect(blocked.status).toBe("setup_required");
    expect(blocked.message).toBe(FUSION_MISSING_CONFIG_MESSAGE);
    expect(blocked.message).not.toMatch(/FUSION_RELAY|DATABASE_CAD|OAuth|Vercel/);
    expectPlainCopy(FUSION_MISSING_CONFIG_MESSAGE);
  });

  it("is ready when a signing secret is present", () => {
    const ready = hostedFusionSetup({ FUSION_RELAY_SIGNING_SECRET: "team-secret" });
    expect(ready.setupRequired).toBe(false);
    expect(ready.configured).toBe(true);
    expect(ready.message).toBe(FUSION_READY_MESSAGE);
    expectPlainCopy(FUSION_READY_MESSAGE);
  });
});
