import { describe, expect, it } from "vitest";
import { competitionSnapshotGapMessage } from "./snapshot";

describe("competitionSnapshotGapMessage", () => {
  it("keeps Team Data for an owner or admin", () => {
    expect(competitionSnapshotGapMessage("2026event", true)).toBe(
      "Match data is not connected for this team yet — open Team Data.",
    );
    expect(competitionSnapshotGapMessage(null, true)).toBe(
      "Set an active event or connect match data under Team Data.",
    );
  });

  it("tells a scout that an owner or admin connects match data", () => {
    expect(competitionSnapshotGapMessage("2026event", false)).toBe(
      "Match data is not connected for this team yet. An owner or admin connects it.",
    );
    expect(competitionSnapshotGapMessage(null, false)).toBe(
      "Set an active event. An owner or admin connects match data.",
    );
    expect(competitionSnapshotGapMessage("2026event", false)).not.toMatch(/Team Data/);
    expect(competitionSnapshotGapMessage(null, false)).not.toMatch(/Team Data/);
  });
});
