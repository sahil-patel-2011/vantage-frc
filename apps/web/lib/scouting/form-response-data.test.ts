import { afterEach, describe, expect, it, vi } from "vitest";
import { FormResponsesError, isFormResponseData, loadFormResponses } from "./form-response-data";

const data = { definition: { title: "Pit", fields: [{ key: "cycles", label: "Cycles", type: "counter" }] },
  rows: [{ id: "1", team: "frc6925", label: "Pit", event: null, payload: { cycles: 0 }, observedAt: "2026-10-06T12:00:00Z", mine: true }],
  hasMore: false, scouts: null, idle: null };
afterEach(() => vi.unstubAllGlobals());
describe("form response loading", () => {
  it("accepts observed zero and empty results, rejects incomplete data", () => {
    expect(isFormResponseData(data)).toBe(true);
    expect(isFormResponseData({ ...data, rows: [] })).toBe(true);
    expect(isFormResponseData({ ...data, definition: {} })).toBe(false);
    expect(isFormResponseData({ ...data, rows: [{ ...data.rows[0], observedAt: "bad" }] })).toBe(false);
    expect(isFormResponseData({ ...data, scouts: [{ id: "a", name: "Ada", total: -1, teams: 1, lastAt: data.rows[0].observedAt }] })).toBe(false);
  });
  it("loads only the requested team and form, preserving missing answers", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(data)); vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(await loadFormResponses("team&other", "form/1", signal)).toEqual(data);
    expect(fetch).toHaveBeenCalledWith("/api/scouting/form-responses?orgId=team%26other&schemaId=form%2F1", { cache: "no-store", signal });
  });
  it.each([401, 403, 404])("discards previous responses when access becomes unavailable (%i)", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unauthorized", { status })));
    const error = await loadFormResponses("team", "form", new AbortController().signal).catch(error => error);
    expect(error).toBeInstanceOf(FormResponsesError);
    expect(error.discardPrevious).toBe(true);
  });
  it("keeps a last good snapshot available after a transient failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Try again" }, { status: 503 })));
    const error = await loadFormResponses("team", "form", new AbortController().signal).catch(error => error);
    expect(error.message).toBe("Try again"); expect(error.discardPrevious).toBe(false);
  });
  it("does not treat a successful malformed payload as an empty response list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ rows: [] })));
    await expect(loadFormResponses("team", "form", new AbortController().signal)).rejects.toThrow("incomplete");
  });
});
