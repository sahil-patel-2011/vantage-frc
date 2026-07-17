export const OUTREACH_KINDS = ["thank_you", "renewal_ask", "new_prospect_intro", "grant_followup", "custom"] as const;
export type OutreachKind = (typeof OUTREACH_KINDS)[number];

export type DraftContext = {
  teamName: string;
  teamNumber?: number | null;
  seasonYear: number;
  senderName?: string | null;
  sponsor?: { name: string; contactName?: string | null } | null;
  contributionSummary?: { totalUsd: number } | null;
  awardHighlights?: string[];
  grant?: { name: string; funder?: string | null; amountRequestedUsd?: number | null } | null;
};

function greeting(contactName?: string | null) {
  return contactName ? `Dear ${contactName},` : "Hello,";
}

function teamSignature(context: DraftContext) {
  const numberSuffix = context.teamNumber ? ` #${context.teamNumber}` : "";
  return `${context.senderName ? `${context.senderName}\n` : ""}${context.teamName}${numberSuffix}`;
}

function usd(amount: number) {
  return amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/**
 * Template-based draft generator — no live model call. Kept behind this single
 * function so a real ChatAdapter-backed provider can replace the body later
 * without changing any caller.
 */
export function draftOutreachMessage(kind: OutreachKind, context: DraftContext): { subject: string; body: string } {
  switch (kind) {
    case "thank_you": {
      const amount = context.contributionSummary ? ` of $${usd(context.contributionSummary.totalUsd)}` : "";
      const highlights = context.awardHighlights?.length
        ? `\n\nThanks in part to your support, this season we ${context.awardHighlights.join(", ")}.`
        : "";
      return {
        subject: `Thank you from ${context.teamName}`,
        body: `${greeting(context.sponsor?.contactName)}\n\nOn behalf of everyone on ${context.teamName}, thank you for your generous support${amount} this season. Sponsors like ${context.sponsor?.name ?? "you"} make it possible for our students to build, compete, and grow.${highlights}\n\nWe'd love to keep you updated on our progress and have you visit the shop or a competition this year.\n\nWith gratitude,\n${teamSignature(context)}`,
      };
    }
    case "renewal_ask": {
      const priorAmount = context.contributionSummary
        ? ` Last season you contributed $${usd(context.contributionSummary.totalUsd)}, which directly funded our robot build.`
        : "";
      return {
        subject: `${context.teamName} — ${context.seasonYear} season sponsorship renewal`,
        body: `${greeting(context.sponsor?.contactName)}\n\nAs we gear up for the ${context.seasonYear} season, we wanted to reach out about renewing ${context.sponsor?.name ?? "your"} sponsorship.${priorAmount}\n\nYour continued partnership helps our students gain hands-on engineering, coding, and business experience. We'd welcome the chance to share our plans for this season and discuss how we can recognize your support.\n\nThank you for considering another season with us.\n\nBest,\n${teamSignature(context)}`,
      };
    }
    case "new_prospect_intro": {
      return {
        subject: `Introducing ${context.teamName} — ${context.seasonYear} sponsorship opportunity`,
        body: `${greeting(context.sponsor?.contactName)}\n\nMy name is${context.senderName ? ` ${context.senderName} and I'm` : ""} part of ${context.teamName}, a FIRST Robotics Competition team${context.teamNumber ? ` (Team ${context.teamNumber})` : ""}. Each year our students design, build, and program a competition robot from scratch while learning real engineering, programming, and business skills.\n\nWe're reaching out to introduce our program and explore whether ${context.sponsor?.name ?? "your organization"} would consider sponsoring our ${context.seasonYear} season. Sponsorship can be financial, in-kind (materials, tools, shop space), or expertise-based — whatever fits best.\n\nWe'd welcome a short call or a visit to our shop to share more. Thank you for your time and consideration.\n\nBest regards,\n${teamSignature(context)}`,
      };
    }
    case "grant_followup": {
      const amount = context.grant?.amountRequestedUsd ? ` for $${usd(context.grant.amountRequestedUsd)}` : "";
      return {
        subject: `Following up: ${context.grant?.name ?? "grant application"} — ${context.teamName}`,
        body: `Hello,\n\nI'm writing to follow up on ${context.teamName}'s application${amount} to ${context.grant?.funder ?? "your organization"} for ${context.grant?.name ?? "the grant"}. We wanted to check on the status and see if any additional information would be helpful as you review our application.\n\nThank you for your consideration — we're happy to answer any questions.\n\nBest,\n${teamSignature(context)}`,
      };
    }
    case "custom":
    default:
      return { subject: `Message from ${context.teamName}`, body: "" };
  }
}
