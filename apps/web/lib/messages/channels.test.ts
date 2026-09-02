import { describe, expect, it } from "vitest";
import {
  canEditMessage,
  canLeaveChannel,
  canManageChannel,
  canPostToChannel,
  channelLabel,
  countUnread,
  groupConversations,
  inboxWatermark,
  normalizeChannelKind,
  normalizeChannelTitle,
  revisionForEdit,
  shouldMirrorOutbound,
  slugifyChannelTitle,
  STUDENT_EDIT_WINDOW_MS,
  uniqueChannelSlug,
  unreadBadge,
} from "./channels";

describe("channel slugs", () => {
  it("derives a url-safe slug from a title", () => {
    expect(slugifyChannelTitle("Build Season 2026!")).toBe("build-season-2026");
    expect(slugifyChannelTitle("  Drive   Team  ")).toBe("drive-team");
    expect(slugifyChannelTitle("Électrical & CAD")).toBe("electrical-cad");
  });

  it("never returns an empty slug and caps the length", () => {
    expect(slugifyChannelTitle("!!!")).toBe("channel");
    const long = slugifyChannelTitle("a".repeat(80));
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("-")).toBe(false);
  });

  it("suffixes a taken slug until it is unique", () => {
    expect(uniqueChannelSlug("build", [])).toBe("build");
    expect(uniqueChannelSlug("build", ["build"])).toBe("build-2");
    expect(uniqueChannelSlug("build", ["build", "build-2", "BUILD-3"])).toBe("build-4");
  });

  it("keeps a suffixed slug within the length cap", () => {
    const base = "x".repeat(40);
    const next = uniqueChannelSlug(base, [base]);
    expect(next.length).toBeLessThanOrEqual(40);
    expect(next.endsWith("-2")).toBe(true);
  });

  it("normalises titles and kinds", () => {
    expect(normalizeChannelTitle("  Drive   Team ")).toBe("Drive Team");
    expect(() => normalizeChannelTitle("   ")).toThrow(/name/);
    expect(() => normalizeChannelTitle("x".repeat(61))).toThrow(/60/);
    expect(normalizeChannelKind("announce")).toBe("announce");
    expect(normalizeChannelKind("subteam")).toBe("subteam");
    expect(normalizeChannelKind("dm")).toBe("team");
    expect(normalizeChannelKind(undefined)).toBe("team");
  });

  it("labels channels with their slug", () => {
    expect(channelLabel({ kind: "team", slug: "general" })).toBe("#general");
    expect(channelLabel({ kind: "announce", slug: null, title: "Team News" })).toBe("#team-news");
    expect(channelLabel({ kind: "dm", title: "Sam" })).toBe("Sam");
  });
});

describe("announce permission", () => {
  it("lets only announcers post in an announce channel", () => {
    expect(canPostToChannel({ kind: "announce", archived: false, isMember: false, canAnnounce: true })).toEqual({
      ok: true,
    });
    const denied = canPostToChannel({ kind: "announce", archived: false, isMember: true, canAnnounce: false });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toMatch(/mentors and team admins/);
  });

  it("blocks every kind of channel once archived", () => {
    for (const kind of ["team", "announce", "subteam"] as const) {
      expect(canPostToChannel({ kind, archived: true, isMember: true, canAnnounce: true }).ok).toBe(false);
    }
  });

  it("requires membership for subteam channels and nothing for open ones or DMs", () => {
    expect(canPostToChannel({ kind: "subteam", archived: false, isMember: false, canAnnounce: false }).ok).toBe(false);
    expect(canPostToChannel({ kind: "subteam", archived: false, isMember: true, canAnnounce: false }).ok).toBe(true);
    expect(canPostToChannel({ kind: "team", archived: false, isMember: false, canAnnounce: false }).ok).toBe(true);
    expect(canPostToChannel({ kind: "dm", archived: false, isMember: false, canAnnounce: false }).ok).toBe(true);
  });

  it("lets announcers, moderators and creators manage a channel", () => {
    expect(canManageChannel({ canAnnounce: false, memberRole: "member", isCreator: false })).toBe(false);
    expect(canManageChannel({ canAnnounce: true, memberRole: null, isCreator: false })).toBe(true);
    expect(canManageChannel({ canAnnounce: false, memberRole: "moderator", isCreator: false })).toBe(true);
    expect(canManageChannel({ canAnnounce: false, memberRole: null, isCreator: true })).toBe(true);
  });

  it("never lets anyone leave #general or a DM", () => {
    expect(canLeaveChannel({ kind: "team", slug: "general" }).ok).toBe(false);
    expect(canLeaveChannel({ kind: "dm", slug: null }).ok).toBe(false);
    expect(canLeaveChannel({ kind: "subteam", slug: "cad" }).ok).toBe(true);
  });
});

