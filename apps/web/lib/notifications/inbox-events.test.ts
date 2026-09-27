import { afterEach, describe, expect, it, vi } from "vitest";
import { listenInboxUpdates, publishInboxUpdate, validInboxUpdate } from "./inbox-events";
describe("notification updates", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("accepts confirmed zero and refuses malformed counts or missing identities", () => {
    expect(validInboxUpdate({ userId: "u", orgId: "a", unreadCount: 0 })).toBe(true);
    for (const value of [null, {}, { userId: "", orgId: null, unreadCount: 2 }, { userId: "u", orgId: null, unreadCount: -1 }, { userId: "u", orgId: null, unreadCount: NaN }]) expect(validInboxUpdate(value)).toBe(false);
  });
  it("updates the current tab without BroadcastChannel and removes listeners on cleanup", () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("BroadcastChannel", undefined);
    const receive = vi.fn();
    const stop = listenInboxUpdates(receive);
    const update = { userId: "u", orgId: "a", unreadCount: 0 };
    publishInboxUpdate(update);
    expect(receive).toHaveBeenCalledWith(expect.objectContaining(update));
    stop(); publishInboxUpdate(update);
    expect(receive).toHaveBeenCalledTimes(1);
  });
});
