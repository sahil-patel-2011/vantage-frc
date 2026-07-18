import { describe, expect, it, vi } from "vitest";
import { SYNC_BACKOFF_BASE_MS, SYNC_BACKOFF_MAX_MS, syncBackoffMs, withSyncBackoff } from "./sync-backoff";

describe("syncBackoffMs", () => {
  it("grows exponentially and caps", () => {
    expect(syncBackoffMs(0)).toBe(SYNC_BACKOFF_BASE_MS);
    expect(syncBackoffMs(1)).toBe(SYNC_BACKOFF_BASE_MS * 2);
    expect(syncBackoffMs(2)).toBe(SYNC_BACKOFF_BASE_MS * 4);
    expect(syncBackoffMs(10)).toBe(SYNC_BACKOFF_MAX_MS);
  });
});

describe("withSyncBackoff", () => {
  it("returns on first success", async () => {
    const run = vi.fn().mockResolvedValue(42);
    await expect(withSyncBackoff(run, { maxAttempts: 3, isOnline: () => true })).resolves.toBe(42);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries then succeeds", async () => {
    vi.useFakeTimers();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("flaky"))
      .mockResolvedValueOnce("ok");
    const onRetry = vi.fn();
    const promise = withSyncBackoff(run, {
      maxAttempts: 3,
      onRetry,
      isOnline: () => true,
    });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("stops when offline", async () => {
    let online = true;
    const run = vi.fn().mockImplementation(async () => {
      online = false;
      throw new Error("network");
    });
    await expect(
      withSyncBackoff(run, { maxAttempts: 5, isOnline: () => online }),
    ).rejects.toThrow(/network|Offline/i);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
