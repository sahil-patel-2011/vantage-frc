import { describe, expect, it } from "vitest";
import { receiptAfterSync, receiptLine } from "./sync-receipt";

const VIEW_ONLY = "View only — you can look but not change this. Ask a team owner or admin for Team member access.";

describe("receiptAfterSync", () => {
  it("says Sent only when the entry left the phone's outbox", () => {
    expect(receiptAfterSync({ state: { state: "gone" }, failure: null, online: true })).toEqual({ sync: "sent" });
    // A sync that "finished" with the entry still queued is not Sent, whatever the reason.
    for (const failure of ["server", "unreachable", "signed-out", null] as const) {
      expect(receiptAfterSync({ state: { state: "queued" }, failure, online: true }).sync).not.toBe("sent");
    }
  });

  it("names each reason an entry is still on the phone", () => {
    expect(receiptAfterSync({ state: { state: "queued" }, failure: "signed-out", online: true }).sync).toBe("signed-out");
    expect(receiptAfterSync({ state: { state: "queued" }, failure: "server", online: true }).sync).toBe("unreachable");
    expect(receiptAfterSync({ state: { state: "queued" }, failure: "unreachable", online: true }).sync).toBe("unreachable");
    expect(receiptAfterSync({ state: { state: "queued" }, failure: null, online: false }).sync).toBe("waiting");
    expect(receiptAfterSync({ state: { state: "queued" }, failure: null, online: true }).sync).toBe("queued");
  });

  it("passes the server's own sentence through when it refused the entry", () => {
    expect(receiptAfterSync({ state: { state: "set-aside", reason: VIEW_ONLY }, failure: null, online: true })).toEqual({
      sync: "refused",
      reason: VIEW_ONLY,
    });
  });
});

describe("receiptLine", () => {
  it("never claims the team has the report unless it was sent", () => {
    expect(receiptLine({ sync: "sent" })).toEqual({ text: "Sent to your team.", tone: "done" });
    for (const sync of ["sending", "waiting", "queued", "unreachable", "signed-out", "refused"] as const) {
      const line = receiptLine({ sync });
      expect(line.text).not.toMatch(/^Sent/);
      expect(line.tone).not.toBe("done");
    }
  });

  it("tells a signed-out scout what to do and a refused scout why", () => {
    expect(receiptLine({ sync: "signed-out" }).text).toMatch(/Sign in again/);
    expect(receiptLine({ sync: "refused", reason: VIEW_ONLY }).text).toBe(`Saved on this phone, but your team didn’t accept it. ${VIEW_ONLY}`);
    expect(receiptLine({ sync: "refused", reason: "Team 254 is not in Qual 33" }).text).toMatch(/Qual 33\.$/);
  });
});
