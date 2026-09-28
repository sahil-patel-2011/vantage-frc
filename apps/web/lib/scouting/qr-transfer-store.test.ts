import { IDBFactory } from "fake-indexeddb";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { recordScoutAction } from "@vantage/scouting";
import { encodeScoutQrFrames } from "@vantage/scouting/qr-transfer";
import { listPendingEntries, mergeQrHandoffIntoOutbox } from "../scout-offline";

const identity = vi.hoisted(() => ({ user: "a" as string | null }));
vi.mock("../offline/identity", () => ({ offlineSnapshotUser: async () => identity.user }));
async function frames() {
  let payload: Record<string, unknown> = {};
  for (let index = 0; index < 8; index++) payload = recordScoutAction(payload, { ...payload, score: index % 2 }, { id: `action-${index}`, at: `2026-09-26T12:00:0${index}Z` });
  return { payload, codes: await encodeScoutQrFrames([{ clientId: "original", eventKey: "2026test", matchKey: "2026test_qm1", teamKey: "frc1", payload, updatedAt: "2026-09-26T12:00:09Z" }]) };
}
const receive = (content: string, orgId = "team-a") => mergeQrHandoffIntoOutbox({ content, orgId, type: "match", schemaId: "schema" });

describe("personal persistent multipart QR receiving", () => {
  beforeEach(() => { identity.user = "a"; vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("navigator", { onLine: false }); });
  afterEach(() => vi.unstubAllGlobals());
  it("commits only a verified complete transfer, preserves history and ignores repeated imports", async () => {
    const { payload, codes } = await frames();
    const first = await receive(codes[0]!);
    expect(first.mode).toBe("partial"); expect(first.transfer?.received).toBe(1);
    expect(await listPendingEntries()).toEqual([]);
    expect((await receive(codes[0]!)).transfer?.received).toBe(1);
    for (const code of codes.slice(1, -1)) await receive(code);
    expect(await listPendingEntries()).toEqual([]);
    expect((await receive(codes.at(-1)!)).accepted).toBe(1);
    expect((await listPendingEntries())[0]?.payload).toEqual(payload);
    for (const code of codes.slice(0, -1)) await receive(code);
    expect((await receive(codes.at(-1)!)).ignored).toBe(1);
    expect(await listPendingEntries()).toHaveLength(1);
  });
  it("keeps incomplete transfers apart across people and organizations", async () => {
    const { codes } = await frames();
    await receive(codes[0]!);
    identity.user = "b";
    for (const code of codes.slice(1)) expect((await receive(code)).mode).toBe("partial");
    expect(await listPendingEntries()).toEqual([]);
    identity.user = "a";
    for (const code of codes.slice(1)) expect((await receive(code, "team-b")).mode).toBe("partial");
    expect(await listPendingEntries()).toEqual([]);
    for (const code of codes.slice(1)) await receive(code);
    expect((await listPendingEntries("team-a"))[0]?.clientId).toBe("original");
    expect(await listPendingEntries("team-b")).toEqual([]);
    identity.user = "b";
    expect(await listPendingEntries()).toEqual([]);
  });
  it("recovers incomplete parts through a fresh module and rejects anonymous receiving", async () => {
    const { codes } = await frames();
    await receive(codes[0]!);
    vi.resetModules();
    const reopened = await import("../scout-offline");
    for (const content of codes.slice(1)) await reopened.mergeQrHandoffIntoOutbox({ content, orgId: "team-a", type: "match", schemaId: "schema" });
    expect(await reopened.listPendingEntries()).toHaveLength(1);
    identity.user = null;
    await expect(receive(codes[0]!)).rejects.toThrow(/Sign in/);
  });
  it("accepts pasted lines together, retains prior progress on malformed input and deduplicates a whole replay", async () => {
    const { payload, codes } = await frames();
    expect((await receive(codes[0]!)).transfer?.received).toBe(1);
    await expect(receive(codes[1]! + "\n" + "vantage://scout-part/broken")).rejects.toThrow(/invalid/);
    expect((await receive(codes[0]!)).transfer?.received).toBe(1);
    expect((await receive(codes.slice(1).join("\r\n"))).accepted).toBe(1);
    expect((await listPendingEntries())[0]?.payload).toEqual(payload);
    expect((await receive(codes.join("\n"))).ignored).toBe(1);
    expect(await listPendingEntries()).toHaveLength(1);
  });
});
