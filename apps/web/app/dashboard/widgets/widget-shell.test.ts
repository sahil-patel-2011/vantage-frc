import { describe, expect, it } from "vitest";
import { expectPlainCopy } from "../../../lib/ui/copy-assertions";
import { DASHBOARD_WIDGET_TYPES } from "../../../lib/dashboard/catalog";
import { emptyHintFor, studentWidgetDescription, syncStatusDestination, WIDGET_EMPTY_COPY } from "./widget-empty-copy";

const ENGINEERING = /\b(EPA|org|workspace|Statbotics|TBA sync|The Blue Alliance|setup_required|reference tables)\b/i;

describe("Home widget empty copy", () => {
  it("tells the reader to finish team setup, not a workspace", () => {
    expect(emptyHintFor("quick_actions").body).toMatch(/team/i);
    expect(emptyHintFor("onboarding_checklist").body).toMatch(/team/i);
    expect(emptyHintFor("unknown_widget").body).toMatch(/team/i);
    expect(emptyHintFor("quick_actions").body).not.toMatch(/workspace/i);
    expect(emptyHintFor("onboarding_checklist").body).not.toMatch(/workspace/i);
    expect(emptyHintFor("unknown_widget").body).not.toMatch(/workspace/i);
  });

  it("keeps every catalog empty hint in student words", () => {
    for (const type of DASHBOARD_WIDGET_TYPES) {
      const hint = emptyHintFor(type);
      expectPlainCopy(hint.body);
      expect(hint.body, type).not.toMatch(ENGINEERING);
      expect(hint.title, type).not.toMatch(ENGINEERING);
      if (hint.ctaLabel) {
        expect(hint.ctaLabel).not.toMatch(/\b(Select a |Open command)\b/i);
      }
    }
    expect(Object.keys(WIDGET_EMPTY_COPY).length).toBeGreaterThan(20);
  });

  it("does not paint TBA / Blue Alliance payload messages on empty cards", () => {
    const hint = emptyHintFor("sync_status");
    expect(
      studentWidgetDescription(
        "The Blue Alliance is not connected. Save a key under Team Data before match and ranking cards can fill in.",
        hint,
      ),
    ).toBe(hint.body);
    expect(studentWidgetDescription("Ask a mentor to connect match results so cards can fill in.", hint)).toBe(
      "Ask a mentor to connect match results so cards can fill in.",
    );
  });

  it("keeps Sync status on Scouting unless an owner or admin may open Team Data", () => {
    expect(emptyHintFor("sync_status").ctaHref).toBe("/competition?tab=scouting");
    expect(emptyHintFor("sync_status").ctaLabel).toBe("Open Scouting");
    expect(syncStatusDestination("org-1").href).toBe("/competition?tab=scouting&orgId=org-1");
    expect(syncStatusDestination("org-1", false).label).toBe("Open Scouting");
    expect(syncStatusDestination("org-1", true)).toEqual({
      href: "/team/data?orgId=org-1",
      label: "Open Team Data",
    });
    expect(syncStatusDestination(null, true).href).toBe("/team/data");
  });
});
