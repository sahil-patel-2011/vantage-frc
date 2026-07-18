// Sponsorship value proposition engine — pure domain logic for org-isolated
// one-pagers. No server/React imports. Never invent cross-team metrics.

export const ONEPAGER_STATUSES = ["draft", "ready"] as const;
export type OnePagerStatus = (typeof ONEPAGER_STATUSES)[number];

export const STATUS_LABEL: Record<OnePagerStatus, string> = {
  draft: "Draft",
  ready: "Ready to share",
};

export type SponsorshipOnePager = {
  id: string;
  title: string;
  seasonYear: number;
  whoWeAre: string;
  whatWeDo: string;
  askCashUsd: number | null;
  askParts: string;
  askMentorship: string;
  sponsorGets: string;
  inviteEnabled: boolean;
  inviteDetails: string;
  status: OnePagerStatus;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SponsorshipContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  /** Seed hints from THIS org's team background / onboarding / writer_profile only. */
  seedWhoWeAre: string | null;
  seedFundingNeed: string | null;
};

/** Re-export for value-prop loaders — never invent or import another team's copy. */
export { buildWhoWeAreSeed } from "./team-background";

export type SponsorshipView =
  | {
      status: "ready";
      context: SponsorshipContext;
      seasonYear: number;
      seasons: number[];
      onePagers: SponsorshipOnePager[];
    }
  | {
      status: "setup_required";
      context: SponsorshipContext;
      seasonYear: number;
      message: string;
    };

export type Completeness = {
  whoWeAre: boolean;
  whatWeDo: boolean;
  hasAsk: boolean;
  sponsorGets: boolean;
  inviteOk: boolean;
  complete: boolean;
  missing: string[];
};

export function currentSeasonYear(now = new Date()): number {
  return now.getUTCFullYear();
}

export function moneyLabel(amountUsd: number | null): string | null {
  if (amountUsd == null || !Number.isFinite(amountUsd)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amountUsd % 1 === 0 ? 0 : 2,
  }).format(amountUsd);
}

/** At least one of cash / parts / mentorship must be present to request support. */
export function hasSponsorshipAsk(input: {
  askCashUsd: number | null;
  askParts: string;
  askMentorship: string;
}): boolean {
  const cash = input.askCashUsd != null && input.askCashUsd > 0;
  const parts = input.askParts.trim().length > 0;
  const mentorship = input.askMentorship.trim().length > 0;
  return cash || parts || mentorship;
}

export function evaluateCompleteness(page: {
  whoWeAre: string;
  whatWeDo: string;
  askCashUsd: number | null;
  askParts: string;
  askMentorship: string;
  sponsorGets: string;
  inviteEnabled: boolean;
  inviteDetails: string;
}): Completeness {
  const whoWeAre = page.whoWeAre.trim().length >= 20;
  const whatWeDo = page.whatWeDo.trim().length >= 20;
  const hasAsk = hasSponsorshipAsk(page);
  const sponsorGets = page.sponsorGets.trim().length >= 20;
  const inviteOk = !page.inviteEnabled || page.inviteDetails.trim().length >= 10;
  const missing: string[] = [];
  if (!whoWeAre) missing.push("Who we are");
  if (!whatWeDo) missing.push("What we do");
  if (!hasAsk) missing.push("What we request");
  if (!sponsorGets) missing.push("What the sponsor gets");
  if (!inviteOk) missing.push("Come-see-us invite details");
  return {
    whoWeAre,
    whatWeDo,
    hasAsk,
    sponsorGets,
    inviteOk,
    complete: missing.length === 0,
    missing,
  };
}

