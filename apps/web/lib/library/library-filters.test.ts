import { describe, expect, it } from "vitest";
import {
  classifyResourceType,
  fileExtension,
  filterResources,
  folderResourceCounts,
  type LibraryFilter,
} from "./library-filters";
import type { LibraryResource } from "./types";

function resource(overrides: Partial<LibraryResource>): LibraryResource {
  return {
    id: "r1",
    folderId: null,
    kind: "file",
    type: "other",
    title: "Untitled",
    notes: null,
    tags: [],
    visibility: "team",
    url: null,
    fileName: null,
    contentType: null,
    byteSize: 1,
    storageLocation: "db",
    status: "ready",
    createdBy: "u1",
    createdByName: null,
    canManage: false,
    grantedUserIds: null,
    links: [],
    createdAt: "2026-01-01T00:00:00Z",
    src: null,
    previewSrc: null,
    ...overrides,
  };
}

describe("classifyResourceType", () => {
  it("recognizes CAD formats by extension", () => {
    for (const name of ["arm.step", "arm.STP", "plate.dxf", "intake.f3d", "hub.sldprt", "mount.stl"]) {
      expect(classifyResourceType("file", "application/octet-stream", name), name).toBe("cad");
    }
  });

  it("recognizes documents, archives, code, and images", () => {
    expect(classifyResourceType("file", "application/pdf", "manual.pdf")).toBe("document");
    expect(classifyResourceType("file", "application/zip", "season.zip")).toBe("archive");
    expect(classifyResourceType("file", "text/x-java", "Robot.java")).toBe("code");
    expect(classifyResourceType("file", "image/png", "pit.png")).toBe("image");
  });

  it("falls back to content type when the extension is unknown", () => {
    expect(classifyResourceType("file", "image/webp", "photo")).toBe("image");
    expect(classifyResourceType("file", "application/pdf", "manual")).toBe("document");
    expect(classifyResourceType("file", "application/x-tar", "backup")).toBe("archive");
  });

  it("labels links and unknowns honestly", () => {
    expect(classifyResourceType("link", null, null)).toBe("link");
    expect(classifyResourceType("file", "application/octet-stream", "mystery.bin")).toBe("other");
  });
});

describe("fileExtension", () => {
  it("extracts lowercase extensions and rejects edge cases", () => {
    expect(fileExtension("Part.STEP")).toBe("step");
    expect(fileExtension("noext")).toBeNull();
    expect(fileExtension(".hidden")).toBeNull();
    expect(fileExtension("trailing.")).toBeNull();
    expect(fileExtension(null)).toBeNull();
  });
});

describe("filterResources", () => {
  const shelf = [
    resource({ id: "cad", type: "cad", title: "Swerve module", fileName: "swerve.step", folderId: "f1", tags: ["drivetrain"] }),
    resource({ id: "doc", type: "document", title: "Build manual", fileName: "manual.pdf", folderId: "f2" }),
    resource({ id: "root-link", kind: "link", type: "link", title: "Vendor page", url: "https://vendor.example", folderId: null }),
  ];
  const base: LibraryFilter = { query: "", type: "all", folderId: "all" };

  it("scopes browsing to the current folder when not searching", () => {
    expect(filterResources(shelf, { ...base, folderId: "f1" }).map((r) => r.id)).toEqual(["cad"]);
    expect(filterResources(shelf, { ...base, folderId: null }).map((r) => r.id)).toEqual(["root-link"]);
  });

  it("searches across ALL folders when a query is set", () => {
    expect(filterResources(shelf, { ...base, folderId: "f1", query: "manual" }).map((r) => r.id)).toEqual(["doc"]);
  });

  it("matches titles, file names, and tags", () => {
    expect(filterResources(shelf, { ...base, query: "swerve" }).map((r) => r.id)).toEqual(["cad"]);
    expect(filterResources(shelf, { ...base, query: "drivetrain" }).map((r) => r.id)).toEqual(["cad"]);
    expect(filterResources(shelf, { ...base, query: "manual.pdf" }).map((r) => r.id)).toEqual(["doc"]);
  });

  it("requires every word of a multi-word query", () => {
    expect(filterResources(shelf, { ...base, query: "build manual" }).map((r) => r.id)).toEqual(["doc"]);
    expect(filterResources(shelf, { ...base, query: "build swerve" })).toEqual([]);
  });

  it("filters by type bucket", () => {
    expect(filterResources(shelf, { ...base, type: "cad" }).map((r) => r.id)).toEqual(["cad"]);
    expect(filterResources(shelf, { ...base, type: "link" }).map((r) => r.id)).toEqual(["root-link"]);
  });
});

describe("folderResourceCounts", () => {
  it("counts real resources per folder including the root", () => {
    const counts = folderResourceCounts([
      resource({ id: "a", folderId: "f1" }),
      resource({ id: "b", folderId: "f1" }),
      resource({ id: "c", folderId: null }),
    ]);
    expect(counts.get("f1")).toBe(2);
    expect(counts.get(null)).toBe(1);
    expect(counts.get("empty")).toBeUndefined();
  });
});
