import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Attendance and Video rescout empty cards", () => {
  it("keeps one EmptyState primary on Attendance leftover cards", () => {
    const src = readFileSync(join(WEB, "app/attendance/attendance-client.tsx"), "utf8");
    expect(src).toMatch(/#att-session-list/);
    expect(src).toMatch(/id="att-add-attendee"/);
    // The add form sits right above the empty card; a button that only jumped to it was a duplicate.
    expect(src).not.toMatch(/Add an attendee/);
    expect(src).toMatch(/New attendance event/);
    expect(src).not.toMatch(/att-empty-actions/);
  });

  it("keeps one EmptyState primary on Video rescout leftover cards", () => {
    const src = readFileSync(join(WEB, "app/video/video-rescout-client.tsx"), "utf8");
    expect(src).toMatch(/#video-new-review/);
    expect(src).toMatch(/#video-team-assign/);
    expect(src).toMatch(/Paste a YouTube link/);
  });
});
