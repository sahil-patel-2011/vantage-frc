// Grant & Sponsorship Writing Assistant — domain types. Pure data shapes, no I/O.
// A composition engine that drafts tailored grant answers and sponsor emails from the team's
// profile. Deterministic and local (template-based, honestly labeled) — structured so it can
// later be backed by a metered LLM without changing the surface.

export type WriterTone = "warm" | "professional" | "concise";

export type WriterProfile = {
  teamName: string;
  teamNumber: number | null;
  region: string | null;
  /** One or two sentence mission / what the team is about. */
  mission: string | null;
  /** Bullet accomplishments to weave into copy (awards, outreach, growth). */
  achievements: string[];
  /** What the funding pays for (registration, materials, travel…). */
  fundingNeed: string | null;
  /** Default ask amount in USD. */
  fundingAskUsd: number | null;
  tone: WriterTone;
};

export type EmailKind = "cold_intro" | "sponsorship_ask" | "renewal" | "thank_you" | "grant_followup";

export type DraftKind = EmailKind | "grant";

export type SponsorInput = {
  sponsorName: string;
  contactName: string | null;
  tier: string | null;
  askAmountUsd: number | null;
  priorAmountUsd: number | null;
  senderName: string | null;
  senderRole: string | null;
};

export type GrantFocus = "general" | "impact" | "technical" | "sustainability" | "inclusion";

export type GrantInput = {
  prompt: string;
  charLimit: number | null;
  focus: GrantFocus;
};

export type ComposedEmail = {
  subject: string;
  body: string;
};

export type DraftStatus = "draft" | "final" | "sent";

export type WriterDraft = {
  id: string;
  kind: DraftKind;
  title: string;
  targetName: string | null;
  subject: string | null;
  body: string;
  status: DraftStatus;
  /** How the draft was produced — "template" today, "ai" once LLM-backed. */
  source: string;
  seasonYear: number;
  createdAt: string;
};
