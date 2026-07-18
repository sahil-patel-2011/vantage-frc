// Vendor / Supplier Directory domain types. Pure data shapes — no I/O.
// A team's known suppliers (COTS, raw stock, tools, services) with contact info, lead time,
// rating, and a "preferred" flag. Org-scoped and persistent across seasons.

export type VendorCategory =
  | "electronics"
  | "hardware"
  | "raw_materials"
  | "tools"
  | "services"
  | "apparel"
  | "shipping"
  | "other";

export type Vendor = {
  id: string;
  name: string;
  category: VendorCategory;
  website: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** Typical order-to-delivery time in days, or null if unknown. */
  leadTimeDays: number | null;
  /** 1..5, or null if unrated. */
  rating: number | null;
  preferred: boolean;
  accountNumber: string | null;
  notes: string | null;
};

export type VendorsSummary = {
  total: number;
  preferred: number;
  /** Average rating over rated vendors (0 when none). */
  avgRating: number;
  /** Vendors with no email and no phone — directory gaps to fill. */
  missingContact: number;
  byCategory: Array<{
    category: VendorCategory;
    count: number;
    /** Average lead time over vendors in this category that have one, or null. */
    avgLeadTimeDays: number | null;
  }>;
};
