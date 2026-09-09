/**
 * The new-member onboarding sequence, decided from real state.
 *
 * WHO THIS CAN REACH, AND WHO IT CANNOT
 *
 * The obvious version of this feature is: a student fills in the team's intake
 * link, and Vantage starts emailing them. We do not build that, and the reason
 * is not caution for its own sake. That person typed an address into a question
 * so a team could contact them. There is no account behind it, no preferences
 * row, no unsubscribe token, no verification that the address is theirs — and
 * on an FRC intake form they are usually fourteen. Mail to that address would
 * be unsolicited mail to an unverified minor from a product they never signed
 * up for, with no working way to stop it.
 *
 * So the sequence starts at the moment consent exists: a lead invites them, they
 * accept, they create an account. From then on they have an address we hold
 * because they signed in with it, a preferences page, and a one-click
 * unsubscribe — and this file decides what, if anything, is worth saying.
 *
 * WHAT IT WILL NOT SAY
 *
 * Nothing here is a "you have 0 tasks!" email. `first_week` and `settling_in`
 * return null when the member has nothing outstanding, which on a well-run team
 * is most of the time. A sequence that sends on a timer regardless of state is
 * how a product teaches people to ignore it.
 */

export const ONBOARDING_STAGES = ["welcome", "first_week", "settling_in"] as const;
export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

/** Stage boundaries in days since the membership row was created. */
const STAGE_AT: Array<{ stage: OnboardingStage; from: number }> = [
  { stage: "settling_in", from: 10 },
  { stage: "first_week", from: 3 },
  { stage: "welcome", from: 0 },
];

/**
 * After this the sequence is over. Someone who joined five weeks ago is not a
 * new member, and a backlog sweep must not treat them as one.
 */
export const ONBOARDING_WINDOW_DAYS = 30;

export function stageForAge(daysSinceJoin: number): OnboardingStage | null {
  if (daysSinceJoin < 0 || daysSinceJoin > ONBOARDING_WINDOW_DAYS) return null;
  return STAGE_AT.find((entry) => daysSinceJoin >= entry.from)?.stage ?? null;
}

export type OnboardingOutstanding = {
  /** Profile never finished — the app itself gates them to /onboarding. */
  profileIncomplete: boolean;
  /** Titles of open forms assigned to them that they have not answered. */
  openForms: string[];
  /** Titles of announcements needing acknowledgement that they have not given. */
  unacknowledged: string[];
};

export function hasSomethingOutstanding(outstanding: OnboardingOutstanding): boolean {
  return (
    outstanding.profileIncomplete ||
    outstanding.openForms.length > 0 ||
    outstanding.unacknowledged.length > 0
  );
}

export type OnboardingEmail = { subject: string; text: string };

function list(items: string[]): string {
  return items.map((item) => `  · ${item}`).join("\n");
}

function outstandingBlock(outstanding: OnboardingOutstanding, baseUrl: string): string {
  const blocks: string[] = [];
  if (outstanding.profileIncomplete) {
    blocks.push(`Finish your profile — the rest of Vantage stays locked until you do:\n${baseUrl}/onboarding`);
  }
  if (outstanding.openForms.length > 0) {
    blocks.push(
      `${outstanding.openForms.length === 1 ? "A form is" : `${outstanding.openForms.length} forms are`} waiting for you:\n${list(outstanding.openForms)}\n${baseUrl}/forms`,
    );
  }
  if (outstanding.unacknowledged.length > 0) {
    blocks.push(
      `${outstanding.unacknowledged.length === 1 ? "An announcement needs" : `${outstanding.unacknowledged.length} announcements need`} your confirmation that you have read ${outstanding.unacknowledged.length === 1 ? "it" : "them"}:\n${list(outstanding.unacknowledged)}\n${baseUrl}/announcements`,
    );
  }
  return blocks.join("\n\n");
}

/**
 * The message for a stage, or null when there is nothing honest to send.
 *
 * `welcome` always has something to say — which team you are in and where the
 * controls are, both of which are facts. The later two are pure follow-up: no
 * outstanding items, no email.
 */
export function renderOnboardingEmail(input: {
  stage: OnboardingStage;
  orgName: string;
  teamNumber: number | null;
  memberName: string | null;
  outstanding: OnboardingOutstanding;
  baseUrl: string;
}): OnboardingEmail | null {
  const base = input.baseUrl.replace(/\/$/, "");
  const team = input.teamNumber ? `${input.orgName} (Team ${input.teamNumber})` : input.orgName;
  const greeting = input.memberName?.trim() ? `${input.memberName.trim()}, ` : "";
  const outstanding = outstandingBlock(input.outstanding, base);
  const footer = `You can change which of these emails you get, or stop all of them, here:\n${base}/notifications/preferences`;

  if (input.stage === "welcome") {
    const body = [
      `${greeting}you are on ${team} in Vantage.`,
      `Vantage is where your team keeps its scouting, its build and pit work, its schedule and its announcements. Start here:\n${base}/`,
      outstanding ? `A couple of things are already waiting for you:\n\n${outstanding}` : "",
      footer,
    ]
      .filter(Boolean)
      .join("\n\n");
    return { subject: `You are on ${team} in Vantage`, text: body };
  }

  if (!hasSomethingOutstanding(input.outstanding)) return null;

  if (input.stage === "first_week") {
    return {
      subject: `Still waiting on you — ${input.orgName}`,
      text: [
        `${greeting}a few things on ${team} still have your name on them.`,
        outstanding,
        footer,
      ].join("\n\n"),
    };
  }

  return {
    subject: `Last nudge — ${input.orgName}`,
    text: [
      `${greeting}this is the last automatic reminder about these. After this, ${input.orgName} will chase you in person instead.`,
      outstanding,
      footer,
    ].join("\n\n"),
  };
}
