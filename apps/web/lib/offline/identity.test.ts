import { afterEach, describe, expect, it, vi } from "vitest";

const probe = vi.hoisted(() => ({ read: vi.fn(), unreachable: vi.fn(), invalidate: vi.fn() }));
vi.mock("../nav/product-session", () => ({
  fetchProductSession: probe.read, productSessionUnreachable: probe.unreachable, invalidateProductSession: probe.invalidate,
}));

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
}

describe("authenticated offline identity on shared devices", () => {
  afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it("uses server identity after an account switch and permits only that tab's verified offline identity", async () => {
    const windowStub = { sessionStorage: storage(), localStorage: storage(), addEventListener: vi.fn(), location: { replace: vi.fn() } };
    vi.stubGlobal("window", windowStub);
    const { offlineSnapshotUser } = await import("./identity");
    probe.read.mockResolvedValueOnce({ userId: "owner" }).mockResolvedValueOnce({ userId: "scout" }).mockResolvedValue(null);
    expect(await offlineSnapshotUser("team")).toBe("owner");
    expect(await offlineSnapshotUser("team")).toBe("scout");
    probe.unreachable.mockReturnValue(true);
    expect(await offlineSnapshotUser("team")).toBe("scout");
    windowStub.localStorage.setItem("vantage-session-user", "other-person");
    expect(await offlineSnapshotUser("team")).toBeNull();
  });
  it("never reuses cached identity after authentication rejection or explicit sign-out", async () => {
    vi.stubGlobal("window", { sessionStorage: storage(), localStorage: storage(), addEventListener: vi.fn() });
    const { offlineSnapshotUser, forgetOfflineIdentity } = await import("./identity");
    probe.read.mockResolvedValueOnce({ userId: "owner" }).mockResolvedValue(null);
    expect(await offlineSnapshotUser("team")).toBe("owner");
    probe.unreachable.mockReturnValue(false);
    expect(await offlineSnapshotUser("team")).toBeNull();
    forgetOfflineIdentity();
    probe.read.mockResolvedValue({ userId: "owner" });
    expect(await offlineSnapshotUser("team")).toBeNull();
  });
  it("removes the previous person's rendered page when another tab changes accounts", async () => {
    const windowStub = { sessionStorage: storage(), localStorage: storage(), addEventListener: vi.fn(), location: { replace: vi.fn() } };
    vi.stubGlobal("window", windowStub);
    const { offlineSnapshotUser } = await import("./identity");
    probe.read.mockResolvedValue({ userId: "owner" });
    await offlineSnapshotUser("team");
    const handler = windowStub.addEventListener.mock.calls[0][1] as (event: { key: string; newValue: string }) => void;
    handler({ key: "vantage-session-user", newValue: "scout" });
    expect(windowStub.location.replace).toHaveBeenCalledWith("/signin");
    expect(await offlineSnapshotUser("team")).toBeNull();
  });
});
