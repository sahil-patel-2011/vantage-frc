import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("scouting hub Collection-class match job", () => {
  it("keeps the job on the existing Match/Pit hub, not a second app", () => {
    const ready = readFileSync(join(WEB, "app/scouting/scouting-ready-view.tsx"), "utf8");
    expect(ready).toContain("ScoutNextAssignment");
    expect(ready).toContain("ScoutMatchJobFields");
    expect(ready).toContain("This event's reports");
    expect(ready).toContain("Show QR");
    expect(ready).toMatch(/Save this \$\{type\}/);
    expect(ready).not.toMatch(/lovat-kit|win-kit/);
    expect(ready).not.toContain("dbAdmin");
  });
});
