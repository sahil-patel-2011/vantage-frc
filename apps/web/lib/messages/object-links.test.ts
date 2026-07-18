import { describe, expect, it } from "vitest";
import {
  discussInMessagesHref,
  normalizeObjectType,
  objectAppHref,
  parseComposerLinkFromSearch,
  parseObjectLinkInput,
} from "./object-links";

const ORG = "11111111-1111-4111-8111-111111111111";

describe("parseObjectLinkInput", () => {
  it("accepts a valid object link", () => {
    expect(
      parseObjectLinkInput({
        objectType: "task",
        objectId: "abc",
        label: "Wire harness",
        href: "/todos?id=abc",
      }),
    ).toEqual({
      objectType: "task",
      objectId: "abc",
      label: "Wire harness",
      href: "/todos?id=abc",
    });
  });

  it("rejects unknown types and empty labels", () => {
    expect(parseObjectLinkInput({ objectType: "widget", objectId: "1", label: "x" })).toBeNull();
    expect(parseObjectLinkInput({ objectType: "task", objectId: "1", label: "" })).toBeNull();
  });
});

describe("normalizeObjectType and href helpers", () => {
  it("normalizes object type strings", () => {
    expect(normalizeObjectType("EVENT")).toBe("event");
    expect(normalizeObjectType("widget")).toBeNull();
  });

  it("builds app and discuss links", () => {
    expect(objectAppHref(ORG, "event", "evt-1")).toContain("/team/calendar");
    expect(objectAppHref(ORG, "event", "evt-1")).toContain("eventId=evt-1");
    const discuss = discussInMessagesHref(ORG, "event", "evt-1", "Shop night");
    expect(discuss).toContain("/team?");
    expect(discuss).toContain("tab=messages");
    expect(discuss).toContain("linkType=event");
    expect(discuss).toContain("linkLabel=Shop");
    expect(objectAppHref(ORG, "knowledge", "page-1")).toContain("tab=knowledge");
    expect(objectAppHref(ORG, "knowledge", "page-1")).toContain("pageId=page-1");
  });

  it("parses composer prefill from search params", () => {
    const params = new URLSearchParams({
      orgId: ORG,
      linkType: "task",
      linkId: "todo-9",
      linkLabel: "Battery cart",
    });
    expect(parseComposerLinkFromSearch(params, ORG)).toMatchObject({
      objectType: "task",
      objectId: "todo-9",
      label: "Battery cart",
    });
  });
});
