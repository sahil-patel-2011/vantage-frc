import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_LISTED_DOCUMENTS,
  listOnshapeDocuments,
  parseListedOnshapeDocuments,
  rejectDemoDocumentId,
} from "./list-onshape-documents";

const ORG = "11111111-1111-4111-8111-111111111111";
const LIVE = [
  { id: "doc-1", name: "Intake", defaultWorkspaceId: "w-1" },
  { id: "doc-2", name: "Drivetrain", defaultWorkspaceId: "" },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rejectDemoDocumentId", () => {
  it("keeps a real id and refuses DEMO", () => {
    expect(rejectDemoDocumentId("doc-1")).toBe("doc-1");
    expect(rejectDemoDocumentId("  doc-2  ")).toBe("doc-2");
    expect(rejectDemoDocumentId("")).toBe("");
    expect(() => rejectDemoDocumentId("DEMO-doc")).toThrow(/DEMO document id/i);
    expect(() => rejectDemoDocumentId("demo-part")).toThrow(/DEMO document id/i);
  });
});

describe("parseListedOnshapeDocuments", () => {
  it("reads only documents Onshape already returned", () => {
    expect(parseListedOnshapeDocuments({ documents: LIVE, authPath: "oauth" })).toEqual({ documents: LIVE });
  });

  it("stays empty when Onshape sent no documents — never invents ids", () => {
    expect(parseListedOnshapeDocuments({})).toEqual(EMPTY_LISTED_DOCUMENTS);
    expect(parseListedOnshapeDocuments(null)).toEqual(EMPTY_LISTED_DOCUMENTS);
    expect(parseListedOnshapeDocuments({ documents: [] })).toEqual(EMPTY_LISTED_DOCUMENTS);
    expect(JSON.stringify(parseListedOnshapeDocuments({}))).not.toMatch(/DEMO/i);
  });

  it("refuses DEMO document ids instead of listing them", () => {
    expect(() => parseListedOnshapeDocuments({ documents: [{ id: "DEMO-doc", name: "Plate" }] })).toThrow(
      /DEMO document id/i,
    );
  });
});

describe("listOnshapeDocuments", () => {
  it("POSTs list-onshape-documents and returns rows Onshape already listed", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      expect(body?.action).toBe("list-onshape-documents");
      expect(body?.orgId).toBe(ORG);
      return Response.json({ documents: LIVE, authPath: "oauth" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listOnshapeDocuments({ orgId: ORG })).resolves.toEqual({ documents: LIVE });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/DEMO/i);
  });

  it("returns empty when the API listed nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ documents: [] })));
    await expect(listOnshapeDocuments({ orgId: ORG })).resolves.toEqual(EMPTY_LISTED_DOCUMENTS);
  });

  it("does not fetch when orgId is missing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(listOnshapeDocuments({ orgId: "" })).rejects.toThrow(/orgId/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces a hosted error and never invents ids", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Onshape is not connected" }, { status: 400 })));
    await expect(listOnshapeDocuments({ orgId: ORG })).rejects.toThrow(/Onshape is not connected/i);
  });
});
