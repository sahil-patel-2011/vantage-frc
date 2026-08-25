import { describe, expect, it } from "vitest";
import { MAX_PUSH_PAYLOAD_BYTES } from "./encrypt";
import { buildPushPayload, safePushUrl, truncateUtf8 } from "./payload";

describe("truncateUtf8", () => {
  it("leaves short text alone", () => {
    expect(truncateUtf8("Qual 31 in 7 minutes", 200)).toBe("Qual 31 in 7 minutes");
  });

  it("never splits a multi-byte character", () => {
    const text = "🤖".repeat(10); // 4 bytes each
    const cut = truncateUtf8(text, 15);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.includes("�")).toBe(false);
    expect(Buffer.byteLength(cut, "utf8")).toBeLessThanOrEqual(15);
  });

  it("keeps accented characters intact at the boundary", () => {
    const cut = truncateUtf8("Café Robotique Montréal scouting reminder", 12);
    expect(cut.includes("�")).toBe(false);
    expect(Buffer.byteLength(cut, "utf8")).toBeLessThanOrEqual(12);
  });

  it("returns empty when there is no room for content plus the ellipsis", () => {
    expect(truncateUtf8("anything", 3)).toBe("");
  });
});

describe("safePushUrl", () => {
  it("accepts same-origin app paths", () => {
    expect(safePushUrl("/scouting?match=qm31")).toBe("/scouting?match=qm31");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safePushUrl("https://evil.example/steal")).toBeUndefined();
    expect(safePushUrl("//evil.example")).toBeUndefined();
    expect(safePushUrl("javascript:alert(1)")).toBeUndefined();
    expect(safePushUrl(undefined)).toBeUndefined();
  });
});

describe("buildPushPayload", () => {
  it("emits only the fields the service worker reads", () => {
    const payload = JSON.parse(
      buildPushPayload({
        title: "Qual 31 in 7 minutes",
        body: "You are scouting frc254 (red 2).",
        url: "/scouting?match=2026week0_qm31",
        tag: "scout:2026week0_qm31",
        type: "scout_reminder",
        urgent: true,
      }),
    );
    expect(payload).toEqual({
      title: "Qual 31 in 7 minutes",
      type: "scout_reminder",
      tag: "scout:2026week0_qm31",
      url: "/scouting?match=2026week0_qm31",
      urgent: true,
      body: "You are scouting frc254 (red 2).",
    });
  });

  it("drops an unsafe url rather than shipping it to the service worker", () => {
    const payload = JSON.parse(
      buildPushPayload({ title: "Match result", url: "https://evil.example" }),
    );
    expect(payload.url).toBeUndefined();
  });

  it("falls back to a title when one is missing", () => {
    expect(JSON.parse(buildPushPayload({ title: "   " })).title).toBe("Vantage");
  });

  it("keeps the whole payload inside one aes128gcm record", () => {
    const serialized = buildPushPayload({
      title: "Schedule updated",
      body: "x".repeat(20_000),
      url: "/schedule",
    });
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    const payload = JSON.parse(serialized);
    expect(payload.title).toBe("Schedule updated");
    expect(payload.body.endsWith("…")).toBe(true);
  });

  it("omits an empty body instead of sending an empty string", () => {
    expect(JSON.parse(buildPushPayload({ title: "Ping", body: "  " })).body).toBeUndefined();
  });
});
