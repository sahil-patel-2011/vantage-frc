import { describe, expect, it } from "vitest";
import { parseGitHubMilestoneCalendarItems } from "./api";

describe("parseGitHubMilestoneCalendarItems", () => {
  it("keeps open milestones that already have a due date", () => {
    const items = parseGitHubMilestoneCalendarItems([
      {
        number: 4,
        title: "Stop build",
        due_on: "2026-02-18T08:00:00Z",
        html_url: "https://github.com/org/robot-code/milestone/4",
      },
      {
        number: 5,
        title: "No due date",
        due_on: null,
        html_url: "https://github.com/org/robot-code/milestone/5",
      },
      {
        number: 6,
        title: "Bad url",
        due_on: "2026-03-01T00:00:00Z",
        html_url: "/milestone/6",
      },
    ]);
    expect(items).toEqual([
      {
        id: "ms-4",
        title: "Stop build",
        dueOn: "2026-02-18",
        htmlUrl: "https://github.com/org/robot-code/milestone/4",
      },
    ]);
  });

  it("returns an empty list for junk payloads", () => {
    expect(parseGitHubMilestoneCalendarItems(null)).toEqual([]);
    expect(parseGitHubMilestoneCalendarItems({})).toEqual([]);
  });
});
