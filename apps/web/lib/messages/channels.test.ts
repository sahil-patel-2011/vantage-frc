import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHANNEL_TITLE,
  MAX_CHANNEL_NAME,
  assertChannelPermission,
  canManageChannels,
  channelNotificationTitle,
  decorateChannel,
  isDefaultChannelName,
  normalizeChannelName,
  sameChannelName,
  sortChannels,
} from "./channels";

const row = (
  id: string,
  title: string | null,
  extra: Partial<{ archivedAt: string | null; lastMessageAt: string | null; unreadCount: number }> = {},
) => ({
  id,
  title,
  archivedAt: extra.archivedAt ?? null,
  lastMessageAt: extra.lastMessageAt ?? null,
  unreadCount: extra.unreadCount ?? 0,
});

describe("normalizeChannelName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeChannelName("  drive   team  ")).toBe("drive team");
  });

  it("drops a pasted leading # so #design does not become a channel named '#design'", () => {
    expect(normalizeChannelName("#design")).toBe("design");
    expect(normalizeChannelName("##design")).toBe("design");
  });

  it("strips control characters instead of letting a newline smuggle a second line in", () => {
    expect(normalizeChannelName("design\nteam")).toBe("design team");
    expect(normalizeChannelName("design\u0000ops")).toBe("design ops");
  });

  it("rejects empty, too-short, and too-long names", () => {
    expect(() => normalizeChannelName("   ")).toThrow(/name/i);
    expect(() => normalizeChannelName("a")).toThrow(/at least 2/i);
    expect(() => normalizeChannelName("x".repeat(MAX_CHANNEL_NAME + 1))).toThrow(/60 characters or fewer/i);
  });

  it("rejects punctuation-only names", () => {
    expect(() => normalizeChannelName("---")).toThrow(/letter or number/i);
  });

  it("accepts a name of exactly the maximum length", () => {
    const name = "x".repeat(MAX_CHANNEL_NAME);
    expect(normalizeChannelName(name)).toBe(name);
  });

  it("rejects non-string input", () => {
    expect(() => normalizeChannelName(null)).toThrow();
    expect(() => normalizeChannelName(42)).toThrow();
  });
});

describe("sameChannelName", () => {
  it("compares the way the unique index does (lower(title), whitespace collapsed)", () => {
    expect(sameChannelName("Design ", "design")).toBe(true);
    expect(sameChannelName("drive  team", "Drive Team")).toBe(true);
    expect(sameChannelName("design", "designs")).toBe(false);
  });

  it("treats the default channel as the default however it was typed", () => {
    expect(isDefaultChannelName("team")).toBe(true);
    expect(isDefaultChannelName(" TEAM ")).toBe(true);
    expect(isDefaultChannelName("Team chat")).toBe(false);
  });
});

describe("canManageChannels", () => {
  it("is owner/admin only", () => {
    expect(canManageChannels("owner")).toBe(true);
    expect(canManageChannels("admin")).toBe(true);
    expect(canManageChannels("member")).toBe(false);
    expect(canManageChannels("mentor")).toBe(false);
    expect(canManageChannels(null)).toBe(false);
    expect(canManageChannels(undefined)).toBe(false);
  });
});

describe("assertChannelPermission", () => {
  it("lets an owner or admin create, rename, and archive", () => {
    expect(() => assertChannelPermission("create", { role: "owner" })).not.toThrow();
    expect(() => assertChannelPermission("rename", { role: "admin", isDefault: false })).not.toThrow();
    expect(() => assertChannelPermission("archive", { role: "owner", isDefault: false })).not.toThrow();
  });

  it("refuses a plain member even though RLS would let the insert through", () => {
    expect(() => assertChannelPermission("create", { role: "member" })).toThrow(/owner or admin/i);
    expect(() => assertChannelPermission("rename", { role: "member" })).toThrow(/owner or admin/i);
    expect(() => assertChannelPermission("archive", { role: "member" })).toThrow(/owner or admin/i);
  });

  it("refuses a non-member with no role at all", () => {
    expect(() => assertChannelPermission("create", { role: null })).toThrow(/owner or admin/i);
  });

  it("protects the default channel from rename and archive even for an owner", () => {
    // ensureTeamChannel finds this row by lower(title) = 'team'; renaming it would mint a second one.
    expect(() => assertChannelPermission("rename", { role: "owner", isDefault: true })).toThrow(
      /cannot be renamed or archived/i,
    );
    expect(() => assertChannelPermission("archive", { role: "owner", isDefault: true })).toThrow(
      /cannot be renamed or archived/i,
    );
    expect(() => assertChannelPermission("unarchive", { role: "owner", isDefault: true })).toThrow(
      /cannot be renamed or archived/i,
    );
  });

  it("checks role before default-channel protection so a member never learns which is which", () => {
    expect(() => assertChannelPermission("rename", { role: "member", isDefault: true })).toThrow(
      /owner or admin/i,
    );
  });
});

describe("sortChannels", () => {
  it("puts the default channel first, then live channels by most recent activity", () => {
    const sorted = sortChannels([
      row("c", "Scouting", { lastMessageAt: "2026-08-20T10:00:00.000Z" }),
      row("a", DEFAULT_CHANNEL_TITLE, { lastMessageAt: "2026-01-01T00:00:00.000Z" }),
      row("b", "Design", { lastMessageAt: "2026-08-31T10:00:00.000Z" }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("sinks archived channels below live ones, default included", () => {
    const sorted = sortChannels([
      row("old", "Offseason", { archivedAt: "2026-06-01T00:00:00.000Z", lastMessageAt: "2026-09-01T00:00:00.000Z" }),
      row("live", "Design", { lastMessageAt: "2026-02-01T00:00:00.000Z" }),
      row("team", DEFAULT_CHANNEL_TITLE),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["team", "live", "old"]);
    expect(sorted[2]!.isArchived).toBe(true);
  });

  it("falls back to name order for channels with no messages so the list is stable", () => {
    const sorted = sortChannels([row("z", "Zebra"), row("m", "Media"), row("t", DEFAULT_CHANNEL_TITLE)]);
    expect(sorted.map((item) => item.title)).toEqual([DEFAULT_CHANNEL_TITLE, "Media", "Zebra"]);
  });

  it("ranks a channel with messages above one with none", () => {
    const sorted = sortChannels([row("quiet", "Aaa"), row("busy", "Zzz", { lastMessageAt: "2026-08-31T00:00:00.000Z" })]);
    expect(sorted.map((item) => item.id)).toEqual(["busy", "quiet"]);
  });
});

describe("decorateChannel", () => {
  it("falls back to the default title for a legacy row with a null title", () => {
    const channel = decorateChannel(row("x", null));
    expect(channel.title).toBe(DEFAULT_CHANNEL_TITLE);
    expect(channel.isDefault).toBe(true);
  });

  it("reports archived state from archived_at", () => {
    expect(decorateChannel(row("x", "Design")).isArchived).toBe(false);
    expect(decorateChannel(row("x", "Design", { archivedAt: "2026-06-01T00:00:00.000Z" })).isArchived).toBe(true);
  });
});

describe("channelNotificationTitle", () => {
  it("names the channel so every channel does not read as the same notification", () => {
    expect(channelNotificationTitle("Design")).toBe("New message in #Design");
  });

  it("keeps the original wording for the default channel", () => {
    expect(channelNotificationTitle(DEFAULT_CHANNEL_TITLE)).toBe("New team chat message");
    expect(channelNotificationTitle(null)).toBe("New team chat message");
  });
});
