import { describe, expect, it } from "vitest";
import { quarantineItemLabel } from "./scouting-quarantine";
import type { QuarantinedItem } from "../../lib/scout-offline";

describe("quarantineItemLabel", () => {
  it("names a pit entry by team", () => {
    const item = {
      kind: "entry",
      entry: { type: "pit", teamKey: "frc6925", matchKey: null },
    } as QuarantinedItem;
    expect(quarantineItemLabel(item)).toBe("Pit entry · frc6925");
  });

  it("names a match entry with the match key", () => {
    const item = {
      kind: "entry",
      entry: { type: "match", teamKey: "frc6925", matchKey: "2026e2ewx_qm1" },
    } as QuarantinedItem;
    expect(quarantineItemLabel(item)).toBe("Match entry · frc6925 · 2026e2ewx_qm1");
  });
});
