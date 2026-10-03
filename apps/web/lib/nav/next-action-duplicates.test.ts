import { describe, expect, it } from "vitest";
import { destinationKey, duplicateNextActions } from "./next-action-duplicates";

const BASE = "https://vantage.test/dossier?orgId=team-1";

describe("next actions never repeat a link the page already shows", () => {
  it("treats a destination as the same place with or without the team id", () => {
    expect(destinationKey("/strategy?orgId=team-1&tab=picks", BASE)).toBe(destinationKey("/strategy?tab=picks", BASE));
    expect(destinationKey("/competition/?tab=scouting", BASE)).toBe(destinationKey("/competition?tab=scouting&orgId=team-1", BASE));
  });

  it("keeps different tabs and different in-page targets apart", () => {
    expect(destinationKey("/competition?tab=scouting", BASE)).not.toBe(destinationKey("/competition?tab=strategy", BASE));
    expect(destinationKey("#add", BASE)).not.toBe(destinationKey("#edit", BASE));
    // An in-page target is this page: it is not the same as the page itself.
    expect(destinationKey("#add", BASE)).toBe("https://vantage.test/dossier#add");
  });

  it("marks the actions the related links already offer and keeps the rest", () => {
    const actions = ["/dossier?orgId=team-1", "/competition?tab=strategy&orgId=team-1", "/team/data?orgId=team-1"];
    const related = ["/intel?orgId=team-1", "/competition?orgId=team-1&tab=strategy"];
    expect(duplicateNextActions(actions, related, BASE)).toEqual([false, true, false]);
  });

  it("marks a second next action to the same place", () => {
    expect(duplicateNextActions(["#add", "#add", "/hours"], [], BASE)).toEqual([false, true, false]);
  });

  it("never hides something it cannot read as a destination", () => {
    expect(duplicateNextActions(["mailto:coach@example.test", "javascript:void(0)"], ["mailto:coach@example.test"], BASE)).toEqual([false, false]);
  });
});
