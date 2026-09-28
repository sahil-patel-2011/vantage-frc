import { describe, expect, it } from "vitest";
import { parseInboxAction } from "./inbox-store";
const id = "6925a000-0000-4000-8000-000000000001";
describe("notification read request boundaries", () => {
  it("rejects unknown actions, missing IDs and excessive batches", () => {
    expect(() => parseInboxAction({ action: "delete_all" })).toThrow("Unknown");
    expect(() => parseInboxAction({ action: "read" })).toThrow("valid");
    expect(() => parseInboxAction({ action: "read_visible", ids: [] })).toThrow("1 to 100");
    expect(() => parseInboxAction({ action: "read_visible", ids: Array(101).fill(id) })).toThrow("1 to 100");
    expect(() => parseInboxAction({ action: "read_visible", ids: ["not-a-uuid"] })).toThrow("Invalid");
  });
  it("deduplicates valid visible IDs and retains explicit unread actions", () => {
    expect(parseInboxAction({ action: "read_visible", ids: [id, id] })).toEqual({ action: "read_visible", ids: [id] });
    expect(parseInboxAction({ action: "unread", id })).toEqual({ action: "unread", ids: [id] });
    expect(parseInboxAction({ action: "unread", ids: [id, id] })).toEqual({ action: "unread", ids: [id] });
    expect(() => parseInboxAction({ action: "read", id, ids: [id] })).toThrow("not both");
    expect(parseInboxAction({ action: "read_all" })).toEqual({ action: "read_all", ids: [] });
  });
});
