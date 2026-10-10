import { describe, expect, it } from "vitest";
import { assignmentWorkspaceHref } from "./assignment-navigation";

describe("one assignment workspace", () => {
  it("shares the actual event, focus and filters and retains them in review", () => {
    const scope = { orgId: "team", eventKey: "2026test", matchKey: "2026test_qm12", qualsOnly: false };
    const url = new URL(assignmentWorkspaceHref(scope), "https://vantage.example");
    expect(url.pathname).toBe("/scout-coverage-live");
    expect(Object.fromEntries(url.searchParams)).toEqual({ orgId: "team", eventKey: "2026test", matchKey: "2026test_qm12", qualsOnly: "0" });
    expect(new URL(assignmentWorkspaceHref({ ...scope, view: "review" }), "https://vantage.example").searchParams.get("view")).toBe("review");
  });
});
