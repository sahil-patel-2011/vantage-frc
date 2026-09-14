import { describe, expect, it, vi } from "vitest";
import {
  addOnshapeAssemblyInstance,
  createOnshapeAssembly,
  annotateOnshapeDrawing,
  createOnshapeDrawing,
  createOnshapeDrawingViews,
  createOnshapeMate,
  createOnshapePartStudio,
  getOnshapeBodyDetails,
  onshapeMateConnectorFeature,
  onshapeMateFeature,
  summarizeOnshapeBodyDetails,
  type OnshapeNativeHttp,
} from "../src/onshape-assemblies";

describe("native Onshape part and assembly payloads", () => {
  it("creates Part Studio and Assembly elements without FeatureScript", async () => {
    const paths: string[] = [];
    const http: OnshapeNativeHttp = vi.fn(async (path) => {
      paths.push(path);
      return Response.json({ id: path.includes("partstudios") ? "ps-1" : "asm-1" });
    });

    await expect(
      createOnshapePartStudio(http, { documentId: "d1", workspaceId: "w1", name: "Plate" }),
    ).resolves.toEqual({ elementId: "ps-1", name: "Plate" });
    await expect(
      createOnshapeAssembly(http, { documentId: "d1", workspaceId: "w1", name: "Intake" }),
    ).resolves.toEqual({ elementId: "asm-1", name: "Intake" });
    expect(paths).toEqual([
      "/partstudios/d/d1/w/w1",
      "/assemblies/d/d1/w/w1",
    ]);
  });

  it("creates a Drawing tab without inventing an element id", async () => {
    const paths: string[] = [];
    const http: OnshapeNativeHttp = vi.fn(async (path) => {
      paths.push(path);
      return Response.json({ id: "drw-1" });
    });
    await expect(
      createOnshapeDrawing(http, { documentId: "d1", workspaceId: "w1", name: "Detail drawing" }),
    ).resolves.toEqual({ elementId: "drw-1", name: "Detail drawing" });
    expect(paths).toEqual(["/drawings/d/d1/w/w1"]);
    const failing: OnshapeNativeHttp = vi.fn(async () => new Response("no drawing", { status: 400 }));
    await expect(
      createOnshapeDrawing(failing, { documentId: "d1", workspaceId: "w1", name: "Detail drawing" }),
    ).rejects.toThrow(/Create Drawing failed \(HTTP 400\)/);
  });

  it("adds drawing views and labels without inventing ids", async () => {
    const paths: string[] = [];
    const http: OnshapeNativeHttp = vi.fn(async (path) => {
      paths.push(path);
      return Response.json({ id: "drw-1" });
    });
    await expect(
      createOnshapeDrawingViews(http, {
        documentId: "d1",
        workspaceId: "w1",
        elementId: "drw-1",
        views: ["front", "top"],
      }),
    ).resolves.toEqual({ elementId: "drw-1", views: ["front", "top"] });
    await expect(
      annotateOnshapeDrawing(http, {
        documentId: "d1",
        workspaceId: "w1",
        elementId: "drw-1",
        notes: ["Width: 80 mm"],
        callouts: [{ label: "Width", valueMm: 80, view: "front" }],
      }),
    ).resolves.toMatchObject({ elementId: "drw-1", notes: ["Width: 80 mm"] });
    expect(paths).toEqual([
      "/drawings/d/d1/w/w1/e/drw-1/views",
      "/drawings/d/d1/w/w1/e/drw-1/annotations",
    ]);
    const failing: OnshapeNativeHttp = vi.fn(async () => new Response("no labels", { status: 400 }));
    await expect(
      annotateOnshapeDrawing(failing, {
        documentId: "d1",
        workspaceId: "w1",
        elementId: "drw-1",
        notes: ["Width: 80 mm"],
        callouts: [],
      }),
    ).rejects.toThrow(/Label Drawing failed \(HTTP 400\)/);
  });

  it("reads native body details and inserts a specific part", async () => {
    const calls: Array<{ path: string; body?: unknown }> = [];
    const http: OnshapeNativeHttp = vi.fn(async (path, init) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return path.endsWith("/bodydetails")
        ? Response.json({ bodies: [{ id: "part-1", faces: [{ id: "face-1" }] }] })
        : Response.json({ id: "instance-1" });
    });
    const details = await getOnshapeBodyDetails(http, {
      documentId: "d1",
      workspaceId: "w1",
      elementId: "ps-1",
    });
    const inserted = await addOnshapeAssemblyInstance(http, {
      assembly: { documentId: "d1", workspaceId: "w1", elementId: "asm-1" },
      sourceElementId: "ps-1",
      partId: "part-1",
    });

    expect(details).toMatchObject({ bodies: [{ id: "part-1" }] });
    expect(summarizeOnshapeBodyDetails(details)).toEqual([
      { partId: "part-1", bodyType: "", faces: [{ faceId: "face-1", surfaceType: "" }] },
    ]);
    expect(inserted.instanceId).toBe("instance-1");
    expect(calls[1]).toMatchObject({
      path: "/assemblies/d/d1/w/w1/e/asm-1/instances",
      body: {
        documentId: "d1",
        elementId: "ps-1",
        partId: "part-1",
        isAssembly: false,
        isWholePartStudio: false,
      },
    });
  });

  it("builds native face-centred connectors and motion limits", () => {
    const connector = onshapeMateConnectorFeature({
      name: "A",
      instanceId: "instance-a",
      faceId: "face-a",
      offsetZMm: 5,
    });
    const mate = onshapeMateFeature({
      name: "Pivot",
      mateType: "REVOLUTE",
      firstConnectorId: "mc-a",
      secondConnectorId: "mc-b",
      minLimit: -45,
      maxLimit: 90,
    });

    expect(connector.feature.btType).toBe("BTMMateConnector-66");
    expect(JSON.stringify(connector)).toContain("face-a");
    expect(JSON.stringify(connector)).toContain("0.005 m");
    expect(mate.feature.btType).toBe("BTMMate-64");
    expect(JSON.stringify(mate)).toContain("limitAxialZMin");
    expect(JSON.stringify(mate)).toContain("rad");
  });

  it("creates two connectors and a mate through native Assembly endpoints", async () => {
    const payloads: unknown[] = [];
    const ids = ["mc-a", "mc-b", "mate-1"];
    const http: OnshapeNativeHttp = vi.fn(async (_path, init) => {
      payloads.push(JSON.parse(String(init?.body)));
      return Response.json({ featureId: ids[payloads.length - 1] });
    });

    const result = await createOnshapeMate(http, {
      assembly: { documentId: "d1", workspaceId: "w1", elementId: "asm-1" },
      mateType: "FASTENED",
      firstInstanceId: "instance-a",
      secondInstanceId: "instance-b",
      firstFaceId: "face-a",
      secondFaceId: "face-b",
    });

    expect(result).toEqual({
      firstConnectorFeatureId: "mc-a",
      secondConnectorFeatureId: "mc-b",
      mateFeatureId: "mate-1",
    });
    expect(payloads).toHaveLength(3);
    expect(JSON.stringify(payloads[2])).toContain("FASTENED");
  });

  it("removes its partial connector when mate construction fails", async () => {
    const methods: string[] = [];
    let posts = 0;
    const http: OnshapeNativeHttp = vi.fn(async (_path, init) => {
      methods.push(String(init?.method ?? "GET"));
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      posts += 1;
      return posts === 1
        ? Response.json({ featureId: "mc-a" })
        : Response.json({ message: "invalid face" }, { status: 400 });
    });

    await expect(
      createOnshapeMate(http, {
        assembly: { documentId: "d1", workspaceId: "w1", elementId: "asm-1" },
        mateType: "FASTENED",
        firstInstanceId: "instance-a",
        secondInstanceId: "instance-b",
        firstFaceId: "face-a",
        secondFaceId: "bad-face",
      }),
    ).rejects.toThrow(/invalid face/);
    expect(methods).toEqual(["POST", "POST", "DELETE"]);
  });
});
