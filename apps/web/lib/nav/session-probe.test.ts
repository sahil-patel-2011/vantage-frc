import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetSessionProbe, probeSessionUser } from "./session-probe";

afterEach(() => {
  forgetSessionProbe();
  vi.unstubAllGlobals();
});

const answer = (body: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }));

describe("probeSessionUser", () => {
  it("asks the auth route, never /api/me, and reads who is signed in", async () => {
    const fetchSpy = answer({ user: { id: "u1", email: "sam@example.test", name: " Sam Scout ", image: null } });
    vi.stubGlobal("fetch", fetchSpy);
    await expect(probeSessionUser()).resolves.toEqual({ id: "u1", email: "sam@example.test", name: "Sam Scout", image: null });
    expect(fetchSpy.mock.calls.map((call) => (call as unknown[])[0])).toEqual(["/api/auth/get-session"]);
  });

  it("tells signed out (null) from unknown (undefined)", async () => {
    vi.stubGlobal("fetch", answer(null));
    await expect(probeSessionUser()).resolves.toBeNull();
    forgetSessionProbe();
    vi.stubGlobal("fetch", answer({ error: "down" }, false));
    await expect(probeSessionUser()).resolves.toBeUndefined();
  });

  it("shares one request between the banner, header and shell, and keeps no unanswered probe", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchSpy);
    await Promise.all([probeSessionUser(), probeSessionUser(), probeSessionUser()]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await probeSessionUser();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not ask while the browser is offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetchSpy = answer({ user: { id: "u1" } });
    vi.stubGlobal("fetch", fetchSpy);
    await expect(probeSessionUser()).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
