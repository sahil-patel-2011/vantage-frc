import { describe, expect, it } from "vitest";
import { decideStorageRoute, planFiles } from "./decide";
import { defaultRoutingPolicy } from "./policy";
import { objectStoreStatus, driveObjectKey, presignObjectGet } from "./object-store";
import type { CandidateNode, ObjectStoreAvailability } from "./types";

const CLOUD_CAP = 4 * 1024 * 1024;
const policy = defaultRoutingPolicy();
const configured: ObjectStoreAvailability = { configured: true };
const unconfigured: ObjectStoreAvailability = {
  configured: false,
  reason: "Object storage is not configured for this deployment. See docs/DEPLOYMENT.md.",
};

const liveNode: CandidateNode = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Shop NAS",
  liveness: "online",
  lastHeartbeatAt: new Date().toISOString(),
  baseUrl: "https://nas.example.com",
  diskFreeBytes: 500 * 1024 * 1024 * 1024,
  diskTotalBytes: 1000 * 1024 * 1024 * 1024,
};

describe("object storage as a third routing destination", () => {
  it("is never chosen when the caller does not pass it (old callers unchanged)", () => {
    const decision = decideStorageRoute({
      byteSize: 300 * 1024 * 1024,
      contentClass: "video",
      policy,
      node: null,
      cloudCapBytes: CLOUD_CAP,
    });
    expect(decision.destination).toBe("refused");
  });

  it("still prefers the team's own node when the node can take the file", () => {
    const decision = decideStorageRoute({
      byteSize: 300 * 1024 * 1024,
      contentClass: "video",
      policy,
      node: liveNode,
      cloudCapBytes: CLOUD_CAP,
      objectStore: configured,
    });
    expect(decision.destination).toBe("node");
  });

  it("takes a big file object storage can hold but nothing else can", () => {
    const decision = decideStorageRoute({
      byteSize: 300 * 1024 * 1024,
      contentClass: "video",
      policy,
      node: null,
      cloudCapBytes: CLOUD_CAP,
      objectStore: configured,
    });
    expect(decision.destination).toBe("object");
    if (decision.destination !== "object") return;
    expect(decision.fallback).toBe(true);
    expect(decision.reason).toContain("without passing through Vantage");
  });

  it("prefers object storage over the database for a node-preferring small file", () => {
    // A 1 MB STEP file: CAD always prefers the node, the node is gone, and the
    // file would fit the database. Object storage is the better home because
    // the hosted database is the scarcest of the three.
    const decision = decideStorageRoute({
      byteSize: 1024 * 1024,
      contentClass: "cad",
      policy,
      node: null,
      cloudCapBytes: CLOUD_CAP,
      objectStore: configured,
    });
    expect(decision.destination).toBe("object");
  });

  it("leaves ordinary small documents in the database", () => {
    const decision = decideStorageRoute({
      byteSize: 200 * 1024,
      contentClass: "document",
      policy,
      node: null,
      cloudCapBytes: CLOUD_CAP,
      objectStore: configured,
    });
    expect(decision.destination).toBe("cloud");
  });

  it("says WHY object storage was unavailable when it refuses", () => {
    const decision = decideStorageRoute({
      byteSize: 300 * 1024 * 1024,
      contentClass: "video",
      policy,
      node: null,
      cloudCapBytes: CLOUD_CAP,
      objectStore: unconfigured,
    });
    expect(decision.destination).toBe("refused");
    expect(decision.reason).toContain("Object storage is not configured");
  });

  it("plans a whole selection with the object destination in play", () => {
    const entries = planFiles(
      [
        { name: "notes.txt", contentType: "text/plain", byteSize: 900 },
        { name: "match.mp4", contentType: "video/mp4", byteSize: 900 * 1024 * 1024 },
      ],
      policy,
      null,
      CLOUD_CAP,
      configured,
    );
    expect(entries.map((entry) => entry.decision.destination)).toEqual(["cloud", "object"]);
  });
});

describe("objectStoreStatus", () => {
  it("reports setup_required with every missing key when nothing is set", () => {
    const status = objectStoreStatus({});
    expect(status.configured).toBe(false);
    if (status.configured) return;
    expect(status.missing).toEqual([
      "DRIVE_OBJECT_ENDPOINT",
      "DRIVE_OBJECT_BUCKET",
      "DRIVE_OBJECT_ACCESS_KEY",
      "DRIVE_OBJECT_SECRET_KEY",
      "DRIVE_OBJECT_REGION",
    ]);
  });

  it("names exactly the key that is missing when it is half-configured", () => {
    const status = objectStoreStatus({
      DRIVE_OBJECT_ENDPOINT: "https://example.supabase.co/storage/v1/s3",
      DRIVE_OBJECT_BUCKET: "vantage-drive",
      DRIVE_OBJECT_ACCESS_KEY: "key",
      DRIVE_OBJECT_SECRET_KEY: "secret",
    });
    expect(status.configured).toBe(false);
    if (status.configured) return;
    expect(status.missing).toEqual(["DRIVE_OBJECT_REGION"]);
    expect(status.reason).toContain("DRIVE_OBJECT_REGION");
  });

  it("refuses a plain-http endpoint rather than signing a URL browsers will block", () => {
    const status = objectStoreStatus({
      DRIVE_OBJECT_ENDPOINT: "http://minio.local:9000",
      DRIVE_OBJECT_BUCKET: "vantage-drive",
      DRIVE_OBJECT_ACCESS_KEY: "key",
      DRIVE_OBJECT_SECRET_KEY: "secret",
      DRIVE_OBJECT_REGION: "us-east-1",
    });
    expect(status.configured).toBe(false);
    if (status.configured) return;
    expect(status.reason).toContain("https");
  });

  it("keeps the endpoint's own path prefix (Supabase serves S3 under /storage/v1/s3)", () => {
    const status = objectStoreStatus({
      DRIVE_OBJECT_ENDPOINT: "https://example.supabase.co/storage/v1/s3/",
      DRIVE_OBJECT_BUCKET: "vantage-drive",
      DRIVE_OBJECT_ACCESS_KEY: "key",
      DRIVE_OBJECT_SECRET_KEY: "secret",
      DRIVE_OBJECT_REGION: "us-east-1",
    });
    expect(status.configured).toBe(true);
    if (!status.configured) return;
    expect(status.config.endpoint).toBe("https://example.supabase.co/storage/v1/s3");

    const signed = presignObjectGet(status.config, "drive/org/file/abc", {
      fileName: "plan.pdf",
      now: new Date("2024-01-01T00:00:00Z"),
    });
    expect(signed.url).toContain("/storage/v1/s3/vantage-drive/drive/org/file/abc?");
    expect(signed.url).toContain("X-Amz-Signature=");
  });
});

describe("driveObjectKey", () => {
  it("prefixes the org id so the key itself carries tenancy", () => {
    expect(driveObjectKey("org-1", "a".repeat(64))).toBe(`drive/org-1/${"a".repeat(64)}`);
  });

  it("is content-addressed within an org, so identical bytes reuse one object", () => {
    expect(driveObjectKey("org-1", "b".repeat(64))).toBe(driveObjectKey("org-1", "b".repeat(64)));
    expect(driveObjectKey("org-2", "b".repeat(64))).not.toBe(driveObjectKey("org-1", "b".repeat(64)));
  });
});
