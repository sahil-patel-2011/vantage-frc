import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_LISTED_ELEMENTS,
  completeElementsDocumentRef,
  documentTabKind,
  isBindableDocumentTab,
  listDocumentElements,
  parseListedDocumentElements,
  rejectDemoElementId,
} from "./list-document-elements";

const ORG = "11111111-1111-4111-8111-111111111111";
const DOCUMENT = {
  documentId: "d1",
  workspaceId: "w1",
};
const LIVE = [
  { id: "ps-1", name: "Plate", type: "PARTSTUDIO", elementType: "PARTSTUDIO" },
  { id: "asm-1", name: "Drive", type: "ASSEMBLY", elementType: "ASSEMBLY" },
  { id: "vs-1", name: "Vars", type: "VARIABLESTUDIO", elementType: "VARIABLESTUDIO" },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rejectDemoElementId", () => {
  it("keeps a real id and refuses DEMO", () => {
    expect(rejectDemoElementId("ps-1")).toBe("ps-1");
    expect(rejectDemoElementId("  asm-1  ")).toBe("asm-1");
    expect(rejectDemoElementId("")).toBe("");
    expect(() => rejectDemoElementId("DEMO-element")).toThrow(/DEMO element id/i);
    expect(() => rejectDemoElementId("demo-tab")).toThrow(/DEMO element id/i);
  });
});

describe("isBindableDocumentTab", () => {
  it("keeps Part Studio / Assembly / Variable Studio and skips other tabs", () => {
    expect(isBindableDocumentTab("PARTSTUDIO")).toBe(true);
    expect(isBindableDocumentTab("Part Studio")).toBe(true);
    expect(isBindableDocumentTab("ASSEMBLY")).toBe(true);
    expect(isBindableDocumentTab("", "VARIABLESTUDIO")).toBe(true);
    expect(isBindableDocumentTab("Variable Studio")).toBe(true);
    expect(isBindableDocumentTab("FEATURESTUDIO")).toBe(false);
    expect(isBindableDocumentTab("BILLOFMATERIALS")).toBe(false);
    expect(isBindableDocumentTab("")).toBe(false);
  });

  it("classifies mutation vs extra tabs", () => {
    expect(documentTabKind("PARTSTUDIO")).toBe("partstudio");
    expect(documentTabKind("Part Studio")).toBe("partstudio");
    expect(documentTabKind("ASSEMBLY")).toBe("assembly");
    expect(documentTabKind("", "VARIABLESTUDIO")).toBe("variablestudio");
    expect(documentTabKind("FEATURESTUDIO")).toBeNull();
  });
});

describe("parseListedDocumentElements", () => {
  it("reads only tabs Onshape already returned", () => {
    expect(
      parseListedDocumentElements({
        elements: LIVE,
        authPath: "oauth",
      }),
    ).toEqual({ elements: LIVE });
  });

  it("accepts type or elementType and skips non-tab types", () => {
    expect(
      parseListedDocumentElements({
        elements: [
          { id: "ps-1", name: "Plate", type: "Part Studio" },
          { id: "fs-1", name: "Feature Studio 1", elementType: "FEATURESTUDIO" },
          { id: "asm-1", name: "Drive", elementType: "ASSEMBLY" },
        ],
      }),
    ).toEqual({
      elements: [
        { id: "ps-1", name: "Plate", type: "Part Studio", elementType: "Part Studio" },
        { id: "asm-1", name: "Drive", type: "ASSEMBLY", elementType: "ASSEMBLY" },
      ],
    });
  });

  it("stays empty when Onshape sent no elements — never invents ids", () => {
    expect(parseListedDocumentElements({})).toEqual(EMPTY_LISTED_ELEMENTS);
    expect(parseListedDocumentElements(null)).toEqual(EMPTY_LISTED_ELEMENTS);
    expect(parseListedDocumentElements({ elements: [] })).toEqual(EMPTY_LISTED_ELEMENTS);
    expect(JSON.stringify(parseListedDocumentElements({}))).not.toMatch(/DEMO/i);
  });

  it("refuses DEMO element ids instead of listing them", () => {
    expect(() => parseListedDocumentElements({ elements: [{ id: "DEMO-tab", name: "Plate", elementType: "PARTSTUDIO" }] })).toThrow(
      /DEMO element id/i,
    );
    expect(() => parseListedDocumentElements({ elements: [{ id: "demo-ps", type: "PARTSTUDIO" }] })).toThrow(
      /DEMO element id/i,
    );
  });
});

describe("completeElementsDocumentRef", () => {
  it("requires document and workspace — never guesses an element", () => {
    expect(completeElementsDocumentRef(DOCUMENT)).toEqual(DOCUMENT);
    expect(completeElementsDocumentRef({ documentId: "d1" })).toBeNull();
    expect(completeElementsDocumentRef({ ...DOCUMENT, workspaceId: "  " })).toBeNull();
    expect(completeElementsDocumentRef(null)).toBeNull();
  });
});

describe("listDocumentElements", () => {
  it("POSTs list-onshape-elements and returns tabs Onshape already listed", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      expect(body?.action).toBe("list-onshape-elements");
      expect(body?.orgId).toBe(ORG);
      expect(body?.documentId).toBe(DOCUMENT.documentId);
      expect(body?.workspaceId).toBe(DOCUMENT.workspaceId);
      return Response.json({ elements: LIVE, authPath: "oauth" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listDocumentElements({ orgId: ORG, ...DOCUMENT })).resolves.toEqual({ elements: LIVE });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/DEMO/i);
  });

  it("accepts a documentRef without inventing an element id", async () => {
    const fetchMock = vi.fn(async () => Response.json({ elements: LIVE }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listDocumentElements({ orgId: ORG, documentRef: DOCUMENT })).resolves.toEqual({ elements: LIVE });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      action: "list-onshape-elements",
      orgId: ORG,
      documentId: DOCUMENT.documentId,
      workspaceId: DOCUMENT.workspaceId,
    });
    expect(body).not.toHaveProperty("elementId");
  });

  it("returns empty when the API listed nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ elements: [] })));
    await expect(listDocumentElements({ orgId: ORG, ...DOCUMENT })).resolves.toEqual(EMPTY_LISTED_ELEMENTS);
  });

  it("does not fetch when orgId or a document bind is missing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(listDocumentElements({ orgId: "", ...DOCUMENT })).rejects.toThrow(/orgId/i);
    await expect(listDocumentElements({ orgId: ORG })).rejects.toThrow(/document\/workspace/i);
    await expect(listDocumentElements({ orgId: ORG, documentId: "d1" })).rejects.toThrow(/document\/workspace/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces a hosted error and never invents ids", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Onshape is not connected" }, { status: 400 })));
    await expect(listDocumentElements({ orgId: ORG, ...DOCUMENT })).rejects.toThrow(/Onshape is not connected/i);
  });

  it("rejects a DEMO payload from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ elements: [{ id: "DEMO-element", elementType: "PARTSTUDIO" }] })),
    );
    await expect(listDocumentElements({ orgId: ORG, ...DOCUMENT })).rejects.toThrow(/DEMO element id/i);
  });
});
