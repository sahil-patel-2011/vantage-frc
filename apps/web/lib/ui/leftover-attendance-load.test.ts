import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Attendance load-failure chrome", () => {
  it("failed refresh is Unavailable, not a Setup badge", () => {
    const src = readFileSync(join(WEB, "app/attendance/attendance-client.tsx"), "utf8");
    expect(src).toMatch(/fetchFailed \? "Unavailable"/);
    expect(src).not.toMatch(/fetchFailed \? "Setup"/);
    expect(src).not.toMatch(/badge="Setup"/);
    expect(src).not.toMatch(/badgeTone=\{fetchFailed/);
  });
});
