import { describe, expect, it } from "vitest";
import { isStaleCopyNotice, staleCopyNotice, staleCopyProps } from "./stale-copy";

describe("stale copy notice", () => {
  it("is calm wording, the same whether the failure happened online or offline", () => {
    expect(staleCopyNotice("Weight budget")).toBe("Couldn't refresh Weight budget just now. Showing the last copy on this device.");
    expect(staleCopyNotice()).toBe("Couldn't refresh just now. Showing the last copy on this device.");
  });

  it("renders as a status with a neutral look, while a real failure stays an alert", () => {
    expect(staleCopyProps(staleCopyNotice("Pit"))).toEqual({ className: "telemetry-status is-stale", role: "status" });
    expect(staleCopyProps("Only owners can do that.")).toEqual({ className: "telemetry-status", role: "alert" });
    expect(isStaleCopyNotice("")).toBe(false);
  });
});
