// Pure, unit-testable Media Kit helpers. No I/O, no framework imports.

export * from "./types";
import type {
  MediaKitAsset,
  MediaKitAssetKind,
  MediaKitDocumentSection,
  MediaKitProfile,
  MediaKitReadiness,
} from "./types";

export function mediaKitAssetKindLabel(kind: MediaKitAssetKind): string {
  switch (kind) {
    case "logo":
      return "Logo";
    case "photo":
      return "Photo";
    case "graphic":
      return "Graphic";
    default:
      return "Other";
  }
}

/**
 * Completeness readiness for the media kit — every signal comes from the recorded
 * profile row and asset library, never invented.
 */
export function computeMediaKitReadiness(
  profile: MediaKitProfile | null,
  assets: MediaKitAsset[],
): MediaKitReadiness {
  const hasLogo = assets.some((asset) => asset.kind === "logo");
  const checks: Array<{ label: string; ok: boolean }> = [
    { label: "Mission statement", ok: Boolean(profile?.missionStatement?.trim()) },
    { label: "Team bio", ok: Boolean(profile?.teamBio?.trim()) },
    { label: "At least one achievement", ok: Boolean(profile && profile.achievements.length > 0) },
    { label: "Contact email", ok: Boolean(profile?.contactEmail?.trim()) },
    { label: "Logo asset", ok: hasLogo },
  ];
  const met = checks.filter((c) => c.ok).length;
  const score = checks.length > 0 ? met / checks.length : 0;
  const missingFields = checks.filter((c) => !c.ok).map((c) => c.label);
  const tier: MediaKitReadiness["tier"] = score === 0 ? "not_started" : score >= 0.99 ? "ready" : "partial";
  return { score, tier, missingFields };
}

export type OnePagerInput = {
  teamNumber: number | null;
  orgName: string;
  seasonYear: number;
  profile: MediaKitProfile | null;
  assetCount: number;
  logoCount: number;
};

/**
 * Deterministic one-pager section builder — assembles only recorded profile fields and
 * org identity into a media-kit document. No fabricated claims.
 */
export function buildOnePagerSections(input: OnePagerInput): MediaKitDocumentSection[] {
  const teamLabel = input.teamNumber != null ? `Team ${input.teamNumber} — ${input.orgName}` : input.orgName;
  const sections: MediaKitDocumentSection[] = [
    {
      heading: teamLabel,
      body: `${input.seasonYear} season media kit.`,
    },
  ];

  if (input.profile?.missionStatement?.trim()) {
    sections.push({ heading: "Mission", body: input.profile.missionStatement.trim() });
  }

  if (input.profile?.teamBio?.trim()) {
    sections.push({ heading: "About the team", body: input.profile.teamBio.trim() });
  }

  if (input.profile?.foundedYear != null) {
    sections.push({
      heading: "History",
      body: `Founded in ${input.profile.foundedYear}.`,
    });
  }

  if (input.profile && input.profile.achievements.length > 0) {
    sections.push({
      heading: "Achievements",
      body: input.profile.achievements.join("; "),
    });
  }

  if (input.logoCount > 0 || input.assetCount > 0) {
    sections.push({
      heading: "Assets",
      body: `${input.logoCount} logo asset(s), ${input.assetCount} total media asset(s) available.`,
    });
  }

  const contactLines: string[] = [];
  if (input.profile?.contactEmail?.trim()) contactLines.push(input.profile.contactEmail.trim());
  if (input.profile?.websiteUrl?.trim()) contactLines.push(input.profile.websiteUrl.trim());
  if (contactLines.length > 0) {
    sections.push({ heading: "Contact", body: contactLines.join(" · ") });
  }

  return sections;
}
