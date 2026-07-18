import { describe, expect, it } from "vitest";
import { sortVendors, summarizeVendors, vendorCategoryLabel } from "./summary";
import type { Vendor, VendorCategory } from "./types";

let seq = 0;
function vendor(overrides: Partial<Vendor> = {}): Vendor {
  seq += 1;
  return {
    id: `v-${seq}`,
    name: `Vendor ${seq}`,
    category: "hardware" as VendorCategory,
    website: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    leadTimeDays: null,
    rating: null,
    preferred: false,
    accountNumber: null,
    notes: null,
    ...overrides,
  };
}

describe("summarizeVendors", () => {
  it("is all-zero for none", () => {
    const s = summarizeVendors([]);
    expect(s.total).toBe(0);
    expect(s.preferred).toBe(0);
    expect(s.avgRating).toBe(0);
    expect(s.byCategory).toEqual([]);
  });

  it("counts preferred and averages rating over rated vendors only", () => {
    const s = summarizeVendors([
      vendor({ rating: 5, preferred: true }),
      vendor({ rating: 3 }),
      vendor({ rating: null }), // unrated — excluded from average
    ]);
    expect(s.total).toBe(3);
    expect(s.preferred).toBe(1);
    expect(s.avgRating).toBe(4); // (5 + 3) / 2
  });

  it("counts vendors missing all contact info", () => {
    const s = summarizeVendors([
      vendor({ contactEmail: "a@b.com" }),
      vendor({ contactPhone: "555" }),
      vendor({}), // no email, no phone
    ]);
    expect(s.missingContact).toBe(1);
  });

  it("rolls up by category with average lead time over vendors that have one", () => {
    const s = summarizeVendors([
      vendor({ category: "electronics", leadTimeDays: 10 }),
      vendor({ category: "electronics", leadTimeDays: 20 }),
      vendor({ category: "electronics", leadTimeDays: null }), // excluded from lead avg
      vendor({ category: "tools" }),
    ]);
    const electronics = s.byCategory.find((c) => c.category === "electronics");
    expect(electronics?.count).toBe(3);
    expect(electronics?.avgLeadTimeDays).toBe(15);
    const tools = s.byCategory.find((c) => c.category === "tools");
    expect(tools?.avgLeadTimeDays).toBeNull();
    expect(s.byCategory[0]?.category).toBe("electronics"); // most vendors first
  });
});

describe("sortVendors", () => {
  it("puts preferred first, then higher rating, then name", () => {
    const sorted = sortVendors([
      vendor({ name: "Beta", preferred: false, rating: 5 }),
      vendor({ name: "Alpha", preferred: true, rating: 2 }),
      vendor({ name: "Gamma", preferred: false, rating: 5 }),
    ]);
    expect(sorted.map((v) => v.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});

describe("vendorCategoryLabel", () => {
  it("labels categories", () => {
    expect(vendorCategoryLabel("raw_materials")).toBe("Raw materials");
  });
});
