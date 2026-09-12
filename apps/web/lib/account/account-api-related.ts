/**
 * Student-facing Account API copy for connectors and email delivery.
 *
 * `/connectors` still names env vars for owners/admins. Account is personal:
 * members read these strings, so they never say OAuth, RESEND, or Select a
 * workspace. CAD Connections (#26/#27) already uses the same mentor-ask voice.
 */

export const ACCOUNT_ONSHAPE_COPY = {
  setupRequired: "Ask a mentor to finish Onshape setup for this team, then connect in CAD Connections.",
  connected: "Onshape is linked for your account.",
  chooseTeam: "Onshape is ready. Choose your team, then connect in CAD Connections.",
  empty: "Connect Onshape in CAD Connections. Connected only after you authorize in the browser.",
} as const;

export const ACCOUNT_GITHUB_COPY = {
  connected: "GitHub is linked for this team.",
  chooseTeam: "Choose your team, then an owner or admin can connect GitHub in Invites.",
  emptyConfigured: "No GitHub account linked yet. An owner or admin can connect GitHub in Invites.",
  emptyUnconfigured: "No GitHub link yet. Ask an owner or admin to connect GitHub in Invites.",
} as const;

export const ACCOUNT_GOOGLE_COPY = {
  available: "Google sign-in is configured for this deployment.",
  setupRequired: "Google sign-in isn't ready yet. Use an emailed sign-in code, or ask a mentor.",
} as const;

export const ACCOUNT_TBA_COPY = {
  ready: "The Blue Alliance is connected for match schedules and rankings.",
  cached: "Saved rankings from an earlier sync. Connect The Blue Alliance to refresh.",
  setupRequired: "Connect The Blue Alliance under Connectors, or ask a mentor.",
} as const;

export const ACCOUNT_DISCORD_COPY = {
  connectedWebhook: "Discord can post for this team.",
  connectedBot: "Discord can post for this team.",
  chooseTeamConfigured: "Choose your team to add a Discord webhook or channel.",
  chooseTeam: "Choose your team, then add a channel webhook on Discord settings.",
  setupRequired: "Add a Discord channel webhook on Team → Discord before posts work.",
  emptyConfigured: "Add a webhook or channel id on Discord settings before posts work.",
  empty: "Webhook not saved for this team yet. Connected only after a valid webhook or bot and channel.",
} as const;

export const ACCOUNT_EMAIL_COPY = {
  ready: "Email delivery is on for this team.",
  setupRequired:
    "Email isn't ready yet. Invites still work — copy the link. Ask a mentor to finish email setup.",
  localOnly: "This copy of Vantage does not send email. Invites still work — copy the link.",
} as const;

export const ACCOUNT_PHONE_COPY = {
  ready: "Phone verification texts are ready.",
  setupRequired: "Phone texts aren't ready yet. Ask a mentor to finish phone setup.",
} as const;

const ACCOUNT_API_LEAK =
  /OAuth|ONSHAPE_|GITHUB_OAUTH|RESEND_|AUTH_EMAIL_FROM|DISCORD_BOT|SLACK_SIGNING|TBA_AUTH|TWILIO_|vantage-cad|Vercel|\bPAT\b|Select a workspace/i;

export function accountOnshapeDetail(input: {
  configured: boolean;
  connected: boolean;
  orgId: string | null;
}): string {
  if (!input.configured) return ACCOUNT_ONSHAPE_COPY.setupRequired;
  if (input.connected) return ACCOUNT_ONSHAPE_COPY.connected;
  if (!input.orgId) return ACCOUNT_ONSHAPE_COPY.chooseTeam;
  return ACCOUNT_ONSHAPE_COPY.empty;
}

export function accountGithubDetail(input: {
  configured: boolean;
  connected: boolean;
  orgId: string | null;
}): string {
  if (input.connected) return ACCOUNT_GITHUB_COPY.connected;
  if (!input.orgId) return ACCOUNT_GITHUB_COPY.chooseTeam;
  return input.configured ? ACCOUNT_GITHUB_COPY.emptyConfigured : ACCOUNT_GITHUB_COPY.emptyUnconfigured;
}

export function accountDiscordDetail(input: {
  canPost: boolean;
  hasWebhook: boolean;
  configured: boolean;
  orgId: string | null;
}): string {
  if (input.canPost) {
    return input.hasWebhook ? ACCOUNT_DISCORD_COPY.connectedWebhook : ACCOUNT_DISCORD_COPY.connectedBot;
  }
  if (!input.orgId) {
    return input.configured ? ACCOUNT_DISCORD_COPY.chooseTeamConfigured : ACCOUNT_DISCORD_COPY.chooseTeam;
  }
  if (!input.hasWebhook && !input.configured) return ACCOUNT_DISCORD_COPY.setupRequired;
  return input.configured ? ACCOUNT_DISCORD_COPY.emptyConfigured : ACCOUNT_DISCORD_COPY.empty;
}

export function studentEmailDelivery(input: {
  status: "available" | "setup_required" | string;
  missingEnv: readonly string[];
  detail: string;
}): { status: string; missingEnv: string[]; detail: string } {
  let detail: string;
  if (input.status === "setup_required") {
    detail = ACCOUNT_EMAIL_COPY.setupRequired;
  } else if (/NOT delivered/i.test(input.detail)) {
    detail = ACCOUNT_EMAIL_COPY.localOnly;
  } else {
    detail = ACCOUNT_EMAIL_COPY.ready;
  }
  return { status: input.status, missingEnv: [], detail };
}

export function studentPhoneOtp(input: { configured: boolean }): { configured: boolean; message: string } {
  return {
    configured: input.configured,
    message: input.configured ? ACCOUNT_PHONE_COPY.ready : ACCOUNT_PHONE_COPY.setupRequired,
  };
}

/** Guard: every exported Account API sentence stays student-safe. */
export function accountApiCopyLeaks(text: string): boolean {
  return ACCOUNT_API_LEAK.test(text);
}
