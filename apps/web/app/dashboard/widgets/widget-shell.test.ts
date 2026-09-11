import { describe, expect, it } from "vitest";
import { expectPlainCopy } from "../../../lib/ui/copy-assertions";
import { DASHBOARD_WIDGET_TYPES } from "../../../lib/dashboard/catalog";
import { emptyHintFor, WIDGET_EMPTY_COPY } from "./widget-empty-copy";

const ENGINEERING = /\b(EPA|org|workspace|Statbotics|TBA sync|setup_required|reference tables)\b/i;

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
});
