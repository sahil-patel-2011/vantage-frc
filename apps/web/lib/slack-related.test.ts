import { describe, expect, it } from "vitest";
import { formatSlackBridgePostCount, slackNextActions, slackRelatedLinks } from "./slack-related";

describe("slack related", () => {
  it("points at team chat and never uses DEMO copy", () => {
    const links = slackRelatedLinks("org-1");
    expect(links.map((l) => l.id)).toEqual(["messages", "discord", "account"]);
    expect(links.find((l) => l.id === "messages")?.href).toContain("tab=messages");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
  });

  it("asks for a webhook before inventing a connected bridge", () => {
    const actions = slackNextActions({ orgId: "org-1", configured: false });
    expect(actions[0]?.id).toBe("webhook");
    expect(actions[0]?.primary).toBe(true);
    expect(formatSlackBridgePostCount(null)).toBeNull();
    expect(formatSlackBridgePostCount({ posted: 2, failed: 0 })).toBe("2 posted · 0 failed");
  });
});
