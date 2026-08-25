import { describe, expect, it } from "vitest";
import {
  deviceClassFromWidth,
  isProductEventName,
  MAX_BATCH_EVENTS,
  MAX_META_BYTES,
  MAX_PATH_LENGTH,
  normalizePath,
  PRODUCT_EVENT_NAMES,
  sanitizeMeta,
  validateBatch,
  validateEvent,
} from "./events";

describe("product event vocabulary", () => {
  // If this list changes, the CHECK constraint in
  // packages/db/migrations/0480_product_analytics.sql has to change with it,
  // and that is a deliberate, reviewable act — which is the point of pinning it.
  it("is exactly the list the database CHECK constraint allows", () => {
    expect([...PRODUCT_EVENT_NAMES]).toEqual([
      "page_view",
      "feature_open",
      "feature_action",
      "search_run",
      "export_run",
      "ai_invoked",
      "onboarding_step",
      "setup_blocked",
    ]);
  });

  it("rejects names outside the list", () => {
    expect(isProductEventName("page_view")).toBe(true);
    expect(isProductEventName("pageview")).toBe(false);
    expect(isProductEventName("chat_message_read")).toBe(false);
    expect(isProductEventName("")).toBe(false);
    expect(isProductEventName(undefined)).toBe(false);
  });
});

describe("normalizePath", () => {
  it("keeps ordinary route shapes", () => {
    expect(normalizePath("/scouting")).toBe("/scouting");
    expect(normalizePath("/team/hours")).toBe("/team/hours");
    expect(normalizePath("/")).toBe("/");
  });

  it("drops the query string, where identifiers and search terms hide", () => {
    expect(normalizePath("/search?q=jordan%20smith")).toBe("/search");
    expect(normalizePath("/scouting?team=254&event=casj")).toBe("/scouting");
    expect(normalizePath("/privacy#analytics")).toBe("/privacy");
  });

  it("collapses uuid, numeric, and opaque segments to :id", () => {
    expect(normalizePath("/team/3f2504e0-4f89-11d3-9a0c-0305e82c3301/hours")).toBe("/team/:id/hours");
    expect(normalizePath("/match/12345")).toBe("/match/:id");
    expect(normalizePath("/invite/Zm9vYmFyYmF6cXV4MTIz")).toBe("/invite/:id");
  });

  it("masks a segment that is not slug-shaped rather than storing it", () => {
    // A name or a sentence that ended up in a path is data, not a route.
    expect(normalizePath("/notes/Jordan Smith")).toBe("/notes/:id");
  });

  it("accepts an absolute URL by keeping only its path", () => {
    expect(normalizePath("https://app.example.com/scouting?q=x")).toBe("/scouting");
  });

  it("falls back to / for anything unusable", () => {
    expect(normalizePath(undefined)).toBe("/");
    expect(normalizePath("")).toBe("/");
    expect(normalizePath(42)).toBe("/");
    expect(normalizePath("mailto:someone@example.com")).toBe("/:id");
  });

  it("never exceeds the column width", () => {
    const long = `/${"segment/".repeat(60)}`;
    expect(normalizePath(long).length).toBeLessThanOrEqual(MAX_PATH_LENGTH);
  });
});

