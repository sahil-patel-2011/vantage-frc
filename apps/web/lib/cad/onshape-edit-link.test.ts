import { describe, expect, it } from "vitest";
import { expectPlainCopy } from "../ui/copy-assertions";
import {
  CAD_PASTE_LINK_HINT,
  CAD_PASTE_LINK_LABEL,
  EDIT_IN_ONSHAPE,
  ONSHAPE_EDIT_BOARD_HINT,
  ONSHAPE_EDIT_BOARD_TITLE,
  onshapeCanonicalHref,
  onshapeEditHref,
  onshapeEditLabel,
  onshapeEmbedHref,
  parsePastedOnshapeLink,
} from "./onshape-edit-link";

const LIVE =
  "https://cad.onshape.com/documents/aaa111/w/bbb222/e/ccc333";

describe("Onshape human-edit URLs", () => {
  it("builds a canonical Part Studio URL from real ids", () => {
    expect(onshapeCanonicalHref({ documentId: "aaa111", workspaceId: "bbb222", elementId: "ccc333" })).toBe(
      LIVE,
    );
    expect(onshapeCanonicalHref({ documentId: "aaa111", workspaceId: "bbb222" })).toBe(
      "https://cad.onshape.com/documents/aaa111/w/bbb222",
    );
    expect(onshapeCanonicalHref({ documentId: "aaa111" })).toBe(
      "https://cad.onshape.com/documents/aaa111",
    );
    expect(onshapeCanonicalHref({ documentId: "" })).toBe("");
    expect(onshapeCanonicalHref({ documentId: "demo-doc" })).toBe("");
  });

  it("accepts a pasted document as both edit and official embed", () => {
    expect(onshapeEditHref(LIVE)).toBe(LIVE);
    expect(onshapeEmbedHref(LIVE)).toBe(LIVE);
    expect(onshapeEditHref("https://example.com/not-onshape")).toBeNull();
    expect(onshapeEditHref("https://cad.onshape.com/documents/demo-doc")).toBeNull();
    expect(onshapeEditHref("")).toBeNull();
  });

  it("parses a Part Studio link and refuses DEMO paste", () => {
    expect(parsePastedOnshapeLink(LIVE)).toEqual({
      url: LIVE,
      documentId: "aaa111",
      workspaceId: "bbb222",
      elementId: "ccc333",
    });
    expect(() => parsePastedOnshapeLink("")).toThrow(/Paste an Onshape/i);
    expect(() => parsePastedOnshapeLink("https://cad.onshape.com/documents/demo-doc")).toThrow(/demo/i);
    expect(() => parsePastedOnshapeLink("https://example.com/not-onshape")).toThrow(/Not an Onshape/i);
  });

  it("labels Edit in Onshape without OAuth or env-var names", () => {
    expect(onshapeEditLabel("Intake")).toBe("Edit Intake in Onshape");
    expect(onshapeEditLabel(null)).toBe(EDIT_IN_ONSHAPE);
    expectPlainCopy(ONSHAPE_EDIT_BOARD_HINT);
    expectPlainCopy(CAD_PASTE_LINK_HINT);
    expect(ONSHAPE_EDIT_BOARD_TITLE).toBe("Edit an Onshape document");
    expect(CAD_PASTE_LINK_LABEL).toBe("Paste an Onshape link");
    const copy = [ONSHAPE_EDIT_BOARD_HINT, CAD_PASTE_LINK_HINT, EDIT_IN_ONSHAPE].join(" ");
    expect(copy).not.toMatch(/OAuth|ONSHAPE_|vantage-cad|CLIENT_SECRET/i);
  });
});
