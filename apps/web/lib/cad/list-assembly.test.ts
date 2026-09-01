import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_LISTED_ASSEMBLY,
  listOnshapeAssemblyInstances,
  parseListedInstances,
  rejectDemoInstanceId,
} from "./list-assembly";

const ORG = "11111111-1111-4111-8111-111111111111";
const JOB = "00000000-0000-0000-0000-0000000000aa";
const DOCUMENT = {
  documentId: "d1",
  workspaceId: "w1",
  elementId: "e1",
};
const LIVE = [{ id: "Mabc", name: "Plate <1>" }];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rejectDemoInstanceId", () => {
  it("keeps a real id and refuses DEMO", () => {
    expect(rejectDemoInstanceId("Mabc")).toBe("Mabc");
    expect(rejectDemoInstanceId("  Mdef  ")).toBe("Mdef");
    expect(rejectDemoInstanceId("")).toBe("");
    expect(() => rejectDemoInstanceId("DEMO-instance")).toThrow(/DEMO instance id/i);
    expect(() => rejectDemoInstanceId("demo-wheel")).toThrow(/DEMO instance id/i);
  });
});

describe("parseListedInstances", () => {
  it("reads only ids Onshape already returned", () => {
    expect(
      parseListedInstances({
        instances: LIVE,
        assemblyElementId: "asm-real",
        documentRef: DOCUMENT,
        authPath: "oauth",
      }),
    ).toEqual({
      instances: LIVE,
      assemblyElementId: "asm-real",
    });
  });

  it("stays empty when Onshape sent no instances", () => {
    expect(parseListedInstances({})).toEqual(EMPTY_LISTED_ASSEMBLY);
    expect(parseListedInstances(null)).toEqual(EMPTY_LISTED_ASSEMBLY);
    expect(parseListedInstances({ instances: [] })).toEqual(EMPTY_LISTED_ASSEMBLY);
    expect(JSON.stringify(parseListedInstances({}))).not.toMatch(/DEMO/i);
  });

  it("refuses DEMO instance ids and assembly element ids", () => {
    expect(() => parseListedInstances({ instances: [{ id: "DEMO-instance", name: "Plate" }] })).toThrow(
      /DEMO instance id/i,
    );
    expect(() => parseListedInstances({ instances: [], assemblyElementId: "DEMO" })).toThrow(
      /DEMO assembly element/i,
    );
  });
});

describe("listOnshapeAssemblyInstances", () => {
  it("POSTs list-onshape-assembly and returns ids Onshape already listed", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      expect(body?.action).toBe("list-onshape-assembly");
      expect(body?.orgId).toBe(ORG);
      expect(body?.documentRef).toEqual(DOCUMENT);
      return Response.json({
        instances: LIVE,
        documentRef: DOCUMENT,
        assemblyElementId: "asm-real",
        authPath: "oauth",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listOnshapeAssemblyInstances({ orgId: ORG, documentRef: DOCUMENT })).resolves.toEqual({
      instances: LIVE,
      assemblyElementId: "asm-real",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/DEMO/i);
  });

  it("forwards assemblyElementId when the caller overrides the bound element", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      expect(body).toEqual({
        action: "list-onshape-assembly",
        orgId: ORG,
        documentRef: DOCUMENT,
        assemblyElementId: "asm-real",
      });
      return Response.json({ instances: LIVE, assemblyElementId: "asm-real" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listOnshapeAssemblyInstances({ orgId: ORG, documentRef: DOCUMENT, assemblyElementId: "asm-real" }),
    ).resolves.toEqual({ instances: LIVE, assemblyElementId: "asm-real" });
  });

  it("can list from a bound job without inventing a document ref", async () => {
    const fetchMock = vi.fn(async () => Response.json({ instances: LIVE, assemblyElementId: "asm-job" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listOnshapeAssemblyInstances({ orgId: ORG, jobId: JOB })).resolves.toEqual({
      instances: LIVE,
      assemblyElementId: "asm-job",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toEqual({ action: "list-onshape-assembly", orgId: ORG, jobId: JOB });
    expect(body).not.toHaveProperty("documentRef");
  });

  it("requires a bound document or job", async () => {
    await expect(listOnshapeAssemblyInstances({ orgId: ORG })).rejects.toThrow(/Bind an Onshape document/i);
  });

  it("refuses a DEMO assembly element override before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      listOnshapeAssemblyInstances({ orgId: ORG, documentRef: DOCUMENT, assemblyElementId: "DEMO" }),
    ).rejects.toThrow(/DEMO assembly element/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a DEMO payload from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ instances: [{ id: "DEMO-1", name: "Fake" }] })),
    );
    await expect(listOnshapeAssemblyInstances({ orgId: ORG, documentRef: DOCUMENT })).rejects.toThrow(
      /DEMO instance id/i,
    );
  });
});
