import type { AppearancePrefs } from "./appearance";

/** Upload ceiling before normalization — anything bigger is rejected unread. */
export const MAX_LOGO_UPLOAD_BYTES = 2 * 1024 * 1024;
/** Post-sharp ceiling. Matches the org_branding.logo_byte_size CHECK in 0467. */
export const MAX_LOGO_STORED_BYTES = 256 * 1024;
/** Matches the logo_width / logo_height CHECKs in 0467. */
export const MAX_LOGO_EDGE = 512;

export type OrgBrandingView = {
  orgId: string;
  orgName: string | null;
  teamNumber: number | null;
  /** null = the team never picked one; the Vantage default accent applies. */
  accentColor: string | null;
  showLogoInHeader: boolean;
  applyAccentToApp: boolean;
  logo: {
    present: boolean;
    width: number | null;
    height: number | null;
    byteSize: number | null;
    /** Cache-buster for the bytes endpoint; changes whenever the logo changes. */
    version: string | null;
  };
  canEdit: boolean;
  updatedAt: string | null;
};

export type BrandingPayload = {
  org: OrgBrandingView | null;
  appearance: AppearancePrefs;
};

export function emptyBrandingView(orgId: string): OrgBrandingView {
  return {
    orgId,
    orgName: null,
    teamNumber: null,
    accentColor: null,
    showLogoInHeader: true,
    applyAccentToApp: true,
    logo: { present: false, width: null, height: null, byteSize: null, version: null },
    canEdit: false,
    updatedAt: null,
  };
}

export function brandingLogoUrl(view: Pick<OrgBrandingView, "orgId" | "logo">): string | null {
  if (!view.logo.present) return null;
  const version = view.logo.version ? `&v=${encodeURIComponent(view.logo.version)}` : "";
  return `/api/branding/logo?orgId=${encodeURIComponent(view.orgId)}${version}`;
}

/**
 * True when the member should actually see the team accent: the team must have
 * chosen one, left it switched on, and the member must not have opted out.
 */
export function accentIsActive(
  org: Pick<OrgBrandingView, "accentColor" | "applyAccentToApp"> | null,
  appearance: Pick<AppearancePrefs, "teamAccent">,
): boolean {
  return Boolean(org?.accentColor) && Boolean(org?.applyAccentToApp) && appearance.teamAccent;
}

export function formatLogoSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}
