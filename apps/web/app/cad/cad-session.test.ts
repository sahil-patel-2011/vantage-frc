import { describe, expect, it } from "vitest";
import {
  assemblyStorageKey,
  asParamRecord,
  checkpointIdFromExecute,
  firstRememberedId,
  onshapeTabUrl,
  realReturnedId,
  rememberLastAssemblyElementId,
  rememberLastInstanceIds,
  withLastAssemblyElementId,
  withLastInstanceIds,
  withVariableStudio,
} from "./cad-session";

describe("cad-session", () => {
  it("rejects DEMO, blank, and non-string returned ids", () => {
    expect(realReturnedId("DEMO-plate")).toBeUndefined();
    expect(realReturnedId("demo-extrude")).toBeUndefined();
    expect(realReturnedId("  ")).toBeUndefined();
    expect(realReturnedId("")).toBeUndefined();
    expect(realReturnedId(null)).toBeUndefined();
    expect(realReturnedId(12)).toBeUndefined();
    expect(realReturnedId("FWx/real-extrude-1")).toBe("FWx/real-extrude-1");
  });

  it("does not invent assemblyElementId when the last id is missing or DEMO", () => {
    const parameters = { instanceName: "plate" };
    expect(withLastAssemblyElementId("add_assembly_instance", parameters, undefined)).toEqual(parameters);
    expect(withLastAssemblyElementId("create_sketch", parameters, "el-1")).toEqual(parameters);
    expect(withLastAssemblyElementId("add_assembly_instance", parameters, "el-real")).toEqual({
      ...parameters,
      assemblyElementId: "el-real",
    });
    expect(withLastAssemblyElementId("create_mate", { assemblyElementId: "already" }, "el-real")).toEqual({
      assemblyElementId: "already",
    });
    expect(JSON.stringify(withLastAssemblyElementId("add_assembly_instance", parameters, undefined))).not.toMatch(
      /demo/i,
    );
  });

  it("remembers create_assembly ids from featureId or result.elementId, never DEMO", () => {
    expect(
      rememberLastAssemblyElementId("create_assembly", { featureId: "DEMO-asm" }, undefined),
    ).toBeUndefined();
    expect(
      rememberLastAssemblyElementId(
        "create_assembly",
        { featureId: "DEMO-plate", result: { elementId: "el-real" } },
        undefined,
      ),
    ).toBe("el-real");
    expect(
      rememberLastAssemblyElementId("create_mate", { featureId: "el-ignored" }, "el-keep"),
    ).toBe("el-keep");
  });

  it("fills blank create_mate instance ids from remembered add_assembly_instance ids", () => {
    expect(withLastInstanceIds("create_sketch", { firstInstanceId: "" }, ["a", "b"])).toEqual({
      firstInstanceId: "",
    });
    expect(withLastInstanceIds("create_mate", { firstInstanceId: "kept", secondInstanceId: "kept2" }, ["a", "b"])).toEqual({
      firstInstanceId: "kept",
      secondInstanceId: "kept2",
    });
    expect(withLastInstanceIds("create_mate", {}, ["inst-1", "inst-2"])).toEqual({
      firstInstanceId: "inst-1",
      secondInstanceId: "inst-2",
    });
    expect(rememberLastInstanceIds("add_assembly_instance", { featureId: "DEMO-i" }, [])).toEqual([]);
    expect(rememberLastInstanceIds("add_assembly_instance", { featureId: "inst-1" }, [])).toEqual(["inst-1"]);
  });

  it("passes a Variable Studio id into set_variable only when the payload left it blank", () => {
    expect(withVariableStudio({ operation: "create_sketch", parameters: {} }, "vs-1")).toEqual({
      operation: "create_sketch",
      parameters: {},
    });
    expect(withVariableStudio({ operation: "set_variable", parameters: { name: "w" } }, "vs-1")).toEqual({
      operation: "set_variable",
      parameters: { name: "w", variableStudioElementId: "vs-1" },
    });
    expect(
      withVariableStudio(
        { operation: "set_variable", parameters: { name: "w", variableStudioElementId: "vs-kept" } },
        "vs-other",
      ),
    ).toEqual({
      operation: "set_variable",
      parameters: { name: "w", variableStudioElementId: "vs-kept" },
    });
  });

  it("reads a real execute checkpoint id / checkpointRef and never invents DEMO", () => {
    expect(checkpointIdFromExecute({})).toBeUndefined();
    expect(checkpointIdFromExecute({ result: { checkpointId: "cp-1" } })).toBe("cp-1");
    expect(checkpointIdFromExecute({ result: { checkpointRef: "ref-1" } })).toBe("ref-1");
    expect(checkpointIdFromExecute({ result: { output: { checkpointId: "out-1" } } })).toBe("out-1");
    expect(asParamRecord(null)).toEqual({});
    expect(firstRememberedId(["", "  ", "id-2"])).toBe("id-2");
    expect(assemblyStorageKey("org-1", "doc-1")).toBe("vantage-cad-assembly:org-1:doc-1");
    expect(onshapeTabUrl("doc", "ws", "el")).toBe("https://cad.onshape.com/documents/doc/w/ws/e/el");
  });
});
