import { describe, expect, it, vi } from "vitest";
const cache = vi.hoisted(() => ({ event: vi.fn(), snapshot: vi.fn() }));
vi.mock("../scout-offline", () => ({ cacheEvent: cache.event }));
vi.mock("./snapshot", () => ({ persistScoutingSnapshot: cache.snapshot }));
import { cacheLiveScouting } from "./live-cache";

describe("live scouting cache errors", () => {
  it("returns an actionable notice instead of rejecting the successful online load", async () => {
    cache.event.mockRejectedValueOnce(new Error("Offline cache limit reached."));
    cache.snapshot.mockClear();
    expect(await cacheLiveScouting("team", { matches: [1] })).toBe("Loaded online. Offline cache limit reached.");
    expect(cache.snapshot).not.toHaveBeenCalled();
  });
  it("stores both supported read views on success", async () => {
    cache.event.mockResolvedValueOnce(undefined);
    cache.snapshot.mockResolvedValueOnce(undefined);
    expect(await cacheLiveScouting("team", { matches: [2] })).toBeNull();
    expect(cache.snapshot).toHaveBeenCalledWith("team", { matches: [2] });
  });
});