describe("message edit rules", () => {
  const base = {
    authorUserId: "author",
    actorUserId: "author",
    createdAt: "2026-09-01T12:00:00.000Z",
    deleted: false,
  };
  const sentAt = new Date(base.createdAt).getTime();

  it("lets a student edit inside the window and not after", () => {
    expect(canEditMessage({ ...base, unlimited: false, now: sentAt + 60_000 }).ok).toBe(true);
    expect(canEditMessage({ ...base, unlimited: false, now: sentAt + STUDENT_EDIT_WINDOW_MS + 1 }).ok).toBe(false);
  });

  it("lets a mentor edit at any time", () => {
    expect(canEditMessage({ ...base, unlimited: true, now: sentAt + 365 * 24 * 3600_000 }).ok).toBe(true);
  });

  it("refuses edits to other people's messages and to deleted ones", () => {
    expect(canEditMessage({ ...base, actorUserId: "someone-else", unlimited: true }).ok).toBe(false);
    expect(canEditMessage({ ...base, deleted: true, unlimited: true }).ok).toBe(false);
  });

  it("writes a revision only when the body actually changed", () => {
    expect(revisionForEdit("hello", "hello")).toBeNull();
    expect(revisionForEdit("hello", "hello!")).toEqual({ action: "edit", priorBody: "hello" });
  });
});

describe("unread computation", () => {
  const messages = [
    { createdAt: "2026-09-01T10:00:00.000Z", authorUserId: "other" },
    { createdAt: "2026-09-01T11:00:00.000Z", authorUserId: "me" },
    { createdAt: "2026-09-01T12:00:00.000Z", authorUserId: "other", deletedAt: "2026-09-01T12:30:00.000Z" },
    { createdAt: "2026-09-01T13:00:00.000Z", authorUserId: "other" },
  ];

  it("counts live messages from others after the read cursor", () => {
    expect(countUnread(messages, "2026-09-01T10:30:00.000Z", "me")).toBe(1);
  });

  it("counts everything from others when there is no cursor", () => {
    expect(countUnread(messages, null, "me")).toBe(2);
  });

  it("formats the badge", () => {
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(7)).toBe("7");
    expect(unreadBadge(250)).toBe("99+");
  });

  it("tracks the inbox watermark across conversations", () => {
    expect(
      inboxWatermark(
        [{ lastMessageAt: "2026-09-01T10:00:00.000Z" }, { lastMessageAt: null }, { lastMessageAt: "2026-09-01T12:00:00.000Z" }],
        "2026-09-01T11:00:00.000Z",
      ),
    ).toBe("2026-09-01T12:00:00.000Z");
    expect(inboxWatermark([], null)).toBeNull();
  });
});

describe("rail grouping and bridges", () => {
  it("groups conversations for the rail", () => {
    const groups = groupConversations([
      { id: "dm1", kind: "dm" as const },
      { id: "old", kind: "subteam" as const, slug: "old-cad", archivedAt: "2026-01-01T00:00:00.000Z" },
      { id: "ann", kind: "announce" as const, slug: "announcements" },
      { id: "gen", kind: "team" as const, slug: "general" },
      { id: "cad", kind: "subteam" as const, slug: "cad" },
      { id: "random", kind: "team" as const, slug: "random" },
    ]);
    expect(groups.general?.id).toBe("gen");
    expect(groups.announce.map((item) => item.id)).toEqual(["ann"]);
    expect(groups.subteam.map((item) => item.id)).toEqual(["cad"]);
    expect(groups.open.map((item) => item.id)).toEqual(["random"]);
    expect(groups.archived.map((item) => item.id)).toEqual(["old"]);
    expect(groups.dms.map((item) => item.id)).toEqual(["dm1"]);
  });

  it("mirrors announce channels, and #general only until an announce channel exists", () => {
    expect(shouldMirrorOutbound({ kind: "announce", slug: "news", orgHasAnnounceChannel: true })).toBe(true);
    expect(shouldMirrorOutbound({ kind: "team", slug: "general", orgHasAnnounceChannel: false })).toBe(true);
    expect(shouldMirrorOutbound({ kind: "team", slug: "general", orgHasAnnounceChannel: true })).toBe(false);
    expect(shouldMirrorOutbound({ kind: "subteam", slug: "cad", orgHasAnnounceChannel: false })).toBe(false);
    expect(shouldMirrorOutbound({ kind: "dm", slug: null, orgHasAnnounceChannel: false })).toBe(false);
  });
});
