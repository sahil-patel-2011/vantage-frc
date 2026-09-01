import { describe, expect, it, vi } from "vitest";
import { listDirectoryVendors, parseVendorId, resolveDirectoryVendor } from "./directory";

const VENDOR_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

describe("parseVendorId", () => {
  it("accepts a directory UUID", () => {
    expect(parseVendorId(VENDOR_ID)).toBe(VENDOR_ID);
    expect(parseVendorId(` ${VENDOR_ID} `)).toBe(VENDOR_ID);
  });

  it("rejects free-text vendor names and empty values", () => {
    expect(parseVendorId("McMaster")).toBeNull();
    expect(parseVendorId("amazon")).toBeNull();
    expect(parseVendorId("")).toBeNull();
    expect(parseVendorId(null)).toBeNull();
    expect(parseVendorId(undefined)).toBeNull();
    expect(parseVendorId(12)).toBeNull();
  });
});

describe("resolveDirectoryVendor", () => {
  it("looks up the vendor id on the org with parameterized SQL", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ id: VENDOR_ID, name: "McMaster-Carr", preferred: true }],
    });
    const vendor = await resolveDirectoryVendor({ query } as never, ORG_ID, VENDOR_ID);
    expect(vendor).toEqual({ id: VENDOR_ID, name: "McMaster-Carr", preferred: true });
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/FROM vendors[\s\S]*id = \$1::uuid AND org_id = \$2::uuid/),
      [VENDOR_ID, ORG_ID],
    );
  });

  it("returns null when the id is not in this org's directory", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(resolveDirectoryVendor({ query } as never, ORG_ID, VENDOR_ID)).resolves.toBeNull();
  });
});

describe("listDirectoryVendors", () => {
  it("lists org vendors with parameterized SQL", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await listDirectoryVendors({ query } as never, ORG_ID);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/FROM vendors[\s\S]*org_id = \$1::uuid/),
      [ORG_ID],
    );
  });
});
