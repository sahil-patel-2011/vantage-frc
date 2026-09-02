// Client-safe half of the self-serve invite helpers: paths, token shape,
// public state classification, and form validation. No node imports, so the
// public respond page can import this directly. Token minting/hashing lives in
// ./invites (server only).

import type { ExitInterviewRole } from "./types";

/** Same charset/length window as the parent-view tokens (0144 / 0471). */
export const EXIT_INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

/** Page + API paths the public respond flow lives at (allow-listed in proxy.ts). */
export const EXIT_INTERVIEW_RESPOND_PATH = "/exit-interview/respond";
export const EXIT_INTERVIEW_RESPOND_API = "/api/exit-interview/respond";

/** Links stay valid this long; a used link is dead immediately. */
export const EXIT_INVITE_TTL_DAYS = 30;

export function isExitInviteToken(value: unknown): value is string {
  return typeof value === "string" && EXIT_INVITE_TOKEN_PATTERN.test(value);
}

export function exitInviteExpiry(now: Date = new Date(), ttlDays: number = EXIT_INVITE_TTL_DAYS): Date {
  return new Date(now.getTime() + ttlDays * 86_400_000);
}

/** Absolute one-time link for the invitee. */
export function exitInviteLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}${EXIT_INTERVIEW_RESPOND_PATH}?token=${encodeURIComponent(token)}`;
}

/** What get_exit_interview_invite (0501) returns for a known token. */
export type ResolvedExitInvite = {
  inviteId: string;
  orgId: string;
  orgName: string;
  teamNumber: number | null;
  memberName: string;
  memberUserId: string | null;
  seasonYear: number;
  createdBy: string;
  expiresAt: string;
  usedAt: string | null;
  expired: boolean;
};

export type ExitInviteState =
  | { status: "invalid" }
  | { status: "used"; orgName: string; memberName: string }
  | { status: "expired"; orgName: string; memberName: string }
  | {
      status: "open";
      orgName: string;
      teamNumber: number | null;
      memberName: string;
      seasonYear: number;
      expiresAt: string;
    };

/** Public-safe state for the respond page: never leaks ids or the creator. */
export function classifyExitInvite(invite: ResolvedExitInvite | null): ExitInviteState {
  if (!invite) return { status: "invalid" };
  if (invite.usedAt) return { status: "used", orgName: invite.orgName, memberName: invite.memberName };
  if (invite.expired) return { status: "expired", orgName: invite.orgName, memberName: invite.memberName };
  return {
    status: "open",
    orgName: invite.orgName,
    teamNumber: invite.teamNumber,
    memberName: invite.memberName,
    seasonYear: invite.seasonYear,
    expiresAt: invite.expiresAt,
  };
}

const ROLES: ExitInterviewRole[] = [
  "mechanical",
  "electrical",
  "programming",
  "strategy",
  "outreach",
  "leadership",
  "mentor",
  "other",
];

export type ExitInviteResponse = {
  role: ExitInterviewRole;
  yearsOnTeam: number;
  graduationYear: number;
  highlights: string | null;
  adviceForFuture: string | null;
  skillsToDocument: string | null;
  willingToMentor: boolean;
  contactEmail: string | null;
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * Validates the self-serve form body. The invitee cannot pick their own name,
 * season, or status — those come from the invite; a self-serve response is
 * always 'submitted'.
 */
export function parseExitInviteResponse(
  body: Record<string, unknown>,
  invite: Pick<ResolvedExitInvite, "seasonYear">,
): { ok: true; value: ExitInviteResponse } | { ok: false; error: string } {
  const role = typeof body.role === "string" && (ROLES as string[]).includes(body.role) ? (body.role as ExitInterviewRole) : "other";
  const years = Number(body.yearsOnTeam);
  const yearsOnTeam = Number.isFinite(years) && years > 0 ? Math.min(20, Math.round(years)) : 0;
  const grad = Number(body.graduationYear);
  const graduationYear = Number.isFinite(grad) && grad > 2000 && grad < 3000 ? Math.round(grad) : invite.seasonYear;
  const contactEmail = text(body.contactEmail, 200);
  if (contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
    return { ok: false, error: "Contact email does not look like an email address." };
  }
  const highlights = text(body.highlights, 4000);
  const adviceForFuture = text(body.adviceForFuture, 4000);
  const skillsToDocument = text(body.skillsToDocument, 4000);
  if (!highlights && !adviceForFuture && !skillsToDocument) {
    return { ok: false, error: "Share at least one of: highlights, advice, or skills worth documenting." };
  }
  return {
    ok: true,
    value: {
      role,
      yearsOnTeam,
      graduationYear,
      highlights,
      adviceForFuture,
      skillsToDocument,
      willingToMentor: body.willingToMentor === true,
      contactEmail,
    },
  };
}
