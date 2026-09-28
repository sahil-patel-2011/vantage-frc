import { describe, expect, it } from "vitest";
import { decideStorageRoute, isBrowserReachableUrl, nodeEligibilityFor, planFiles } from "./decide";
import { defaultRoutingPolicy } from "./policy";
import type { CandidateNode } from "./types";

const MB = 1024 * 1024, CLOUD_CAP = 4 * MB;
const onlineNode: CandidateNode = { id: "node-1", name: "Existing archive", liveness: "online", lastHeartbeatAt: new Date().toISOString(), baseUrl: "https://archive.example.com", diskFreeBytes: 500 * MB, diskTotalBytes: 1000 * MB };
const policy = defaultRoutingPolicy();
const route = (contentClass: "photo" | "video" | "document" | "cad" | "archive" | "other", byteSize: number, extra = {}) => decideStorageRoute({ byteSize, contentClass, policy, node: onlineNode, cloudCapBytes: CLOUD_CAP, ...extra });

describe("archive reachability", () => {
  it("accepts HTTPS and localhost HTTP but rejects mixed-content LAN addresses", () => {
    for (const url of ["https://archive.example.com", "http://localhost:8788", "http://127.0.0.1:8788"]) expect(isBrowserReachableUrl(url)).toBe(true);
    for (const url of ["http://192.168.1.20:8788", "ftp://x", "not a url", null]) expect(isBrowserReachableUrl(url)).toBe(false);
  });
});

describe("retired node writes", () => {
  it("never makes an existing archive eligible for writes based on liveness or free space", () => {
    for (const liveness of ["online", "offline", "degraded", "never"] as const) {
      expect(nodeEligibilityFor({ ...onlineNode, liveness }, MB)).toEqual({ eligible: false, reason: "Storage nodes serve existing archives; new uploads are retired." });
    }
    expect(nodeEligibilityFor(null, MB).eligible).toBe(false);
  });
  it("rejects photo/video even with a live node and configured object storage", () => {
    for (const contentClass of ["photo", "video"] as const) for (const byteSize of [100, 400 * MB]) {
      const decision = route(contentClass, byteSize, { objectStore: { configured: true } });
      expect(decision.destination).toBe("refused");
      expect(decision.reason).toContain("external match-video link");
    }
  });
  it("keeps small supported documents in the database", () => {
    expect(route("document", 2 * MB)).toMatchObject({ destination: "cloud", fallback: false });
  });
  it("refuses large files without a supported destination", () => {
    for (const contentClass of ["document", "cad", "archive", "other"] as const) {
      const decision = route(contentClass, 400 * MB);
      expect(decision.destination).toBe("refused");
      expect(decision.reason).toContain("new uploads are retired");
      expect(decision.reason).toContain("cloud upload limit");
    }
  });
  it("routes large documents to configured object storage despite an old live node", () => {
    expect(route("document", 8 * MB, { objectStore: { configured: true } })).toMatchObject({ destination: "object" });
    expect(route("document", 8 * MB, { policy: { ...policy, nodeThresholdBytes: 50 * MB }, objectStore: { configured: true } })).toMatchObject({ destination: "object" });
  });
  it("uses allowed cloud fallback for a small CAD document and labels retirement", () => {
    const decision = route("cad", MB);
    expect(decision).toMatchObject({ destination: "cloud", fallback: true });
    expect(decision.reason).toContain("new uploads are retired");
  });
  it("respects a saved policy that disables cloud fallback", () => {
    const decision = route("cad", MB, { policy: { ...policy, cloudFallback: false } });
    expect(decision.destination).toBe("refused");
    expect(decision.reason).toContain("policy disables cloud fallback");
  });
  it("plans documents, CAD and refused video through the same decisions as grants", () => {
    const entries = planFiles([{ name: "match.mp4", contentType: "video/mp4", byteSize: 400 * MB }, { name: "notes.pdf", contentType: "application/pdf", byteSize: MB }, { name: "swerve.step", contentType: "", byteSize: 2 * MB }], policy, onlineNode, CLOUD_CAP);
    expect(entries.map((entry) => entry.contentClass)).toEqual(["video", "document", "cad"]);
    expect(entries.map((entry) => entry.decision.destination)).toEqual(["refused", "cloud", "cloud"]);
  });
});
