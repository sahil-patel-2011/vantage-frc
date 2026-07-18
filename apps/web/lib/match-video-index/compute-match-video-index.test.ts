import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { detectSourceFromUrl, groupVideosByMatch, normalizeMatchKey, summarizeMatchVideoIndex } from ".";
import { computeMatchVideoIndexView } from "./compute-match-video-index";
import type { MatchVideoEntry } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const EVENT = "2026casj";

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("detectSourceFromUrl (pure)", () => {
  it("detects youtube URLs", () => {
    expect(detectSourceFromUrl("https://youtu.be/abc123")).toBe("youtube");
    expect(detectSourceFromUrl("https://www.youtube.com/watch?v=abc123")).toBe("youtube");
  });

  it("detects drive URLs", () => {
    expect(detectSourceFromUrl("https://drive.google.com/file/d/xyz/view")).toBe("drive");
  });

  it("falls back to other for unrecognized hosts", () => {
    expect(detectSourceFromUrl("https://example.com/video.mp4")).toBe("other");
  });
});

describe("normalizeMatchKey (pure)", () => {
  it("lowercases and trims whitespace", () => {
    expect(normalizeMatchKey("  2026casj_QM12  ")).toBe("2026casj_qm12");
  });

  it("collapses internal whitespace to underscores", () => {
    expect(normalizeMatchKey("2026casj QM 12")).toBe("2026casj_qm_12");
  });
});

describe("groupVideosByMatch (pure)", () => {
  const base: MatchVideoEntry = {
    id: "v1",
    matchKey: `${EVENT}_qm1`,
    eventKey: EVENT,
    matchLabel: "Qual 1",
    videoUrl: "https://youtu.be/a",
    source: "youtube",
    recordedOn: "2026-03-01",
    notes: null,
    tags: [],
    createdAt: "2026-03-01T00:00:00.000Z",
  };

  it("groups multiple videos under the same match key", () => {
    const groups = groupVideosByMatch([
      base,
      { ...base, id: "v2", videoUrl: "https://drive.google.com/x", source: "drive" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].videos).toHaveLength(2);
    expect(groups[0].matchLabel).toBe("Qual 1");
  });

  it("splits distinct match keys into separate groups", () => {
    const groups = groupVideosByMatch([base, { ...base, id: "v2", matchKey: `${EVENT}_qm2` }]);
    expect(groups).toHaveLength(2);
  });
});

describe("summarizeMatchVideoIndex (pure)", () => {
  it("counts totals and buckets by source", () => {
    const entries: MatchVideoEntry[] = [
      { id: "v1", matchKey: "qm1", eventKey: EVENT, matchLabel: null, videoUrl: "u1", source: "youtube", recordedOn: null, notes: null, tags: [], createdAt: "2026-03-01T00:00:00.000Z" },
      { id: "v2", matchKey: "qm2", eventKey: EVENT, matchLabel: null, videoUrl: "u2", source: "youtube", recordedOn: null, notes: null, tags: [], createdAt: "2026-03-02T00:00:00.000Z" },
      { id: "v3", matchKey: "qm2", eventKey: EVENT, matchLabel: null, videoUrl: "u3", source: "drive", recordedOn: null, notes: null, tags: [], createdAt: "2026-03-03T00:00:00.000Z" },
    ];
    const summary = summarizeMatchVideoIndex(entries);
    expect(summary.totalVideos).toBe(3);
    expect(summary.totalMatches).toBe(2);
    expect(summary.bySource.find((s) => s.source === "youtube")?.count).toBe(2);
    expect(summary.latestAddedAt).toBe("2026-03-03T00:00:00.000Z");
  });

  it("handles an empty entry list without dividing by zero", () => {
    const summary = summarizeMatchVideoIndex([]);
    expect(summary.totalVideos).toBe(0);
    expect(summary.totalMatches).toBe(0);
    expect(summary.latestAddedAt).toBeNull();
  });
});

describe("computeMatchVideoIndexView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computeMatchVideoIndexView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with groups and summary over mock rows", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      }
      if (sql.includes("FROM match_video_index_entries")) {
        return {
          rows: [
            {
              id: "entry-1",
              matchKey: `${EVENT}_qm1`,
              eventKey: EVENT,
              matchLabel: "Qual 1",
              videoUrl: "https://youtu.be/abc",
              source: "youtube",
              recordedOn: "2026-03-01",
              notes: "Good defense clip",
              tags: ["defense"],
              createdAt: "2026-03-01T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeMatchVideoIndexView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe(ORG);
      expect(view.entries).toHaveLength(1);
      expect(view.groups).toHaveLength(1);
      expect(view.groups[0].matchKey).toBe(`${EVENT}_qm1`);
      expect(view.summary.totalVideos).toBe(1);
    }
  });
});
