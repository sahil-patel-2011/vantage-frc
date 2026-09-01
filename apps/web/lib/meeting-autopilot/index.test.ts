import { describe, expect, it } from "vitest";
import { buildAgendaItems, parseActionItemsFromMinutes, summarizeAgendaSources } from ".";

describe("parseActionItemsFromMinutes", () => {
  it("returns no action items when minutes are empty — never DEMO follow-ups", () => {
    expect(parseActionItemsFromMinutes("")).toEqual([]);
    expect(parseActionItemsFromMinutes("   \n\n  ")).toEqual([]);
    expect(parseActionItemsFromMinutes("Meeting started at 6pm with 12 members present.")).toEqual([]);
  });

  it("extracts only bulleted / TODO / Action lines", () => {
    const items = parseActionItemsFromMinutes(
      [
        "Notes from the shop.",
        "- Order replacement belt @Alex due 2026-07-25",
        "TODO: Finish wiring diagram review",
        "Action: File the grant packet",
        "We talked about scouting but wrote nothing down.",
      ].join("\n"),
    );
    expect(items.map((item) => item.title)).toEqual([
      "Order replacement belt",
      "Finish wiring diagram review",
      "File the grant packet",
    ]);
    expect(items[0]?.owner).toBe("Alex");
    expect(items[0]?.dueOn).toBe("2026-07-25");
  });
});

describe("buildAgendaItems", () => {
  it("builds nothing when every source is empty", () => {
    const empty = { blockers: [], overdueTasks: [], decisions: [], fmeaFailures: [] };
    expect(buildAgendaItems(empty)).toEqual([]);
    expect(summarizeAgendaSources(empty)).toEqual({
      blockers: 0,
      overdueTasks: 0,
      decisions: 0,
      fmea: 0,
    });
  });
});
