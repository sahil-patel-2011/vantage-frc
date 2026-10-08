import { describe, expect, it } from "vitest";
import { assignmentReceiptMessage, isAssignmentReceipt } from "./assignment-receipt";

describe("assignment receipts", () => {
  it("keeps partial success and no-work results explicit", () => {
    const receipt = { action: "assign-range", eventKey: "2026test", assigned: 2, unchanged: 1, refused: ["Q3: already covering another robot"] };
    expect(isAssignmentReceipt(receipt)).toBe(true);
    expect(assignmentReceiptMessage(receipt)).toContain("2 assignments saved. 1 already assigned. 1 could not be assigned.");
    expect(assignmentReceiptMessage({ ...receipt, assigned: 0, unchanged: 0, refused: [] })).toContain("No additional assignments were created.");
    expect(isAssignmentReceipt({ ...receipt, assigned: -1 })).toBe(false);
    expect(isAssignmentReceipt({ ...receipt, refused: null })).toBe(false);
    expect(isAssignmentReceipt({ status: "live" })).toBe(false);
  });
});
