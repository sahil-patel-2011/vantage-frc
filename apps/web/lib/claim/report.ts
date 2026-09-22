/**
 * "Report a team claimed without authorization" — a prefilled email to the
 * address the Terms name as the way to reach a person.
 *
 * Email rather than a support ticket on purpose: the support-ticket flow is
 * scoped to a team you belong to, and the person reporting a hijacked number
 * usually has no Vantage team at all — someone else took it. The same address
 * appears in the Terms, so a mentor who cannot sign in can still reach it.
 */

import { LEGAL_CONTACT_EMAIL } from "../legal/documents";

/** A team number from a query string, or null. Never echoes anything else. */
export function parseReportedTeamNumber(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return number >= 1 && number <= 99999 ? number : null;
}

export function teamClaimReportSubject(teamNumber: number | null): string {
  return teamNumber
    ? `Team ${teamNumber} claimed on Vantage without authorization`
    : "FRC team claimed on Vantage without authorization";
}

export function teamClaimReportBody(teamNumber: number | null): string {
  const team = teamNumber ? `Team ${teamNumber}` : "Team number: ";
  return [
    `${team}`,
    "",
    "My name and role on the team (mentor, coach, lead student, etc.):",
    "",
    "How you can confirm I represent the team (for example, the team's official email, website, or a message from our lead mentor or coach):",
    "",
    "What I would like to happen (transfer the workspace to us, or remove it):",
    "",
  ].join("\n");
}

export function teamClaimReportMailto(teamNumber: number | null, email: string = LEGAL_CONTACT_EMAIL): string {
  const params = [
    `subject=${encodeURIComponent(teamClaimReportSubject(teamNumber))}`,
    `body=${encodeURIComponent(teamClaimReportBody(teamNumber))}`,
  ].join("&");
  return `mailto:${email}?${params}`;
}
