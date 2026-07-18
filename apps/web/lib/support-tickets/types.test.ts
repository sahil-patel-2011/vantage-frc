import { describe, expect, it } from "vitest";
import { isSupportTicketStatus, statusLabel, SUPPORT_TICKET_STATUSES } from "./types";

describe("support ticket types", () => {
  it("accepts known statuses", () => {
    for (const status of SUPPORT_TICKET_STATUSES) {
      expect(isSupportTicketStatus(status)).toBe(true);
      expect(statusLabel(status).length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown statuses", () => {
    expect(isSupportTicketStatus("pending")).toBe(false);
    expect(isSupportTicketStatus("")).toBe(false);
    expect(isSupportTicketStatus(null)).toBe(false);
  });
});
