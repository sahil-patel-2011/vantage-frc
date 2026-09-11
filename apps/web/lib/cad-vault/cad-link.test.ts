import { describe, expect, it } from "vitest";
import { cadLinkKind, cadLinkLabel, parseCadExternalUrl, parseFusionDocumentUrl } from "./cad-link";

describe("parseFusionDocumentUrl", () => {
  it("accepts an a360.co share path", () => {
    const parsed = parseFusionDocumentUrl("https://a360.co/3AbCdEf");
    expect(parsed.host).toBe("a360.co");
    expect(parsed.url).toContain("a360.co/3AbCdEf");
  });

  it("accepts an Autodesk hub project URL", () => {
    const parsed = parseFusionDocumentUrl("https://myhub.autodesk360.com/g/projects/1234");
    expect(parsed.host).toBe("myhub.autodesk360.com");
  });

  it("rejects a marketing Autodesk page", () => {
    expect(() => parseFusionDocumentUrl("https://www.autodesk.com/products/fusion-360")).toThrow(/Fusion link/i);
  });

  it("rejects a host-only Fusion URL", () => {
    expect(() => parseFusionDocumentUrl("https://a360.co/")).toThrow(/document path/i);
  });
});

describe("parseCadExternalUrl", () => {
  it("parses an Onshape document URL", () => {
    const parsed = parseCadExternalUrl(
      "https://cad.onshape.com/documents/aaaaaaaaaaaaaaaaaaaaaaaa/w/bbbbbbbbbbbbbbbbbbbbbbbb/e/cccccccccccccccccccccccc",
    );
    expect(parsed.kind).toBe("onshape");
    if (parsed.kind === "onshape") {
      expect(parsed.documentId).toBe("aaaaaaaaaaaaaaaaaaaaaaaa");
    }
  });

  it("parses a Fusion share URL", () => {
    const parsed = parseCadExternalUrl("https://a360.co/intake-2026");
    expect(parsed.kind).toBe("fusion");
  });

  it("rejects a random https URL", () => {
    expect(() => parseCadExternalUrl("https://example.com/cad")).toThrow(/Onshape document link or a Fusion share link/i);
  });
});

describe("cadLinkLabel", () => {
  it("names Onshape and Fusion from the URL, not External source", () => {
    expect(cadLinkLabel("https://cad.onshape.com/documents/aaaaaaaaaaaaaaaaaaaaaaaa", "Intake")).toBe(
      "Edit Intake in Onshape",
    );
    expect(cadLinkLabel("https://a360.co/intake-2026", "Intake")).toBe("Edit Intake in Fusion");
    expect(cadLinkKind("https://example.com/x")).toBe("other");
    expect(cadLinkLabel("https://example.com/x", "Plate")).toBe("Open Plate");
  });
});
