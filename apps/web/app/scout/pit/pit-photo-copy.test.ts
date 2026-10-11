import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MEDIA_ENABLED } from "../../../lib/media-availability";

const field = readFileSync(join(__dirname, "..", "..", "scouting", "scouting-field.tsx"), "utf8");
const pitForm = readFileSync(join(__dirname, "quick-pit-form.tsx"), "utf8");

describe("pit photos while uploads are off", () => {
  it("does not offer a camera that keeps nothing", () => {
    expect(MEDIA_ENABLED).toBe(false);
    // Quick pit renders photo questions without an upload handler; the chosen photo vanished.
    expect(field).toMatch(/!MEDIA_ENABLED \|\| !onAttachRobotImage/);
    expect(field).not.toMatch(/photos queue on this device until sync/);
  });

  it("tells a scout looking for a camera why there is none", () => {
    expect(pitForm).toMatch(/Photos can’t be added here/);
  });
});