describe("sanitizeMeta", () => {
  it("keeps short label-shaped scalars", () => {
    expect(sanitizeMeta({ feature: "scouting", action: "save", count: 3, first: true })).toEqual({
      feature: "scouting",
      action: "save",
      count: 3,
      first: true,
    });
  });

  it("drops free text rather than truncating it", () => {
    // A truncated sentence is still a sentence somebody typed.
    const meta = sanitizeMeta({ note: "Jordan said the intake jams whenever the belt is even slightly loose" });
    expect(meta).toEqual({});
  });

  it("drops values that are not scalars", () => {
    expect(sanitizeMeta({ nested: { a: 1 }, list: [1, 2], nothing: null })).toEqual({});
  });

  it("drops non-finite numbers", () => {
    expect(sanitizeMeta({ ratio: Number.NaN, size: Number.POSITIVE_INFINITY })).toEqual({});
  });

  it("rejects keys that are not lower_snake labels", () => {
    expect(sanitizeMeta({ "user email": "a", Feature: "b", _x: "c" })).toEqual({});
  });

  it("caps the number of keys", () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 40; i += 1) wide[`k${i}`] = i;
    expect(Object.keys(sanitizeMeta(wide)).length).toBeLessThanOrEqual(8);
  });

  it("stays under the database byte cap", () => {
    const meta = sanitizeMeta({ a: "x".repeat(40), b: "y".repeat(40), c: "z".repeat(40) });
    expect(new TextEncoder().encode(JSON.stringify(meta)).length).toBeLessThanOrEqual(MAX_META_BYTES);
  });

  it("returns an empty object for junk input", () => {
    expect(sanitizeMeta(null)).toEqual({});
    expect(sanitizeMeta("string")).toEqual({});
    expect(sanitizeMeta([1, 2, 3])).toEqual({});
  });
});

describe("validateEvent", () => {
  it("accepts a well-formed event and normalises it", () => {
    const result = validateEvent({
      event: "page_view",
      path: "/team/9999/hours?member=amy",
      deviceClass: "phone",
      meta: { feature: "hours" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      event: "page_view",
      path: "/team/:id/hours",
      deviceClass: "phone",
      meta: { feature: "hours" },
    });
  });

  it("rejects an unknown event name", () => {
    const result = validateEvent({ event: "keystroke", path: "/" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Unknown event name/);
  });

  it("rejects a non-object payload", () => {
    expect(validateEvent(null).ok).toBe(false);
    expect(validateEvent(["page_view"]).ok).toBe(false);
  });

  it("falls back to an unknown device class instead of trusting a made-up one", () => {
    const result = validateEvent({ event: "page_view", path: "/", deviceClass: "iphone-15-pro" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deviceClass).toBe("unknown");
  });
});

describe("validateBatch", () => {
  const good = { event: "page_view", path: "/scouting", deviceClass: "desktop" };

  it("accepts an array or an { events } envelope", () => {
    expect(validateBatch([good]).ok).toBe(true);
    expect(validateBatch({ events: [good] }).ok).toBe(true);
  });

  it("rejects an empty or malformed batch", () => {
    expect(validateBatch([]).ok).toBe(false);
    expect(validateBatch({}).ok).toBe(false);
    expect(validateBatch("nope").ok).toBe(false);
  });

  it("rejects an oversized batch outright", () => {
    const many = Array.from({ length: MAX_BATCH_EVENTS + 1 }, () => good);
    const result = validateBatch(many);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/at most/);
  });

  it("skips bad events instead of discarding the whole batch", () => {
    const result = validateBatch([good, { event: "not_a_real_event" }, good]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.events).toHaveLength(2);
    expect(result.value.rejected).toBe(1);
  });

  it("fails when nothing in the batch is recognised", () => {
    const result = validateBatch([{ event: "nope" }, { event: "also_nope" }]);
    expect(result.ok).toBe(false);
  });
});

describe("deviceClassFromWidth", () => {
  it("buckets into the four allowed values only", () => {
    expect(deviceClassFromWidth(360)).toBe("phone");
    expect(deviceClassFromWidth(767)).toBe("phone");
    expect(deviceClassFromWidth(768)).toBe("tablet");
    expect(deviceClassFromWidth(1023)).toBe("tablet");
    expect(deviceClassFromWidth(1440)).toBe("desktop");
  });

  it("says unknown rather than guessing", () => {
    expect(deviceClassFromWidth(undefined)).toBe("unknown");
    expect(deviceClassFromWidth(0)).toBe("unknown");
    expect(deviceClassFromWidth(Number.NaN)).toBe("unknown");
  });
});
