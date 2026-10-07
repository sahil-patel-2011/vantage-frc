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
  it("verifies personal caches against the account instead of a nonexistent team", async () => {
    vi.stubGlobal("window", { sessionStorage: storage(), localStorage: storage(), addEventListener: vi.fn() });
    const { offlineSnapshotUser } = await import("./identity");
    probe.read.mockResolvedValue({ userId: "owner", memberships: [{ orgId: "team-b" }] });
    expect(await offlineSnapshotUser("_")).toBe("owner");
    expect(probe.read).toHaveBeenLastCalledWith(null);
    await offlineSnapshotUser("team-b");
    expect(probe.read).toHaveBeenLastCalledWith("team-b");
  });
  it("uses server identity after an account switch and permits only that tab's verified offline identity", async () => {
    const windowStub = { sessionStorage: storage(), localStorage: storage(), addEventListener: vi.fn(), location: { replace: vi.fn() } };
    vi.stubGlobal("window", windowStub);
    const { offlineSnapshotUser } = await import("./identity");
    probe.read.mockResolvedValueOnce({ userId: "owner", orgId: "team" }).mockResolvedValueOnce({ userId: "scout", orgId: "team" }).mockResolvedValue(null);
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
    probe.read.mockResolvedValueOnce({ userId: "owner", orgId: "team" }).mockResolvedValue(null);
    expect(await offlineSnapshotUser("team")).toBe("owner");
    probe.unreachable.mockReturnValue(false);
    expect(await offlineSnapshotUser("team")).toBeNull();
    forgetOfflineIdentity();
    probe.read.mockResolvedValue({ userId: "owner", orgId: "team" });
    expect(await offlineSnapshotUser("team")).toBeNull();
  });
  it("removes the previous person's rendered page when another tab changes accounts", async () => {
    const windowStub = { sessionStorage: storage(), localStorage: storage(), addEventListener: vi.fn(), location: { replace: vi.fn() } };
    vi.stubGlobal("window", windowStub);
    const { offlineSnapshotUser } = await import("./identity");
    probe.read.mockResolvedValue({ userId: "owner", orgId: "team" });
    await offlineSnapshotUser("team");
    const handler = windowStub.addEventListener.mock.calls[0][1] as (event: { key: string; newValue: string }) => void;
    handler({ key: "vantage-session-user", newValue: "scout" });
    expect(windowStub.location.replace).toHaveBeenCalledWith("/signin");
    expect(await offlineSnapshotUser("team")).toBeNull();
  });
  it("requires actual team membership before reading a team's offline copy", async () => {
    vi.stubGlobal("window", { sessionStorage: storage(), localStorage: storage(), addEventListener: vi.fn() });
    const { offlineSnapshotUser } = await import("./identity");
    probe.read.mockResolvedValue({ userId: "owner", memberships: [{ orgId: "another-team" }] });
    expect(await offlineSnapshotUser("team")).toBeNull();
    expect(await offlineSnapshotUser("_")).toBe("owner");
    probe.read.mockResolvedValue(null);
    probe.unreachable.mockReturnValue(true);
    expect(await offlineSnapshotUser("team")).toBeNull();
  });
  it("keeps a departed team inaccessible offline until fresh membership confirms a rejoin", async () => {
    vi.stubGlobal("window", { sessionStorage: storage(), localStorage: storage(), addEventListener: vi.fn() });
    const { offlineSnapshotUser, forgetOfflineTeam } = await import("./identity");
    probe.read.mockResolvedValueOnce({ userId: "owner", orgId: "team" }).mockResolvedValue(null);
    expect(await offlineSnapshotUser("team")).toBe("owner");
    forgetOfflineTeam("team", "owner");
    probe.unreachable.mockReturnValue(true);
    expect(await offlineSnapshotUser("team")).toBeNull();
    probe.read.mockResolvedValueOnce({ userId: "owner", orgId: "team" });
    expect(await offlineSnapshotUser("team")).toBe("owner");
    expect(await offlineSnapshotUser("team")).toBe("owner");
  });
  it("does not let an old in-flight membership answer undo a departure", async () => {
    vi.stubGlobal("window", { sessionStorage: storage(), localStorage: storage(), addEventListener: vi.fn() });
    const { offlineSnapshotUser, forgetOfflineTeam } = await import("./identity");
    let finish!: (value: unknown) => void;
    probe.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = offlineSnapshotUser("team");
    forgetOfflineTeam("team", "owner");
    finish({ userId: "owner", orgId: "team" });
    expect(await pending).toBeNull();
  });
  it.each(["?orgId=team", ""])("removes the departed team's rendered view in another tab: %s", async search => {
    const windowStub = { sessionStorage: storage(), localStorage: storage(), addEventListener: vi.fn(), location: { search, replace: vi.fn() } };
    vi.stubGlobal("window", windowStub);
    const { offlineSnapshotUser } = await import("./identity");
    probe.read.mockResolvedValue({ userId: "owner", orgId: "team" });
    await offlineSnapshotUser("team");
    const handler = windowStub.addEventListener.mock.calls[0][1] as (event: { key: string; newValue: string }) => void;
    handler({ key: "vantage-team-revoked:owner:team", newValue: "1" });
    expect(windowStub.location.replace).toHaveBeenCalledWith("/account/teams");
    probe.read.mockResolvedValue(null);
    probe.unreachable.mockReturnValue(true);
    expect(await offlineSnapshotUser("team")).toBeNull();
  });
  it("keeps another selected team open when a different team is left", async () => {
    const windowStub = { sessionStorage: storage(), localStorage: storage(), addEventListener: vi.fn(), location: { search: "?orgId=other-team", replace: vi.fn() } };
    vi.stubGlobal("window", windowStub);
    const { offlineSnapshotUser } = await import("./identity");
    probe.read.mockResolvedValue({ userId: "owner", orgId: "team" });
    await offlineSnapshotUser("team");
    const handler = windowStub.addEventListener.mock.calls[0][1] as (event: { key: string; newValue: string }) => void;
    handler({ key: "vantage-team-revoked:owner:team", newValue: "1" });
    expect(windowStub.location.replace).not.toHaveBeenCalled();
  });
});
