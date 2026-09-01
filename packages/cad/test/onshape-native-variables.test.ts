import { describe, expect, it, vi } from "vitest";
import {
  inferOnshapeVariableType,
  listOnshapeNativeVariables,
  onshapeVariablesPath,
  parseOnshapeVariables,
  pickVariableStudioElementId,
  requireOnshapeVariableExpression,
  requireOnshapeVariableName,
  setOnshapeNativeVariable,
  type OnshapeNativeVariablesHttp,
} from "../src/onshape-native-variables";

const DOCUMENT = { documentId: "d1", workspaceId: "w1", elementId: "vs1" };
const VARIABLES_PATH = "/variables/d/d1/w/w1/e/vs1/variables";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function captureHttp(handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const http = vi.fn(async (path: string, init?: RequestInit) => {
    let body: unknown = null;
    if (typeof init?.body === "string" && init.body) {
      body = JSON.parse(init.body);
    }
    calls.push({ path, method: (init?.method ?? "GET").toUpperCase(), body });
    return handler(path, init);
  }) as unknown as OnshapeNativeVariablesHttp;
  return { http, calls };
}

function tables(variables: Array<{ name: string; expression: string; type: string }>) {
  return [{ variables }];
}

describe("onshapeVariablesPath", () => {
  it("targets the Variables REST path, not FeatureScript or partstudio features", () => {
    expect(onshapeVariablesPath(DOCUMENT)).toBe(VARIABLES_PATH);
    expect(onshapeVariablesPath(DOCUMENT)).not.toContain("featurescript");
    expect(onshapeVariablesPath(DOCUMENT)).not.toContain("/features");
  });

  it("refuses a missing document ref instead of guessing", () => {
    expect(() => onshapeVariablesPath({ ...DOCUMENT, elementId: "  " })).toThrow(/elementId is required/i);
  });
});

describe("requireOnshapeVariableName / expression", () => {
  it("accepts a real identifier", () => {
    expect(requireOnshapeVariableName("wallThickness")).toBe("wallThickness");
    expect(requireOnshapeVariableExpression("2 mm")).toBe("2 mm");
  });

  it("refuses a blank name without calling Onshape", () => {
    expect(() => requireOnshapeVariableName("")).toThrow(/requires a variable name/i);
    expect(() => requireOnshapeVariableName("   ")).toThrow(/requires a variable name/i);
    expect(() => requireOnshapeVariableName(undefined)).toThrow(/requires a variable name/i);
  });

  it("refuses DEMO names and values without calling Onshape", () => {
    expect(() => requireOnshapeVariableName("DEMO")).toThrow(/DEMO/i);
    expect(() => requireOnshapeVariableName("demoWidth")).toThrow(/DEMO/i);
    expect(() => requireOnshapeVariableExpression("DEMO")).toThrow(/DEMO/i);
    expect(() => requireOnshapeVariableExpression("demo-1")).toThrow(/DEMO/i);
  });

  it("refuses a blank expression", () => {
    expect(() => requireOnshapeVariableExpression("")).toThrow(/requires a value\/expression/i);
    expect(() => requireOnshapeVariableExpression("   ")).toThrow(/requires a value\/expression/i);
    expect(() => requireOnshapeVariableExpression(undefined)).toThrow(/requires a value\/expression/i);
  });
});

describe("inferOnshapeVariableType", () => {
  it("maps units and honors an explicit type", () => {
    expect(inferOnshapeVariableType("2 mm")).toBe("LENGTH");
    expect(inferOnshapeVariableType("0.5 in")).toBe("LENGTH");
    expect(inferOnshapeVariableType("45 deg")).toBe("ANGLE");
    expect(inferOnshapeVariableType("3")).toBe("NUMBER");
    expect(inferOnshapeVariableType("#other + 1")).toBe("ANY");
    expect(inferOnshapeVariableType("2 mm", "NUMBER")).toBe("NUMBER");
  });
});

