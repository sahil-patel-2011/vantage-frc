import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Dossier EPA label student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "app/dossier/dossier-client.tsx"), "utf8");
    expect(src).not.toContain("<small>Statbotics EPA</small>");
    expect(src).toContain("<small>Team Data rating</small>");
  });
});