/** Build the printable section lines for PDF / copy-export (this team only). */
export function buildOnePagerLines(
  page: SponsorshipOnePager,
  team: { orgName: string | null; teamNumber: number | null },
): string[] {
  const teamLabel =
    team.teamNumber != null
      ? `FRC Team ${team.teamNumber}${team.orgName ? ` — ${team.orgName}` : ""}`
      : (team.orgName ?? "Our team");

  const lines: string[] = [
    teamLabel,
    `Season ${page.seasonYear}`,
    "",
    "WHO WE ARE",
    page.whoWeAre.trim() || "(Add your team background — this team only.)",
    "",
    "WHAT WE DO",
    page.whatWeDo.trim() || "(Describe your program, build season, and community work.)",
    "",
    "WHAT WE REQUEST",
  ];

  const cash = moneyLabel(page.askCashUsd);
  if (cash) lines.push(`Cash support: ${cash}`);
  if (page.askParts.trim()) lines.push(`Parts / materials: ${page.askParts.trim()}`);
  if (page.askMentorship.trim()) lines.push(`Mentorship: ${page.askMentorship.trim()}`);
  if (!hasSponsorshipAsk(page)) lines.push("(Add a cash, parts, or mentorship ask.)");

  lines.push("", "WHAT YOU GET AS A SPONSOR", page.sponsorGets.trim() || "(List recognition, visits, and impact.)");

  if (page.inviteEnabled) {
    lines.push("", "COME SEE US", page.inviteDetails.trim() || "(Add shop open-house or event invite details.)");
  }

  return lines;
}

export function defaultTitle(teamNumber: number | null, seasonYear: number): string {
  if (teamNumber != null) return `Team ${teamNumber} · ${seasonYear} sponsorship`;
  return `${seasonYear} sponsorship one-pager`;
}

export type CreateOnePagerInput = {
  title: string;
  seasonYear: number;
  whoWeAre: string;
  whatWeDo: string;
  askCashUsd: number | null;
  askParts: string;
  askMentorship: string;
  sponsorGets: string;
  inviteEnabled: boolean;
  inviteDetails: string;
};

export type UpdateOnePagerInput = Partial<Omit<CreateOnePagerInput, "seasonYear">> & {
  id: string;
  status?: OnePagerStatus;
};

function requiredText(value: unknown, label: string, max: number, min = 1): string {
  const text = String(value ?? "").trim();
  if (text.length < min) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value: unknown, label: string, max: number): string {
  if (value == null) return "";
  const text = String(value).trim();
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function moneyOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error("Cash ask must be a non-negative number");
  return Math.round(n * 100) / 100;
}

function seasonYearFrom(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 2000 || n > 3000) return fallback;
  return Math.round(n);
}

export function parseCreateOnePager(body: Record<string, unknown>, fallbackSeason: number): CreateOnePagerInput {
  const inviteEnabled = Boolean(body.inviteEnabled);
  return {
    title: requiredText(body.title, "Title", 160),
    seasonYear: seasonYearFrom(body.seasonYear, fallbackSeason),
    whoWeAre: optionalText(body.whoWeAre, "Who we are", 4000),
    whatWeDo: optionalText(body.whatWeDo, "What we do", 4000),
    askCashUsd: moneyOrNull(body.askCashUsd),
    askParts: optionalText(body.askParts, "Parts ask", 2000),
    askMentorship: optionalText(body.askMentorship, "Mentorship ask", 2000),
    sponsorGets: optionalText(body.sponsorGets, "What the sponsor gets", 4000),
    inviteEnabled,
    inviteDetails: inviteEnabled ? optionalText(body.inviteDetails, "Invite details", 2000) : "",
  };
}

export function parseUpdateOnePager(body: Record<string, unknown>): UpdateOnePagerInput {
  const id = requiredText(body.id, "One-pager id", 64);
  const patch: UpdateOnePagerInput = { id };
  if ("title" in body) patch.title = requiredText(body.title, "Title", 160);
  if ("whoWeAre" in body) patch.whoWeAre = optionalText(body.whoWeAre, "Who we are", 4000);
  if ("whatWeDo" in body) patch.whatWeDo = optionalText(body.whatWeDo, "What we do", 4000);
  if ("askCashUsd" in body) patch.askCashUsd = moneyOrNull(body.askCashUsd);
  if ("askParts" in body) patch.askParts = optionalText(body.askParts, "Parts ask", 2000);
  if ("askMentorship" in body) patch.askMentorship = optionalText(body.askMentorship, "Mentorship ask", 2000);
  if ("sponsorGets" in body) patch.sponsorGets = optionalText(body.sponsorGets, "What the sponsor gets", 4000);
  if ("inviteEnabled" in body) patch.inviteEnabled = Boolean(body.inviteEnabled);
  if ("inviteDetails" in body) patch.inviteDetails = optionalText(body.inviteDetails, "Invite details", 2000);
  if ("status" in body) {
    const status = String(body.status ?? "");
    if (!ONEPAGER_STATUSES.includes(status as OnePagerStatus)) throw new Error("Invalid status");
    patch.status = status as OnePagerStatus;
  }
  return patch;
}
