// The routing decision across the cases that matter: size threshold, content
// class, no node / node offline / no URL / http URL / insufficient disk,
// cloud fallback on and off, and hard refusals with honest reasons.

import { describe, expect, it } from "vitest";
import {
  decideStorageRoute,
  isBrowserReachableUrl,
  nodeEligibilityFor,
  planFiles,
} from "./decide";
import { defaultRoutingPolicy } from "./policy";
import type { CandidateNode, StorageRoutingPolicy } from "./types";

const MB = 1024 * 1024;
const CLOUD_CAP = 4 * MB;

const onlineNode: CandidateNode = {
  id: "node-1",
  name: "Shop-NAS",
  liveness: "online",
  lastHeartbeatAt: new Date().toISOString(),
  baseUrl: "https://shop-nas.example.com",
  diskFreeBytes: 500 * 1024 * MB,
  diskTotalBytes: 1000 * 1024 * MB,
};

const policy: StorageRoutingPolicy = defaultRoutingPolicy();

describe("browser reachability", () => {
  it("accepts https and localhost http, rejects LAN http and garbage", () => {
    expect(isBrowserReachableUrl("https://nas.tail1234.ts.net")).toBe(true);
    expect(isBrowserReachableUrl("http://localhost:8788")).toBe(true);
    expect(isBrowserReachableUrl("http://127.0.0.1:8788")).toBe(true);
    expect(isBrowserReachableUrl("http://192.168.1.20:8788")).toBe(false);
    expect(isBrowserReachableUrl("ftp://x")).toBe(false);
    expect(isBrowserReachableUrl("not a url")).toBe(false);
    expect(isBrowserReachableUrl(null)).toBe(false);
  });
});

describe("node eligibility", () => {
  it("explains a missing node, a missing URL, an http URL, staleness, and full disk", () => {
    expect(nodeEligibilityFor(null, MB)).toMatchObject({ eligible: false });
    expect(nodeEligibilityFor({ ...onlineNode, baseUrl: null }, MB)).toMatchObject({ eligible: false });
    const httpOnly = nodeEligibilityFor({ ...onlineNode, baseUrl: "http://192.168.1.20:8788" }, MB);
    expect(httpOnly.eligible).toBe(false);
    if (!httpOnly.eligible) expect(httpOnly.reason).toMatch(/https/);
    expect(nodeEligibilityFor({ ...onlineNode, liveness: "offline" }, MB)).toMatchObject({ eligible: false });
    expect(nodeEligibilityFor({ ...onlineNode, liveness: "degraded" }, MB)).toMatchObject({ eligible: false });
    expect(nodeEligibilityFor({ ...onlineNode, liveness: "never" }, MB)).toMatchObject({ eligible: false });
    const full = nodeEligibilityFor({ ...onlineNode, diskFreeBytes: 10 * MB }, 100 * MB);
    expect(full.eligible).toBe(false);
    if (!full.eligible) expect(full.reason).toMatch(/free/);
  });

  it("treats unknown disk (pre-heartbeat) as not blocking IF the node is online", () => {
    // diskFreeBytes null + liveness online cannot happen in practice (disk
    // arrives with the first heartbeat), but the size check must not invent a
    // number when it is null.
    const result = nodeEligibilityFor({ ...onlineNode, diskFreeBytes: null }, 100 * MB);
    expect(result.eligible).toBe(true);
  });
});

