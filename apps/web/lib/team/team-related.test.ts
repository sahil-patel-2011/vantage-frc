import { describe, expect, it } from "vitest";
import {
  MESSAGES_RELATED_INCLUDE,
  teamHubRelatedLinks,
} from "./team-related";

describe("team-related Soft-UI helpers", () => {
  it("builds org-scoped Team hub cross-links", () => {
    const links = teamHubRelatedLinks("org-1");
    expect(links.find((l) => l.id === "calendar")?.href).toBe("/team?tab=calendar&orgId=org-1");
    expect(links.find((l) => l.id === "messages")?.href).toBe("/team?tab=messages&orgId=org-1");
    expect(links.every((l) => l.href.includes("orgId=org-1"))).toBe(true);
  });

  it("excludes the active surface and respects Messages include", () => {
    const links = teamHubRelatedLinks("org-1", {
      active: "messages",
      include: MESSAGES_RELATED_INCLUDE,
    });
    expect(links.map((l) => l.id)).toEqual(["calendar", "todos", "attendance", "knowledge"]);
  });

  it("never uses DEMO labels", () => {
    const links = teamHubRelatedLinks("org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
  });

  it("names Team workbenches the same way the hub tabs do", () => {
    const labels = Object.fromEntries(teamHubRelatedLinks("org-1").map((link) => [link.id, link.label]));
    expect(labels).toMatchObject({
      calendar: "Calendar",
      messages: "Chat",
      attendance: "People",
      todos: "Work",
      knowledge: "Playbook",
      fmea: "Failure log",
    });
  });
});
