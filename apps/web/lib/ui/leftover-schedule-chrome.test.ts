import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

function src(rel: string) {
  return readFileSync(join(WEB, rel), "utf8");
}

describe("leftover Schedule student chrome", () => {
  it("setup is Needs setup and empty drops the setup tone", () => {
    const client = src("app/schedule/schedule-client.tsx");
    expect(client).toMatch(/shell === "setup" \? "Needs setup"/);
    expect(client).not.toMatch(/shell === "setup" \? "Setup"/);
    expect(client).not.toMatch(/badge="Setup"/);
    expect(client).toMatch(/Choose your team/);
    expect(client).toMatch(/No matches yet/);
    expect(client).toMatch(/badgeTone=\{shell === "setup" \? "setup" : ""\}/);
    expect(client).not.toMatch(/shell === "setup" \|\| shell === "empty"/);
  });
});