describe("decideStorageRoute", () => {
  it("sends small ordinary files to the cloud", () => {
    const decision = decideStorageRoute({
      byteSize: 2 * MB,
      contentClass: "document",
      policy,
      node: onlineNode,
      cloudCapBytes: CLOUD_CAP,
    });
    expect(decision.destination).toBe("cloud");
    if (decision.destination === "cloud") expect(decision.fallback).toBe(false);
  });

  it("sends files over the size threshold to the node", () => {
    const decision = decideStorageRoute({
      byteSize: 400 * MB,
      contentClass: "other",
      policy,
      node: onlineNode,
      cloudCapBytes: CLOUD_CAP,
    });
    expect(decision).toMatchObject({ destination: "node", nodeId: "node-1", nodeName: "Shop-NAS" });
  });

  it("sends video and CAD to the node even when tiny (class rule)", () => {
    for (const contentClass of ["video", "cad", "archive"] as const) {
      const decision = decideStorageRoute({
        byteSize: 1 * MB,
        contentClass,
        policy,
        node: onlineNode,
        cloudCapBytes: CLOUD_CAP,
      });
      expect(decision.destination).toBe("node");
    }
  });

  it("falls back to the cloud (labelled) when the node is offline and the file fits", () => {
    const decision = decideStorageRoute({
      byteSize: 1 * MB,
      contentClass: "video",
      policy,
      node: { ...onlineNode, liveness: "offline" },
      cloudCapBytes: CLOUD_CAP,
    });
    expect(decision.destination).toBe("cloud");
    if (decision.destination === "cloud") {
      expect(decision.fallback).toBe(true);
      expect(decision.reason).toMatch(/offline/);
    }
  });

  it("refuses instead of falling back when policy disables cloud fallback", () => {
    const decision = decideStorageRoute({
      byteSize: 1 * MB,
      contentClass: "video",
      policy: { ...policy, cloudFallback: false },
      node: { ...onlineNode, liveness: "offline" },
      cloudCapBytes: CLOUD_CAP,
    });
    expect(decision.destination).toBe("refused");
    expect(decision.reason).toMatch(/refused/);
  });

  it("refuses a big file when no node is paired (nowhere honest to put it)", () => {
    const decision = decideStorageRoute({
      byteSize: 400 * MB,
      contentClass: "video",
      policy,
      node: null,
      cloudCapBytes: CLOUD_CAP,
    });
    expect(decision.destination).toBe("refused");
    expect(decision.reason).toMatch(/No storage node/);
    expect(decision.reason).toMatch(/cloud upload limit/);
  });

  it("refuses a big file when the node reports insufficient free disk", () => {
    const decision = decideStorageRoute({
      byteSize: 400 * MB,
      contentClass: "video",
      policy,
      node: { ...onlineNode, diskFreeBytes: 100 * MB },
      cloudCapBytes: CLOUD_CAP,
    });
    expect(decision.destination).toBe("refused");
    expect(decision.reason).toMatch(/free/);
  });

  it("routes an under-threshold file over the cloud cap to the node", () => {
    const decision = decideStorageRoute({
      byteSize: 8 * MB,
      contentClass: "document",
      policy: { ...policy, nodeThresholdBytes: 50 * MB },
      node: onlineNode,
      cloudCapBytes: CLOUD_CAP,
    });
    expect(decision.destination).toBe("node");
  });

  it("never routes uploads to a node the browser cannot reach (no URL / http URL)", () => {
    for (const baseUrl of [null, "http://192.168.1.20:8788"]) {
      const decision = decideStorageRoute({
        byteSize: 400 * MB,
        contentClass: "video",
        policy,
        node: { ...onlineNode, baseUrl },
        cloudCapBytes: CLOUD_CAP,
      });
      expect(decision.destination).toBe("refused");
    }
  });
});

describe("planFiles", () => {
  it("classifies and decides per file, matching what the server will enforce", () => {
    const entries = planFiles(
      [
        { name: "match-42.mp4", contentType: "video/mp4", byteSize: 400 * MB },
        { name: "notes.pdf", contentType: "application/pdf", byteSize: 1 * MB },
        { name: "swerve.step", contentType: "", byteSize: 2 * MB },
      ],
      policy,
      onlineNode,
      CLOUD_CAP,
    );
    expect(entries[0]!.contentClass).toBe("video");
    expect(entries[0]!.decision.destination).toBe("node");
    expect(entries[1]!.contentClass).toBe("document");
    expect(entries[1]!.decision.destination).toBe("cloud");
    expect(entries[2]!.contentClass).toBe("cad");
    expect(entries[2]!.decision.destination).toBe("node");
  });
});
