import { describe, expect, it } from "vitest";
import { formatScoutFieldHelp } from "../src/scout-intent";

describe("formatScoutFieldHelp", () => {
  it("joins the watch-for paragraph with who uses the answer", () => {
    expect(
      formatScoutFieldHelp({
        helpText: "Fuel this robot scored during auto.",
        helps: ["pick_list", "alliance"],
      }),
    ).toBe("Fuel this robot scored during auto. Helps: Pick list · Alliance");
  });

  it("returns undefined when nothing was written", () => {
    expect(formatScoutFieldHelp({})).toBeUndefined();
  });
});
