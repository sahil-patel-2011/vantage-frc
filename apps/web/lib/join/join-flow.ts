import type { TeamJoinLinkPreview } from "@vantage/core";

export function joinSignInHref(token: string): string {
  const next = `/join?token=${encodeURIComponent(token)}`;
  return `/signin?next=${encodeURIComponent(next)}`;
}

export function joinOneAccountCopy(): string {
  return "Use the same email for Google and the email code so you get one account, not two.";
}

export function joinPreviewHeadline(preview: TeamJoinLinkPreview | null): string {
  if (!preview) return "This join link is not valid";
  switch (preview.status) {
    case "open":
      return preview.teamNumber
        ? `Join Team ${preview.teamNumber}`
        : `Join ${preview.orgName}`;
    case "full":
      return "This join link is full";
    case "expired":
      return "This join link has expired";
    case "revoked":
      return "This join link was turned off";
    default: {
      const exhaustive: never = preview.status;
      return exhaustive;
    }
  }
}

export function joinPreviewDetail(preview: TeamJoinLinkPreview | null): string {
  if (!preview) {
    return "Ask a coach or mentor for a new link. Team numbers never join you on their own.";
  }
  switch (preview.status) {
    case "open":
      return `${preview.orgName} has ${preview.remaining} of ${preview.maxUses} spots left on this link. Sign in with Google or an email code, then you land on the team.`;
    case "full":
      return "Ask a coach for a new join link. The last one already hit its 50-person limit.";
    case "expired":
      return "Ask a coach to make a new join link from Team admin.";
    case "revoked":
      return "A coach turned this link off. Ask them for a new one.";
    default: {
      const exhaustive: never = preview.status;
      return exhaustive;
    }
  }
}
