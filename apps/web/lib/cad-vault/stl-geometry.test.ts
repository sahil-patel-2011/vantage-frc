import { describe, expect, it } from "vitest";
import {
  StlParseError,
  StlTooLargeError,
  computeStlGeometry,
  parseStl,
  summarizeTriangles,
} from "./stl-geometry";

type Tri = [number, number, number, number, number, number, number, number, number];

function buildBinaryStl(triangles: Tri[]): Uint8Array {
  const bytes = new Uint8Array(84 + triangles.length * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((tri, index) => {
    const base = 84 + index * 50 + 12; // 12-byte normal left as zeros
    tri.forEach((value, f) => view.setFloat32(base + f * 4, value, true));
  });
  return bytes;
}

/** Unit cube (12 triangles) with outward-facing winding. */
function unitCube(): Tri[] {
  const tris: Tri[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    tris.push([...a, ...b, ...c] as Tri, [...a, ...c, ...d] as Tri);
  };
  quad([0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]); // z=0, normal -z
  quad([0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]); // z=1, normal +z
  quad([0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]); // y=0, normal -y
  quad([0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]); // y=1, normal +y
  quad([0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]); // x=0, normal -x
  quad([1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]); // x=1, normal +x
  return tris;
}

describe("binary STL geometry", () => {
  it("computes volume 1, area 6, and the bounding box of a unit cube", () => {
    const summary = computeStlGeometry(buildBinaryStl(unitCube()));
    expect(summary.triangleCount).toBe(12);
    expect(summary.volume).toBeCloseTo(1, 5);
    expect(summary.surfaceArea).toBeCloseTo(6, 5);
    expect(summary.boundingBox.min).toEqual([0, 0, 0]);
    expect(summary.boundingBox.max).toEqual([1, 1, 1]);
    expect(summary.degenerateTriangleCount).toBe(0);
    expect(summary.units).toBe("unknown");
  });

  it("volume is translation-invariant thanks to the signed-tetrahedron sum", () => {
    const shifted = unitCube().map(
      (tri) => tri.map((value, index) => value + (index % 3 === 0 ? 40 : index % 3 === 1 ? -7 : 12)) as Tri,
    );
    const summary = computeStlGeometry(buildBinaryStl(shifted));
    expect(summary.volume).toBeCloseTo(1, 3);
  });

  it("counts degenerate (zero-area) triangles without adding their area", () => {
    const tris = unitCube();
    tris.push([5, 5, 5, 5, 5, 5, 5, 5, 5]); // collapsed point
    const summary = computeStlGeometry(buildBinaryStl(tris));
    expect(summary.degenerateTriangleCount).toBe(1);
    expect(summary.surfaceArea).toBeCloseTo(6, 5);
  });
});

describe("ASCII STL parsing", () => {
  it("parses vertices from ASCII facets", () => {
    const text = `solid tri
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid tri
`;
    const triangles = parseStl(new TextEncoder().encode(text));
    expect(triangles.length).toBe(9);
    const summary = summarizeTriangles(triangles);
    expect(summary.surfaceArea).toBeCloseTo(0.5, 6);
  });

  it("throws a parse error on an incomplete facet", () => {
    const text = "solid bad\nfacet normal 0 0 1\nvertex 0 0 0\nvertex 1 0 0\nendfacet\nendsolid bad\n";
    expect(() => parseStl(new TextEncoder().encode(text))).toThrow(StlParseError);
  });
});

describe("limits and honesty", () => {
  it("throws the typed StlTooLargeError above the triangle cap", () => {
    const data = buildBinaryStl(unitCube());
    expect(() => parseStl(data, { maxTriangles: 4 })).toThrow(StlTooLargeError);
    try {
      parseStl(data, { maxTriangles: 4 });
    } catch (error) {
      expect(error).toBeInstanceOf(StlTooLargeError);
      expect((error as StlTooLargeError).triangleCount).toBe(12);
    }
  });

  it("refuses to guess on non-STL bytes", () => {
    expect(() => parseStl(new Uint8Array([1, 2, 3]))).toThrow(StlParseError);
  });
});