describe("parseOnshapeVariables", () => {
  it("reads name/expression/type from Variable Studio tables", () => {
    expect(
      parseOnshapeVariables(
        tables([
          { name: "wallThickness", expression: "2 mm", type: "LENGTH" },
          { name: "count", expression: "4", type: "NUMBER" },
        ]),
      ),
    ).toEqual([
      { name: "wallThickness", expression: "2 mm", type: "LENGTH" },
      { name: "count", expression: "4", type: "NUMBER" },
    ]);
  });

  it("returns an empty list when Onshape sends no variables — never invents names", () => {
    expect(parseOnshapeVariables([])).toEqual([]);
    expect(parseOnshapeVariables({ variables: [] })).toEqual([]);
    expect(parseOnshapeVariables(null)).toEqual([]);
  });

  it("skips blank and DEMO names Onshape should never have stored", () => {
    expect(
      parseOnshapeVariables(
        tables([
          { name: "", expression: "1 mm", type: "LENGTH" },
          { name: "DEMO", expression: "1 mm", type: "LENGTH" },
          { name: "holeDia", expression: "5 mm", type: "LENGTH" },
        ]),
      ),
    ).toEqual([{ name: "holeDia", expression: "5 mm", type: "LENGTH" }]);
  });
});

describe("pickVariableStudioElementId", () => {
  it("picks a VARIABLESTUDIO tab Onshape already listed", () => {
    expect(
      pickVariableStudioElementId([
        { id: "ps1", elementType: "PARTSTUDIO" },
        { id: "vs-real", elementType: "VARIABLESTUDIO" },
      ]),
    ).toBe("vs-real");
  });

  it("honors a preferred studio id that Onshape listed and stays empty otherwise", () => {
    const elements = [
      { id: "vs-a", elementType: "VARIABLESTUDIO" },
      { id: "vs-b", elementType: "VARIABLESTUDIO" },
    ];
    expect(pickVariableStudioElementId(elements, "vs-b")).toBe("vs-b");
    expect(pickVariableStudioElementId([{ id: "ps1", elementType: "PARTSTUDIO" }])).toBe("");
    expect(() => pickVariableStudioElementId(elements, "DEMO")).toThrow(/DEMO Variable Studio/i);
  });
});

describe("listOnshapeNativeVariables", () => {
  it("GETs the Variables REST and never FeatureScript", async () => {
    const { http, calls } = captureHttp(() =>
      jsonResponse(tables([{ name: "wallThickness", expression: "2 mm", type: "LENGTH" }])),
    );
    await expect(listOnshapeNativeVariables(http, DOCUMENT)).resolves.toEqual([
      { name: "wallThickness", expression: "2 mm", type: "LENGTH" },
    ]);
    expect(calls).toEqual([{ path: VARIABLES_PATH, method: "GET", body: null }]);
    expect(JSON.stringify(calls)).not.toMatch(/featurescript|opAssignVariable/i);
  });
});

