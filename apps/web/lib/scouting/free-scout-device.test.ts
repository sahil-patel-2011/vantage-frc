import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FreeScoutReport } from "./free-scout";
import { pendingFreeReports, queueFreeReport, syncFreeReports } from "./free-scout-device";

const report = (id = "11111111-1111-4111-8111-111111111111", notes = "Observed robot") => ({
  id, year: 2026, type: "pit", teamNumber: 6925, label: "Pit scouting",
  payload: { notes }, observedAt: "2026-10-07T12:00:00.000Z",
} satisfies FreeScoutReport);
const reply = (id: string, status = 200) => Response.json({ id }, { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("navigator", {});
});
afterEach(() => vi.unstubAllGlobals());

describe("practice report persistence and acknowledgements", () => {
  it("makes no HTTP request for an empty personal queue", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await syncFreeReports("team", "scout", fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends only this team's and account's reports and removes a confirmed revision", async () => {
    const row = report();
    await queueFreeReport("team", "scout", row);
    await queueFreeReport("other-team", "scout", report("22222222-2222-4222-8222-222222222222"));
    await queueFreeReport("team", "other-scout", report("33333333-3333-4333-8333-333333333333"));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(row.id));
    await syncFreeReports("team", "scout", fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/scouting/free-reports");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ orgId: "team", userId: "scout", report: row });
    expect(await pendingFreeReports("team", "scout")).toEqual([]);
    expect(await pendingFreeReports("other-team", "scout")).toHaveLength(1);
    expect(await pendingFreeReports("team", "other-scout")).toHaveLength(1);
  });

  it("joins concurrent drains instead of posting twice", async () => {
    const row = report();
    await queueFreeReport("team", "scout", row);
    const posted = deferred<void>();
    const response = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => { posted.resolve(); return response.promise; });
    const first = syncFreeReports("team", "scout", fetcher);
    await posted.promise;
    const second = syncFreeReports("team", "scout", fetcher);
    expect(second).toBe(first);
    response.resolve(reply(row.id));
    await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([200, 422])("preserves a newer revision when an older request finishes with %i", async status => {
    const row = report();
    await queueFreeReport("team", "scout", row);
    const posted = deferred<void>();
    const response = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => { posted.resolve(); return response.promise; });
    const upload = syncFreeReports("team", "scout", fetcher);
    await posted.promise;
    await queueFreeReport("team", "scout", report(row.id, "Corrected while uploading"));
    response.resolve(status === 200 ? reply(row.id) : Response.json({ error: "Old answers refused" }, { status }));
    await upload;
    const remaining = await pendingFreeReports("team", "scout");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.report.payload.notes).toBe("Corrected while uploading");
    expect(remaining[0]?.error).toBeUndefined();
  });

  it("keeps a report when success carries an unrelated acknowledgement", async () => {
    await queueFreeReport("team", "scout", report());
    await syncFreeReports("team", "scout", vi.fn<typeof fetch>().mockResolvedValue(reply("wrong-id")));
    const remaining = await pendingFreeReports("team", "scout");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.retryable).toBe(false);
  });

  it.each([401, 403])("stops a changed/expired session (%i) without deleting or posting the remaining reports", async status => {
    await queueFreeReport("team", "scout", report());
    await queueFreeReport("team", "scout", report("22222222-2222-4222-8222-222222222222"));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "Sign in again" }, { status }));
    await expect(syncFreeReports("team", "scout", fetcher)).rejects.toThrow("Sign in again");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await pendingFreeReports("team", "scout")).toHaveLength(2);
    await syncFreeReports("team", "scout", fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not repeatedly upload rejected answers, but allows explicit retry", async () => {
    const row = report();
    await queueFreeReport("team", "scout", row);
    const refused = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "Form unavailable" }, { status: 422 }));
    await syncFreeReports("team", "scout", refused);
    await syncFreeReports("team", "scout", refused);
    expect(refused).toHaveBeenCalledOnce();
    const accepted = vi.fn<typeof fetch>().mockResolvedValue(reply(row.id));
    await syncFreeReports("team", "scout", accepted, { retryRejected: true });
    expect(accepted).toHaveBeenCalledOnce();
    expect(await pendingFreeReports("team", "scout")).toEqual([]);
  });

  it("retains an interrupted report as retryable and releases the drain", async () => {
    const row = report();
    await queueFreeReport("team", "scout", row);
    await expect(syncFreeReports("team", "scout", vi.fn<typeof fetch>().mockRejectedValue(new Error("Network lost")))).rejects.toThrow("still on this device");
    expect((await pendingFreeReports("team", "scout"))[0]?.retryable).toBe(true);
    await syncFreeReports("team", "scout", vi.fn<typeof fetch>().mockResolvedValue(reply(row.id)));
    expect(await pendingFreeReports("team", "scout")).toEqual([]);
  });
});
