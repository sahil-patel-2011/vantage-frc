import { describe, expect, it } from "vitest";
import { previewCsvHeaders, previewIcs, previewNotionJson } from "./compute-migrate";

describe("migrate previews", () => {
  it("parses ICS paste into calendar drafts", () => {
    const drafts = previewIcs(`BEGIN:VEVENT
UID:a1
DTSTART:20270109T170000Z
SUMMARY:Kickoff
END:VEVENT`);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.kind).toBe("calendar");
  });

  it("guesses scout CSV headers without inventing identity", () => {
    const preview = previewCsvHeaders("Event Key,Team Number,Hours");
    expect(preview.columnMap["Event Key"]).toBe("event_key");
    expect(preview.columnMap["Hours"]).toBe("hours");
  });

  it("maps Notion JSON pages and skips untitled ones", () => {
    const drafts = previewNotionJson(
      JSON.stringify([
        {
          id: "p1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Wiki home" }] },
          },
        },
        { id: "p2", properties: {} },
      ]),
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.kind).toBe("knowledge");
  });
});
