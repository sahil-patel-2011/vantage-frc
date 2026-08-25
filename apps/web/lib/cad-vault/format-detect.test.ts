import { describe, expect, it } from "vitest";
import { detectCadFormat, fileExtension, isAsciiStl, isBinaryStl } from "./format-detect";

function binaryStl(triangleCount: number, declaredCount = triangleCount): Uint8Array {
  const bytes = new Uint8Array(84 + triangleCount * 50);
  new DataView(bytes.buffer).setUint32(80, declaredCount, true);
  return bytes;
}

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const ASCII_STL = `solid cube
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid cube
`;

describe("binary STL detection", () => {
  it("accepts a well-formed binary STL", () => {
    expect(isBinaryStl(binaryStl(3))).toBe(true);
    expect(detectCadFormat(binaryStl(3), "bracket.stl")).toEqual({ ok: true, format: "stl", mediaType: "model/stl" });
  });

  it("rejects when the declared triangle count disagrees with the byte length", () => {
    const corrupted = binaryStl(3, 4);
    expect(isBinaryStl(corrupted)).toBe(false);
    const result = detectCadFormat(corrupted, "bracket.stl");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("triangle count");
  });

  it("rejects when the byte length is not 84 + 50n", () => {
    expect(isBinaryStl(new Uint8Array(84 + 49))).toBe(false);
  });
});

describe("ASCII STL detection", () => {
  it("accepts solid + facet normal", () => {
    expect(isAsciiStl(ascii(ASCII_STL))).toBe(true);
    expect(detectCadFormat(ascii(ASCII_STL), "cube.stl")).toMatchObject({ ok: true, format: "stl" });
  });

  it("rejects a text file that merely starts with 'solid'", () => {
    expect(isAsciiStl(ascii("solid state of mind\nnothing else"))).toBe(false);
  });
});

describe("other formats", () => {
  it("detects STEP by ISO-10303-21 header, extension picks stp vs step", () => {
    const step = ascii("ISO-10303-21;\nHEADER;\n");
    expect(detectCadFormat(step, "frame.step")).toMatchObject({ ok: true, format: "step" });
    expect(detectCadFormat(step, "frame.stp")).toMatchObject({ ok: true, format: "stp" });
  });

  it("detects PDF", () => {
    expect(detectCadFormat(ascii("%PDF-1.7\n"), "drawing.pdf")).toMatchObject({ ok: true, format: "pdf" });
  });

  it("zip magic maps to 3mf/f3d/zip by extension", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(detectCadFormat(zip, "shooter.3mf")).toMatchObject({ ok: true, format: "3mf" });
    expect(detectCadFormat(zip, "shooter.f3d")).toMatchObject({ ok: true, format: "f3d" });
    expect(detectCadFormat(zip, "shooter.anything")).toMatchObject({ ok: true, format: "zip" });
  });

  it("OLE compound maps to SolidWorks/Inventor by extension, rejects others", () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(detectCadFormat(ole, "arm.sldprt")).toMatchObject({ ok: true, format: "sldprt" });
    expect(detectCadFormat(ole, "robot.sldasm")).toMatchObject({ ok: true, format: "sldasm" });
    expect(detectCadFormat(ole, "hub.ipt")).toMatchObject({ ok: true, format: "ipt" });
    expect(detectCadFormat(ole, "drive.iam")).toMatchObject({ ok: true, format: "iam" });
    const rejected = detectCadFormat(ole, "mystery.doc");
    expect(rejected.ok).toBe(false);
  });

  it("detects IGES by 80-column start section", () => {
    const line = `${"START RECORD".padEnd(72, " ")}S      1\n`;
    expect(detectCadFormat(ascii(line), "gear.igs")).toMatchObject({ ok: true, format: "igs" });
    expect(detectCadFormat(ascii(line), "gear.iges")).toMatchObject({ ok: true, format: "iges" });
  });

  it("detects DXF group-code header", () => {
    expect(detectCadFormat(ascii("0\r\nSECTION\r\n2\r\nHEADER\r\n"), "plate.dxf")).toMatchObject({ ok: true, format: "dxf" });
  });

  it("detects OBJ only with .obj extension and vertex/face structure", () => {
    const obj = ascii("# comment\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
    expect(detectCadFormat(obj, "mesh.obj")).toMatchObject({ ok: true, format: "obj" });
    expect(detectCadFormat(obj, "mesh.txt").ok).toBe(false);
  });
});

describe("rejection honesty", () => {
  it("rejects an empty file", () => {
    const result = detectCadFormat(new Uint8Array(0), "empty.stl");
    expect(result).toEqual({ ok: false, reason: "The file is empty." });
  });

  it("rejects unknown magic even with a trusted extension", () => {
    const result = detectCadFormat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "totally-a-part.stl");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("verifies the bytes");
  });
});

describe("fileExtension", () => {
  it("lowercases and handles missing extensions", () => {
    expect(fileExtension("Part.SLDPRT")).toBe("sldprt");
    expect(fileExtension("no-extension")).toBe("");
  });
});
