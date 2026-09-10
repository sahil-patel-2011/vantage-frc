import { describe, expect, it } from "vitest";
import { emptyHintFor } from "./widget-shell";

describe("Home widget empty copy", () => {
  it("tells the reader to finish team setup, not a workspace", () => {
    expect(emptyHintFor("quick_actions").body).toMatch(/team/i);
    expect(emptyHintFor("onboarding_checklist").body).toMatch(/team/i);
    expect(emptyHintFor("unknown_widget").body).toMatch(/team/i);
    expect(emptyHintFor("quick_actions").body).not.toMatch(/workspace/i);
    expect(emptyHintFor("onboarding_checklist").body).not.toMatch(/workspace/i);
    expect(emptyHintFor("unknown_widget").body).not.toMatch(/workspace/i);
  });
});
