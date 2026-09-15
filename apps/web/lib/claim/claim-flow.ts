export const CLAIM_DENIED_MESSAGE =
  "This number cannot be claimed here. Ask a coach for a join link, or try another unused team number.";

export function claimSignInHref(): string {
  return `/signin?next=${encodeURIComponent("/claim")}`;
}

export function claimOneAccountCopy(): string {
  return "Use the same email for Google and the email code so you get one account, not two.";
}

export function slugFromTeamName(name: string, teamNumber: number): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `team-${teamNumber}`;
}
