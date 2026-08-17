import { describe, expect, it } from "vitest";
import { icsEventsToDrafts, parseIcs } from "../src/ics";
import { hoursDraftsFromCsv, parseCsvHeaders, suggestColumnMap } from "../src";
import { notionPageToDraft } from "../src/notion";

const ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:kickoff-2027
DTSTART:20270109T170000Z
DTEND:20270109T190000Z
SUMMARY:BIOCORE Kickoff
LOCATION:School gym
END:VEVENT
END:VCALENDAR`;

describe("ICS import", () => {
  it("parses VEVENT rows without inventing events", () => {
    const events = parseIcs(ICS);
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe("BIOCORE Kickoff");
    expect(events[0]?.uid).toBe("kickoff-2027");
    expect(icsEventsToDrafts(events)[0]?.kind).toBe("calendar");
  });

  it("skips events without a title or start", () => {
    expect(parseIcs("BEGIN:VEVENT\nUID:x\nEND:VEVENT")).toEqual([]);
  });
});

describe("CSV column map", () => {
  it("guesses scouting identity headers", () => {
    const headers = parseCsvHeaders("Event Key,Team Number,Match Number,Auto Fuel");
    const map = suggestColumnMap(headers);
    expect(map["Event Key"]).toBe("event_key");
    expect(map["Team Number"]).toBe("team_key");
    expect(map["Match Number"]).toBe("match_key");
    expect(map["Auto Fuel"]).toBe("ignore");
  });
});

describe("Hours CSV", () => {
  it("maps person/hours/date rows and skips incomplete lines", () => {
    const drafts = hoursDraftsFromCsv(`Name,Hours,Date
Ada,2.5,2026-09-01
,3,2026-09-01
Sam,0,2026-09-02
Sam,4,not-a-date
`);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.kind).toBe("hours");
    expect(drafts[0]?.title).toBe("Ada");
    expect(drafts[0]?.payload?.hours).toBe(2.5);
  });
});

describe("Notion mapping", () => {
  it("maps a dated database row to a calendar draft", () => {
    const draft = notionPageToDraft({
      id: "p1",
      url: "https://notion.so/p1",
      properties: {
        Name: { type: "title", title: [{ plain_text: "Build night" }] },
        When: { type: "date", date: { start: "2026-09-01T22:00:00.000Z", end: null } },
      },
    });
    expect(draft?.kind).toBe("calendar");
    expect(draft?.title).toBe("Build night");
  });

  it("skips untitled pages", () => {
    expect(notionPageToDraft({ id: "p2", properties: {} })).toBeNull();
  });
});
