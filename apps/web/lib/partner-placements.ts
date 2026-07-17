export const PARTNER_SURFACES = ["dashboard_footer", "pit_footer", "business_wall"] as const;
export type PartnerSurface = (typeof PARTNER_SURFACES)[number];

export type PublicPartnerPlacement = {
  id: string;
  sponsorName: string;
  headline: string | null;
  linkUrl: string | null;
  assetPublicId: string | null;
  startOn: string | null;
  endOn: string | null;
};

export type PartnerProgramView = {
  orgId: string;
  seasonYear: number;
  canManage: boolean;
  settings: {
    publicId: string | null;
    storefrontEnabled: boolean;
    paymentUrl: string | null;
    pitch: string | null;
  };
  packages: Array<{
    id: string; name: string; priceCents: number; durationDays: number;
    surfaces: PartnerSurface[]; benefits: string | null; active: boolean;
  }>;
  campaigns: Array<{
    id: string; sponsorId: string; sponsorName: string; packageId: string | null;
    packageName: string | null; assetId: string | null; assetPublicId: string | null;
    name: string; headline: string | null; linkUrl: string | null; surfaces: PartnerSurface[];
    startOn: string | null; endOn: string | null; status: "draft" | "approved" | "active" | "complete" | "cancelled";
    amountCents: number; paymentStatus: "pending" | "paid" | "waived";
  }>;
  submissions: Array<{
    id: string; packageId: string | null; packageName: string | null; companyName: string;
    contactName: string; contactEmail: string; website: string | null; headline: string | null;
    message: string | null; externalLogoUrl: string | null; status: "pending" | "approved" | "rejected";
    createdAt: string;
  }>;
  assets: Array<{
    id: string; publicId: string; sponsorId: string; sponsorName: string; name: string;
    byteSize: number; width: number; height: number; status: "pending" | "approved" | "archived";
    createdAt: string;
  }>;
  sponsors: Array<{ id: string; name: string }>;
};

export function isPartnerSurface(value: unknown): value is PartnerSurface {
  return typeof value === "string" && (PARTNER_SURFACES as readonly string[]).includes(value);
}

export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function selectedSurfaces(value: unknown): PartnerSurface[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return PARTNER_SURFACES.filter((surface) => values.includes(surface));
}

export function sponsorAssetUrl(publicId: string): string {
  return `/api/partner-assets/${encodeURIComponent(publicId)}`;
}
