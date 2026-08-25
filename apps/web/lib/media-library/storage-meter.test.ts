import { describe, expect, it } from "vitest";
import { computeStorageMeter } from "./storage-meter";

describe("computeStorageMeter", () => {
  it("reports real database usage", () => {
    const meter = computeStorageMeter({
      dbBytes: 42.5 * 1024 * 1024,
      dbItemCount: 17,
      nodeBytes: 0,
      nodeItemCount: 0,
    });
    expect(meter.headline).toBe("42.5 MB in the team database across 17 items");
    expect(meter.hint).toBe("Pair a storage node to grow beyond database storage.");
    expect(meter.dbBytes).toBe(42.5 * 1024 * 1024);
  });

  it("uses singular wording for one item", () => {
    const meter = computeStorageMeter({
      dbBytes: 2 * 1024 * 1024,
      dbItemCount: 1,
      nodeBytes: 0,
      nodeItemCount: 0,
    });
    expect(meter.headline).toContain("across 1 item");
    expect(meter.headline).not.toContain("1 items");
  });

  it("is honest about an empty library — no invented numbers", () => {
    const meter = computeStorageMeter({ dbBytes: 0, dbItemCount: 0, nodeBytes: 0, nodeItemCount: 0 });
    expect(meter.headline).toBe("Nothing stored in the team database yet");
    expect(meter.dbBytes).toBe(0);
  });

  it("reports node-hosted bytes when a storage node holds items", () => {
    const meter = computeStorageMeter({
      dbBytes: 10 * 1024 * 1024,
      dbItemCount: 3,
      nodeBytes: 900 * 1024 * 1024,
      nodeItemCount: 12,
    });
    expect(meter.hint).toBe("900.0 MB more lives on your storage node (12 items).");
    expect(meter.nodeItemCount).toBe(12);
  });

  it("clamps garbage input to zero instead of fabricating", () => {
    const meter = computeStorageMeter({
      dbBytes: Number.NaN,
      dbItemCount: -4,
      nodeBytes: Number.NEGATIVE_INFINITY,
      nodeItemCount: Number.NaN,
    });
    expect(meter.dbBytes).toBe(0);
    expect(meter.dbItemCount).toBe(0);
    expect(meter.nodeBytes).toBe(0);
    expect(meter.headline).toBe("Nothing stored in the team database yet");
  });
});
