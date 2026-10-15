import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Strategy connect student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "app/api/strategy/route.ts"), "utf8");
    expect(src).not.toContain("Connect The Blue Alliance under Team");
    // c63ec3b3f: a failed read no longer answers with a setup card ("Sync Team Data under Team"),
    // since it is not proof the team or event is missing. It says so in plain words instead.
    expect(src).not.toMatch(/status: "setup_required"/);
    expect(src).toContain("your active event has not been cleared");
  });
});
