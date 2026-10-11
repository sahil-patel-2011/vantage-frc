import { describe, expect, it } from "vitest";
import { emptyEventListCopy } from "./command-event-picker";

// QA A2-05: "Pick your event" opened on "No events found for this year. Load this season's events
// in Team → Data" while the list was still loading (or had failed), a dead end for a new team.
describe("emptyEventListCopy", () => {
  it("never says 'none' while the list is still on its way or failed to arrive", () => {
    expect(emptyEventListCopy("loading", 2026, false)).toMatch(/Loading/);
    expect(emptyEventListCopy("failed", 2026, false)).toMatch(/couldn't load/);
    expect(emptyEventListCopy("loading", 2026, false)).not.toMatch(/No .* events/);
  });

  it("points an empty season at adding the event here, not at another page", () => {
    const copy = emptyEventListCopy("ready", 2027, false);
    expect(copy).toContain("No 2027 events are listed yet");
    expect(copy).toContain("Add it below");
    expect(copy).not.toMatch(/Team → Data|Team Data/);
  });

  it("says a search found nothing, rather than that the season is empty", () => {
    expect(emptyEventListCopy("ready", 2026, true)).toMatch(/No event matches that search/);
  });
});
