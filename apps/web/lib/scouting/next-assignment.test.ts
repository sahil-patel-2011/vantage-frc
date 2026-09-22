import { describe, expect, it } from "vitest";
import { matchOrderKey, nextAssignedTarget } from "./next-assignment";

const E = "2026casj";

describe("matchOrderKey", () => {
  it("orders quals before playoffs and playoffs by set then match", () => {
    expect(matchOrderKey(`${E}_qm12`)).toEqual([0, 12, 0]);
    expect(matchOrderKey(`${E}_sf2m1`)).toEqual([3, 2, 1]);
    expect(matchOrderKey(`${E}_f1m3`)).toEqual([4, 1, 3]);
    expect(matchOrderKey("nonsense")).toBeNull();
  });
});

describe("nextAssignedTarget", () => {
  const assignments = [
    { matchKey: `${E}_qm15`, teamKey: "frc254" },
    { matchKey: `${E}_qm12`, teamKey: "frc1678" },
    { matchKey: `${E}_qm13`, teamKey: "frc118", role: "backup" },
    { matchKey: `${E}_qm30`, teamKey: "frc971", role: "Red 2" },
    { matchKey: `2025other_qm14`, teamKey: "frc1" },
  ];

  it("jumps to the next assigned match AND robot, skipping backups", () => {
    expect(nextAssignedTarget(assignments, `${E}_qm12`)).toEqual({ matchKey: `${E}_qm15`, teamKey: "frc254" });
  });

  it("uses numeric order, not string order", () => {
    expect(nextAssignedTarget(assignments, `${E}_qm15`)).toEqual({ matchKey: `${E}_qm30`, teamKey: "frc971" });
  });

  it("returns null after the last assignment so the caller steps the match number", () => {
    expect(nextAssignedTarget(assignments, `${E}_qm30`)).toBeNull();
    expect(nextAssignedTarget([], `${E}_qm1`)).toBeNull();
  });

  it("never follows an assignment from another event", () => {
    expect(nextAssignedTarget([{ matchKey: `2025other_qm14`, teamKey: "frc1" }], `${E}_qm1`)).toBeNull();
  });

  it("moves from quals into playoffs", () => {
    expect(nextAssignedTarget([{ matchKey: `${E}_sf1m1`, teamKey: "frc5" }], `${E}_qm80`)).toEqual({
      matchKey: `${E}_sf1m1`,
      teamKey: "frc5",
    });
  });

  it("does nothing for a hand-typed key it cannot order", () => {
    expect(nextAssignedTarget(assignments, "custom")).toBeNull();
  });
});
