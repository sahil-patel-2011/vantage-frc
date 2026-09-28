import { afterEach, describe, expect, it, vi } from "vitest";
const actor = vi.hoisted(() => ({ userId: "owner" as string | null }));
vi.mock("./identity", () => ({ offlineSnapshotUser: async () => actor.userId }));
import { clearFeatureSnapshot, getFeatureSnapshot, personalFeatureCacheKey, putFeatureSnapshot } from "./feature-cache";

function fakeDatabase() {
  const rows = new Map<string, unknown>();
  const request = (value: unknown) => {
    const result = { result: value, onsuccess: (() => {}) as (() => void) };
    queueMicrotask(() => result.onsuccess());
    return result;
  };
  const store = {
    put: (row: { key: string }) => { rows.set(row.key, structuredClone(row)); return request(row.key); },
    get: (key: string) => request(rows.get(key)),
    delete: (key: string) => { rows.delete(key); return request(undefined); },
  };
  vi.stubGlobal("indexedDB", { open: () => request({ transaction: () => ({ objectStore: () => store }), close: vi.fn() }) });
  return rows;
}

describe("personal feature snapshots", () => {
  afterEach(() => { actor.userId = "owner"; vi.unstubAllGlobals(); });
  it("separates two people on the same team and preserves each person's own snapshot", async () => {
    fakeDatabase();
    await putFeatureSnapshot("team-admin", "team", { privateInvitations: ["owner@example.test"] });
    actor.userId = "scout";
    expect(await getFeatureSnapshot("team-admin", "team")).toBeNull();
    await putFeatureSnapshot("team-admin", "team", { privateInvitations: [] });
    await clearFeatureSnapshot("team-admin", "team");
    actor.userId = "owner";
    expect((await getFeatureSnapshot<{ privateInvitations: string[] }>("team-admin", "team"))?.data.privateInvitations).toEqual(["owner@example.test"]);
  });
  it("refuses anonymous, legacy or incorrectly owned cache records", async () => {
    const rows = fakeDatabase();
    rows.set("team-admin:team", { data: { private: true } });
    rows.set(personalFeatureCacheKey("owner", "team-admin", "team"), { userId: "scout", data: { private: true } });
    expect(await getFeatureSnapshot("team-admin", "team")).toBeNull();
    actor.userId = null;
    expect(await getFeatureSnapshot("team-admin", "team")).toBeNull();
    await putFeatureSnapshot("team-admin", "team", { illegal: true });
    expect(rows.size).toBe(2);
  });
});
