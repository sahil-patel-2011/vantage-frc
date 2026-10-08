import { describe, expect, it } from "vitest";
import { mirrorSyncMessage } from "./sync-message";

describe("spreadsheet write acknowledgement", () => {
  it.each([{}, { copies: [] }, { copies: [{ copy: "unknown", status: "succeeded" }] }, { copies: [{ copy: "google" }] }])("does not claim a write from an incomplete 200 response", data => {
    expect(mirrorSyncMessage(true, data).ok).toBe(false);
  });
  it("reports partial failure without hiding the successful provider", () => {
    expect(mirrorSyncMessage(true, { copies: [{ copy: "google", status: "succeeded" }, { copy: "excel", status: "failed", error: "Reconnect Excel" }] })).toEqual({ ok: false, text: "Google Sheets updated. Microsoft Excel: Reconnect Excel." });
  });
  it("confirms an acknowledged write", () => {
    expect(mirrorSyncMessage(true, { copies: [{ copy: "google", status: "succeeded" }] })).toEqual({ ok: true, text: "Google Sheets updated." });
  });
});
