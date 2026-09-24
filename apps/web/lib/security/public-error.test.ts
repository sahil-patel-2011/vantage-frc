import { afterEach, describe, expect, it, vi } from "vitest";
import { isDatabaseError, publicErrorMessage } from "./public-error";

function pgError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

describe("publicErrorMessage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the sentences a route throws on purpose", () => {
    expect(publicErrorMessage(new Error("A valid team is required"), "Request failed")).toBe("A valid team is required");
  });

  it("never shows a database error to the browser, and logs it on the server", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const leaked = pgError("42703", "column s.series_id does not exist");
    expect(isDatabaseError(leaked)).toBe(true);
    expect(publicErrorMessage(leaked, "Calendar request failed")).toBe("Calendar request failed");
    expect(log).toHaveBeenCalled();
    expect(publicErrorMessage(pgError("23505", 'duplicate key value violates unique constraint "x" (email)=(a@b.c)'), "Save failed")).toBe(
      "Save failed",
    );
  });

  it("falls back for anything that is not an Error", () => {
    expect(publicErrorMessage("boom", "Request failed")).toBe("Request failed");
    expect(publicErrorMessage(null, "Request failed")).toBe("Request failed");
    expect(isDatabaseError({ code: "not-sqlstate" })).toBe(false);
  });
});

describe("publicErrorMessage hides engineering text", () => {
  it("keeps a plain sentence a person can act on", () => {
    expect(publicErrorMessage(new Error("Only a team owner can do that."), "fallback")).toBe("Only a team owner can do that.");
  });

  it("swaps env names, migration ids, crashes and network internals for the fallback", () => {
    for (const message of [
      "Set STRIPE_SECRET_KEY on the server first.",
      "Apply the duty roster migration first (0145_duty_roster).",
      "Cannot read properties of undefined (reading 'id')",
      "fetch failed",
      "Sync failed (HTTP 500)",
      "x".repeat(300),
    ]) {
      expect(publicErrorMessage(new Error(message), "Couldn't save. Try again.")).toBe("Couldn't save. Try again.");
    }
  });
});
