import { describe, expect, it } from "vitest";
import { bootstrapForEvent, scoutingBootstrapUrl } from "./bootstrap-event";

describe("linked scouting event scope", () => {
  it("keeps explicit event reads separate from the active event without rewriting context", () => {
    const linked = { eventKey: "2026txho", reports: ["linked"] };
    const active = { eventKey: "2026txda", reports: ["active"] };
    expect(bootstrapForEvent(active, "2026txho")).toBeNull();
    expect(bootstrapForEvent(linked, "2026txho")).toBe(linked);
    expect(bootstrapForEvent(active, null)).toBe(active);
    expect(bootstrapForEvent(null, "2026txho")).toBeNull();
    expect(bootstrapForEvent({ eventKey: null }, "2026txho")).toBeNull();
    const url = new URL(scoutingBootstrapUrl("team", "2026txho"), "https://vantage.example");
    expect(url.searchParams.get("orgId")).toBe("team");
    expect(url.searchParams.get("eventKey")).toBe("2026txho");
    expect(new URL(scoutingBootstrapUrl("team", null), url).searchParams.has("eventKey")).toBe(false);
  });
});
