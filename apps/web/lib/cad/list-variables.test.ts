import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_LISTED_VARIABLES,
  listOnshapeVariables,
  parseListedVariables,
  rejectDemoVariableName,
} from "./list-variables";

const ORG = "11111111-1111-4111-8111-111111111111";
const DOCUMENT = {
  documentId: "d1",
  workspaceId: "w1",
  elementId: "e1",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rejectDemoVariableName", () => {
  it("keeps a real name and refuses DEMO", () => {
    expect(rejectDemoVariableName("wallThickness")).toBe("wallThickness");
    expect(rejectDemoVariableName("")).toBe("");
    expect(() => rejectDemoVariableName("DEMO")).toThrow(/DEMO variable name/i);
    expect(() => rejectDemoVariableName("demoWidth")).toThrow(/DEMO variable name/i);
  });
});

describe("parseListedVariables", () => {
  it("reads only names Onshape already returned", () => {
    expect(
      parseListedVariables({
        variables: [{ name: "wallThickness", expression: "2 mm", type: "LENGTH" }],
        variableStudioElementId: "vs-real",
      }),
    ).toEqual({
      variables: [{ name: "wallThickness", expression: "2 mm", type: "LENGTH" }],
      variableStudioElementId: "vs-real",
    });
  });

  it("stays empty when Onshape sent no tables", () => {
    expect(parseListedVariables({})).toEqual(EMPTY_LISTED_VARIABLES);
    expect(parseListedVariables(null)).toEqual(EMPTY_LISTED_VARIABLES);
    expect(parseListedVariables({ variables: [] })).toEqual(EMPTY_LISTED_VARIABLES);
  });

  it("refuses DEMO names and studio ids", () => {
    expect(() => parseListedVariables({ variables: [{ name: "DEMO", expression: "2 mm" }] })).toThrow(
      /DEMO variable name/i,
    );
    expect(() => parseListedVariables({ variables: [], variableStudioElementId: "DEMO" })).toThrow(
      /DEMO Variable Studio/i,
    );
  });
});

describe("listOnshapeVariables", () => {
  it("POSTs list-onshape-variables and returns ids Onshape already listed", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      expect(body?.action).toBe("list-onshape-variables");
      expect(body?.orgId).toBe(ORG);
      expect(body?.documentRef).toEqual(DOCUMENT);
      return Response.json({
        variables: [{ name: "clearance", expression: "0.5 mm", type: "LENGTH" }],
        variableStudioElementId: "vs-real",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listOnshapeVariables({ orgId: ORG, documentRef: DOCUMENT })).resolves.toEqual({
      variables: [{ name: "clearance", expression: "0.5 mm", type: "LENGTH" }],
      variableStudioElementId: "vs-real",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("requires a bound document or job", async () => {
    await expect(listOnshapeVariables({ orgId: ORG })).rejects.toThrow(/Bind an Onshape document/i);
  });

  it("refuses a DEMO Variable Studio override before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      listOnshapeVariables({ orgId: ORG, documentRef: DOCUMENT, variableStudioElementId: "DEMO" }),
    ).rejects.toThrow(/DEMO Variable Studio/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
