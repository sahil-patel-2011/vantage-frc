// Pure vendor directory rollups. Deterministic given its input.

import type { Vendor, VendorCategory, VendorsSummary } from "./types";

const CATEGORY_ORDER: VendorCategory[] = [
  "electronics",
  "hardware",
  "raw_materials",
  "tools",
  "services",
  "apparel",
  "shipping",
  "other",
];

const round1 = (value: number) => Math.round(value * 10) / 10;

export function vendorCategoryLabel(category: VendorCategory): string {
  const labels: Record<VendorCategory, string> = {
    electronics: "Electronics",
    hardware: "Hardware & COTS",
    raw_materials: "Raw materials",
    tools: "Tools & shop",
    services: "Services",
    apparel: "Apparel",
    shipping: "Shipping",
    other: "Other",
  };
  return labels[category];
}

export function summarizeVendors(vendors: Vendor[]): VendorsSummary {
  const rated = vendors.filter((v) => v.rating != null && Number.isFinite(v.rating));
  const avgRating = rated.length > 0 ? round1(rated.reduce((sum, v) => sum + (v.rating ?? 0), 0) / rated.length) : 0;

  const missingContact = vendors.filter((v) => !v.contactEmail && !v.contactPhone).length;

  const catMap = new Map<VendorCategory, { count: number; leadSum: number; leadCount: number }>();
  for (const vendor of vendors) {
    const entry = catMap.get(vendor.category) ?? { count: 0, leadSum: 0, leadCount: 0 };
    entry.count += 1;
    if (vendor.leadTimeDays != null && Number.isFinite(vendor.leadTimeDays)) {
      entry.leadSum += vendor.leadTimeDays;
      entry.leadCount += 1;
    }
    catMap.set(vendor.category, entry);
  }
  const byCategory = [...catMap.entries()]
    .map(([category, value]) => ({
      category,
      count: value.count,
      avgLeadTimeDays: value.leadCount > 0 ? round1(value.leadSum / value.leadCount) : null,
    }))
    .sort((a, b) => b.count - a.count || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));

  return {
    total: vendors.length,
    preferred: vendors.filter((v) => v.preferred).length,
    avgRating,
    missingContact,
    byCategory,
  };
}

/** Sort for display: preferred first, then rating desc, then name. */
export function sortVendors(vendors: Vendor[]): Vendor[] {
  return [...vendors].sort(
    (a, b) =>
      Number(b.preferred) - Number(a.preferred) ||
      (b.rating ?? 0) - (a.rating ?? 0) ||
      a.name.localeCompare(b.name),
  );
}
