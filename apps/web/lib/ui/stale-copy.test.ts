import { describe, expect, it } from "vitest";
import { isStaleCopyNotice, staleCopyNotice, staleCopyProps } from "./stale-copy";

describe("stale copy notice", () => {
  it("is calm wording online and nothing offline (the offline banner says it)", () => {
    expect(staleCopyNotice("Weight budget", true)).toBe("Couldn't refresh Weight budget just now. Showing the last copy on this device.");
    expect(staleCopyNotice(undefined, true)).toBe("Couldn't refresh just now. Showing the last copy on this device.");
    expect(staleCopyNotice("Weight budget", false)).toBe("");
  });

  it("renders as a status with a neutral look, while a real failure stays an alert", () => {
    expect(staleCopyProps(staleCopyNotice("Pit", true))).toEqual({ className: "telemetry-status is-stale", role: "status" });
    expect(staleCopyProps("Only owners can do that.")).toEqual({ className: "telemetry-status", role: "alert" });
    expect(isStaleCopyNotice("")).toBe(false);
  });
});