describe("setOnshapeNativeVariable", () => {
  it("GET then POST Variables REST and returns the name Onshape stored", async () => {
    const stored = tables([{ name: "wallThickness", expression: "2 mm", type: "LENGTH" }]);
    const { http, calls } = captureHttp((path, init) => {
      if (path === VARIABLES_PATH && (init?.method ?? "GET").toUpperCase() === "GET") {
        return jsonResponse(stored);
      }
      if (path === VARIABLES_PATH && init?.method === "POST") {
        return jsonResponse({});
      }
      return jsonResponse({ message: `unexpected ${init?.method ?? "GET"} ${path}` }, 404);
    });

    const result = await setOnshapeNativeVariable(http, {
      document: DOCUMENT,
      parameters: { name: "wallThickness", value: "2 mm" },
      idempotencyKey: "job:1:var",
    });

    expect(result).toEqual({
      featureId: "wallThickness",
      name: "wallThickness",
      expression: "2 mm",
      type: "LENGTH",
      featureScriptUsed: false,
    });
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST", "GET"]);
    expect(calls.every((call) => call.path === VARIABLES_PATH)).toBe(true);
    expect(calls[1]?.body).toEqual([{ name: "wallThickness", type: "LENGTH", expression: "2 mm" }]);
    expect(calls.some((call) => call.path.includes("featurescript"))).toBe(false);
    expect(JSON.stringify(calls)).not.toMatch(/featurescript|opAssignVariable|assignVariable/i);
  });

  it("reuses the existing Variable Studio type when updating an expression", async () => {
    let posted: unknown = null;
    const { http } = captureHttp((path, init) => {
      if ((init?.method ?? "GET").toUpperCase() === "GET") {
        return jsonResponse(tables([{ name: "count", expression: posted ? "6" : "4", type: "NUMBER" }]));
      }
      posted = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      return jsonResponse({});
    });

    const result = await setOnshapeNativeVariable(http, {
      document: DOCUMENT,
      parameters: { name: "count", expression: "6" },
      idempotencyKey: "job:1:count",
    });
    expect(result.type).toBe("NUMBER");
    expect(result.expression).toBe("6");
    expect(posted).toEqual([{ name: "count", type: "NUMBER", expression: "6" }]);
  });

  it("POSTs to a Variable Studio element override, not the bound Part Studio", async () => {
    const studioPath = "/variables/d/d1/w/w1/e/studio-real/variables";
    const { http, calls } = captureHttp((path, init) => {
      if (path === studioPath && (init?.method ?? "GET").toUpperCase() === "GET") {
        return jsonResponse(tables([{ name: "clearance", expression: "0.5 mm", type: "LENGTH" }]));
      }
      if (path === studioPath && init?.method === "POST") {
        return jsonResponse({});
      }
      return jsonResponse({ message: `unexpected ${path}` }, 404);
    });

    await setOnshapeNativeVariable(http, {
      document: { documentId: "d1", workspaceId: "w1", elementId: "partstudio-1" },
      parameters: { name: "clearance", value: "0.5 mm", variableStudioElementId: "studio-real" },
      idempotencyKey: "job:1:studio",
    });
    expect(calls.every((call) => call.path === studioPath)).toBe(true);
    expect(calls.some((call) => call.path.includes("partstudio-1"))).toBe(false);
  });

  it("refuses a blank name without calling Onshape", async () => {
    const { http, calls } = captureHttp(() => jsonResponse({ message: "should not run" }, 500));
    await expect(
      setOnshapeNativeVariable(http, {
        document: DOCUMENT,
        parameters: { name: "  ", value: "2 mm" },
        idempotencyKey: "job:1:blank",
      }),
    ).rejects.toThrow(/requires a variable name/i);
    expect(calls).toHaveLength(0);
  });

  it("refuses DEMO name and value without calling Onshape", async () => {
    const { http, calls } = captureHttp(() => jsonResponse({ message: "should not run" }, 500));
    await expect(
      setOnshapeNativeVariable(http, {
        document: DOCUMENT,
        parameters: { name: "DEMO", value: "2 mm" },
        idempotencyKey: "job:1:demo-name",
      }),
    ).rejects.toThrow(/DEMO/i);
    await expect(
      setOnshapeNativeVariable(http, {
        document: DOCUMENT,
        parameters: { name: "wallThickness", value: "DEMO" },
        idempotencyKey: "job:1:demo-value",
      }),
    ).rejects.toThrow(/DEMO/i);
    expect(calls).toHaveLength(0);
  });

  it("does not invent a name when Onshape rejects the POST", async () => {
    const { http } = captureHttp((path, init) => {
      if ((init?.method ?? "GET").toUpperCase() === "GET") {
        return jsonResponse([]);
      }
      return jsonResponse({ message: "not a Variable Studio" }, 400);
    });
    await expect(
      setOnshapeNativeVariable(http, {
        document: DOCUMENT,
        parameters: { name: "wallThickness", value: "2 mm" },
        idempotencyKey: "job:1:reject",
      }),
    ).rejects.toThrow(/not a Variable Studio/);
  });

  it("does not invent a name when GET-after-POST omits the variable", async () => {
    let posts = 0;
    const { http } = captureHttp((_path, init) => {
      if (init?.method === "POST") {
        posts += 1;
        return jsonResponse({});
      }
      return jsonResponse([]);
    });
    await expect(
      setOnshapeNativeVariable(http, {
        document: DOCUMENT,
        parameters: { name: "wallThickness", value: "2 mm" },
        idempotencyKey: "job:1:noid",
      }),
    ).rejects.toThrow(/did not return variable/i);
    expect(posts).toBe(1);
  });

  it("does not invent a name when GET tables fail", async () => {
    const { http } = captureHttp(() => jsonResponse({ message: "element missing" }, 404));
    await expect(
      setOnshapeNativeVariable(http, {
        document: DOCUMENT,
        parameters: { name: "wallThickness", value: "2 mm" },
        idempotencyKey: "job:1:get-fail",
      }),
    ).rejects.toThrow(/element missing/);
  });
});
