import { describe, expect, it } from "vitest";
import { rollupBySubsystem, type CadDocumentSummary } from "./view";

function doc(overrides: Partial<CadDocumentSummary>): CadDocumentSummary {
  return {
    id: "d1",
    title: "Doc",
    description: null,
    kind: "part",
    status: "active",
    seasonYear: 2026,
    subsystemId: null,
    subsystemName: null,
    externalUrl: null,
    currentVersion: 1,
    totalBytes: 0,
    latest: null,
    versions: [],
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

const version = {
  publicId: "p",
  version: 1,
  filename: "a.stl",
  format: "stl" as const,
  byteSize: 100,
  checksumSha256: "0".repeat(64),
  hasThumbnail: false,
  geometry: null,
  changeNote: null,
  uploadedBy: "u",
  createdAt: "2026-01-01",
};

describe("rollupBySubsystem", () => {
  it("returns an empty rollup for no documents (no fabricated buckets)", () => {
    expect(rollupBySubsystem([])).toEqual([]);
  });

  it("groups by subsystem and keeps unlinked documents in an explicit Unassigned bucket last", () => {
    const rollup = rollupBySubsystem([
      doc({ id: "a", subsystemId: "s1", subsystemName: "Drivetrain", totalBytes: 500, versions: [version, version] }),
      doc({ id: "b", subsystemId: "s1", subsystemName: "Drivetrain", totalBytes: 300, versions: [version] }),
      doc({ id: "c", subsystemId: null, subsystemName: null, totalBytes: 900, versions: [version] }),
      doc({ id: "d", subsystemId: "s2", subsystemName: "Intake", totalBytes: 100, versions: [version] }),
    ]);
    expect(rollup).toHaveLength(3);
    expect(rollup[0]).toMatchObject({ subsystemId: "s1", subsystemName: "Drivetrain", documentCount: 2, versionCount: 3, totalBytes: 800 });
    expect(rollup[1]).toMatchObject({ subsystemId: "s2", documentCount: 1 });
    expect(rollup[2]).toMatchObject({ subsystemId: null, subsystemName: "Unassigned", totalBytes: 900 });
  });
});
