import { describe, expect, it, vi } from "vitest";
import { onshapeAssemblyPath, type OnshapeNativeHttp } from "../src/onshape-assemblies";
import {
  listOnshapeAssemblyInstances,
  parseOnshapeAssemblyInstances,
} from "../src/onshape-assembly-list";

const REF = { documentId: "d1", workspaceId: "w1", elementId: "asm-1" };

describe("parseOnshapeAssemblyInstances", () => {
  it("returns empty when the payload has no instances", () => {
    expect(parseOnshapeAssemblyInstances(null)).toEqual([]);
    expect(parseOnshapeAssemblyInstances(undefined)).toEqual([]);
    expect(parseOnshapeAssemblyInstances({})).toEqual([]);
    expect(parseOnshapeAssemblyInstances({ rootAssembly: {} })).toEqual([]);
    expect(parseOnshapeAssemblyInstances({ rootAssembly: { instances: [] }, instances: [] })).toEqual([]);
    expect(JSON.stringify(parseOnshapeAssemblyInstances({}))).not.toMatch(/DEMO/i);
  });

  it("keeps real instance ids and names from rootAssembly.instances", () => {
    expect(
      parseOnshapeAssemblyInstances({
        rootAssembly: {
          instances: [
            { id: "Mabc", name: "Plate <1>" },
            { id: "Mdef", name: "Wheel" },
          ],
        },
      }),
    ).toEqual([
      { id: "Mabc", name: "Plate <1>" },
      { id: "Mdef", name: "Wheel" },
    ]);
  });

  it("also walks a top-level instances array and de-duplicates", () => {
    expect(
      parseOnshapeAssemblyInstances({
        rootAssembly: { instances: [{ id: "Mabc", name: "Plate" }] },
        instances: [
          { id: "Mabc", name: "Plate again" },
          { instanceId: "Mghi", name: "Spacer" },
        ],
      }),
    ).toEqual([
      { id: "Mabc", name: "Plate" },
      { id: "Mghi", name: "Spacer" },
    ]);
  });

  it("skips blank ids and does not invent tokens", () => {
    expect(
      parseOnshapeAssemblyInstances({
        rootAssembly: {
          instances: [{ name: "unnamed" }, { id: "  " }, { id: "Mabc", name: "  Plate  " }],
        },
      }),
    ).toEqual([{ id: "Mabc", name: "Plate" }]);
  });

  it("refuses DEMO instance ids", () => {
    expect(() =>
      parseOnshapeAssemblyInstances({
        rootAssembly: { instances: [{ id: "DEMO-instance", name: "Plate" }] },
      }),
    ).toThrow(/DEMO instance id/i);
    expect(() =>
      parseOnshapeAssemblyInstances({
        instances: [{ id: "demo-wheel", name: "Wheel" }],
      }),
    ).toThrow(/DEMO instance id/i);
  });
});

describe("listOnshapeAssemblyInstances", () => {
  it("calls getOnshapeAssembly then parses instances — no FeatureScript", async () => {
    const calls: string[] = [];
    const http: OnshapeNativeHttp = vi.fn(async (path) => {
      calls.push(path);
      return Response.json({
        rootAssembly: { instances: [{ id: "Mabc", name: "Plate <1>" }] },
      });
    });

    await expect(listOnshapeAssemblyInstances(http, REF)).resolves.toEqual([
      { id: "Mabc", name: "Plate <1>" },
    ]);
    expect(calls).toEqual([`${onshapeAssemblyPath(REF)}?includeMateFeatures=true`]);
    expect(calls.some((path) => /featurescript/i.test(path))).toBe(false);
  });

  it("returns empty when Onshape listed no instances", async () => {
    const http: OnshapeNativeHttp = vi.fn(async () => Response.json({ rootAssembly: { instances: [] } }));
    await expect(listOnshapeAssemblyInstances(http, REF)).resolves.toEqual([]);
  });

  it("refuses a DEMO payload from Onshape", async () => {
    const http: OnshapeNativeHttp = vi.fn(async () =>
      Response.json({ rootAssembly: { instances: [{ id: "DEMO-1", name: "Fake" }] } }),
    );
    await expect(listOnshapeAssemblyInstances(http, REF)).rejects.toThrow(/DEMO instance id/i);
  });
});
