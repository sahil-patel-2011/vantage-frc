import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Lineup sync student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "app/scouting/lineup/lineup-client.tsx"), "utf8");
    expect(src).not.toContain("Sync TBA after the event schedule publishes");
    expect(src).toContain("Sync Team Data after the event schedule publishes");
  });
});
