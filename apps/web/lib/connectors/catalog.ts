/**
 * One catalog of every connector Vantage speaks to, and the exact words a
 * deployment owner needs to make one work.
 *
 * The complaint this file answers is "all connectors don't work". Each
 * connector had its own half-answer scattered across a feature page: Onshape
 * said which variables were missing, GitHub said "OAuth App not configured on
 * this deployment" without naming one, Stripe's webhook said "Invalid webhook"
 * whether the signature was wrong or the secret was absent, and the callback
 * URL — the one thing you cannot create the provider application without — was
 * computed from the client credentials, so it was hidden from exactly the
 * person who had none yet.
 *
 * Two rules hold for every entry here:
 *
 *  1. `callbackUrl` is computed from the deployment base URL alone, never from
 *     the credentials. An admin with nothing configured still reads the URL to
 *     register. (This is the rule `onshapeCallbackUrl` established.)
 *  2. A setup message names the variables, says where to set them, and — when
 *     the provider needs one — gives the exact URL to paste. "Setup required"
 *     with no variable name is not a setup state, it is a shrug.
 *
 * Pure data + string building. No DB, no `process.env` at module scope, no
 * Node-only imports: the serialized result of `describeConnector` is rendered
 * by a Client Component, and this module is imported by its tests directly.
 */

export type ConnectorId =
  | "google"
  | "github"
  | "tba"
  | "onshape"
  | "discord"
  | "slack"
  | "email"
  | "stripe"
  | "storage-node"
  | "fusion-relay";

/**
 * Who owns the link.
 *
 * `platform` — one deployment-wide credential an operator sets in env.
 * `team`     — a row each team saves for itself (webhook, PAT, paired node).
 * `member`   — a row each person authorises for themselves (Onshape OAuth).
 *
 * The distinction matters on the page: a member looking at a `platform`
 * connector cannot fix it and should be told who can, rather than shown a
 * Connect button that will refuse them.
 */
export type ConnectorScope = "platform" | "team" | "member";

/**
 * Honest connector states.
 *
 * `connected`      — a real row proves the link. Never inferred from env.
 * `ready`          — platform credentials exist; nothing linked for this team yet.
 * `not_connected`  — nothing to configure at the platform level, and no team row.
 * `not_configured` — a required environment variable is missing.
 * `token_expired`  — a stored token is past its expiry and refresh is unavailable.
 */
export type ConnectorState =
  | "connected"
  | "ready"
  | "not_connected"
  | "not_configured"
  | "token_expired";

export type ConnectorDefinition = {
  id: ConnectorId;
  label: string;
  /** What stops working while this connector is down — in a student's words. */
  powers: string;
  scope: ConnectorScope;
  /** Variables without which the connector cannot work at all. */
  requiredEnv: readonly string[];
  /** Variables that widen what it can do but are not needed to connect. */
  optionalEnv: readonly string[];
  /**
   * Path the provider redirects to (OAuth) or posts to (webhook). Null when
   * the provider needs no URL from us — a key-only connector like TBA.
   */
  callbackPath: string | null;
  /** What the callback URL is called in the provider's own console. */
  callbackLabel: string;
  /** Env var that overrides the computed callback URL, when one exists. */
  callbackOverrideEnv?: string;
  /** Where the operator creates the credentials, named the way the console names it. */
  providerConsole: string;
  /** Scopes / permissions to grant in that console. */
  permissions: readonly string[];
  /** In-app page where a team or member completes the link. */
  managePath: string;
  /** True when this connector's link is made by a button on this page. */
  hasConnectAction: boolean;
  /** True when a stored link can be revoked from this page. */
  hasDisconnectAction: boolean;
};

/** Where a deployment's environment variables are set. Named once. */
export const ENV_LOCATION = "Vercel → Project → Settings → Environment Variables";

export const CONNECTORS: readonly ConnectorDefinition[] = [
  {
    id: "google",
    label: "Google sign-in",
    powers: "Signing in with a school Google account instead of an emailed code.",
    scope: "platform",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    optionalEnv: [],
    callbackPath: "/api/auth/callback/google",
    callbackLabel: "Authorised redirect URI",
    providerConsole:
      "Google Cloud console → APIs & Services → Credentials → OAuth 2.0 Client IDs → Web application",
    permissions: ["openid", "email", "profile"],
    managePath: "/signin",
    hasConnectAction: false,
    hasDisconnectAction: false,
  },
  {
    id: "github",
    label: "GitHub",
    powers: "Reading the robot-code repo for the deploy log, code review and calendar milestones.",
    scope: "team",
    requiredEnv: ["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"],
    optionalEnv: ["GITHUB_OAUTH_REDIRECT_URI", "GITHUB_OAUTH_SCOPES"],
    callbackPath: "/api/github/oauth/callback",
    callbackLabel: "Authorization callback URL",
    callbackOverrideEnv: "GITHUB_OAUTH_REDIRECT_URI",
    providerConsole: "github.com → Settings → Developer settings → OAuth Apps → New OAuth App",
    permissions: ["read:user", "repo"],
    managePath: "/team/admin",
    hasConnectAction: true,
    hasDisconnectAction: true,
  },
  {
    id: "tba",
    label: "The Blue Alliance",
    powers: "Match schedules, rankings and every opponent's record. Nothing in Competition fills in without it.",
    scope: "platform",
    requiredEnv: ["TBA_AUTH_KEY"],
    optionalEnv: ["TBA_API_KEY", "TBA_API_BASE_URL"],
    callbackPath: null,
    callbackLabel: "",
    providerConsole: "thebluealliance.com → Account → Read API Keys → Add a new key",
    permissions: ["Read API v3"],
    managePath: "/team/data",
    hasConnectAction: false,
    hasDisconnectAction: false,
  },
  {
    id: "onshape",
    label: "Onshape",
    powers: "Hosted CAD jobs — reading a Part Studio and writing a change back.",
    scope: "member",
    requiredEnv: ["ONSHAPE_OAUTH_CLIENT_ID", "ONSHAPE_OAUTH_CLIENT_SECRET"],
    optionalEnv: ["ONSHAPE_OAUTH_REDIRECT_URI", "ONSHAPE_OAUTH_SCOPES"],
    callbackPath: "/api/cad/onshape/oauth/callback",
    callbackLabel: "Redirect URL",
    callbackOverrideEnv: "ONSHAPE_OAUTH_REDIRECT_URI",
    providerConsole: "dev-portal.onshape.com → OAuth applications → Create new OAuth application",
    permissions: ["OAuth2Read", "OAuth2Write"],
    managePath: "/cad/connections",
    hasConnectAction: true,
    hasDisconnectAction: true,
  },
  {
    id: "discord",
    label: "Discord",
    powers: "Posting announcements and linked chat into the team server.",
    scope: "team",
    requiredEnv: [],
    optionalEnv: ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID"],
    callbackPath: null,
    callbackLabel: "",
    providerConsole:
      "Discord → Server Settings → Integrations → Webhooks (bot posts: discord.com/developers/applications → Bot)",
    permissions: ["Send Messages", "Embed Links", "Read Message History"],
    managePath: "/team/discord",
    hasConnectAction: false,
    hasDisconnectAction: true,
  },
  {
    id: "slack",
    label: "Slack",
    powers: "Mirroring team chat into a Slack channel, and reading replies back.",
    scope: "team",
    requiredEnv: [],
    optionalEnv: ["SLACK_SIGNING_SECRET"],
    callbackPath: "/api/integrations/slack/events",
    callbackLabel: "Request URL (Event Subscriptions)",
    providerConsole: "api.slack.com/apps → your app → Incoming Webhooks, then Event Subscriptions",
    permissions: ["incoming-webhook", "chat:write", "channels:history"],
    managePath: "/team/slack",
    hasConnectAction: false,
    hasDisconnectAction: true,
  },
  {
    id: "email",
    label: "Email (Resend)",
    powers: "Invites, dues reminders, announcement digests and Drive share notices.",
    scope: "platform",
    requiredEnv: ["RESEND_API_KEY", "AUTH_EMAIL_FROM"],
    optionalEnv: [],
    callbackPath: null,
    callbackLabel: "",
    providerConsole: "resend.com → API Keys, and Domains → verify the sending domain",
    permissions: ["Sending access", "A verified sending domain matching AUTH_EMAIL_FROM"],
    managePath: "/account?tab=notifications",
    hasConnectAction: false,
    hasDisconnectAction: false,
  },
  {
    id: "stripe",
    label: "Stripe",
    powers: "Plan upgrades, Usage Credit purchases and pay-as-you-go enrolment.",
    scope: "platform",
    requiredEnv: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    optionalEnv: ["DATABASE_BILLING_URL"],
    callbackPath: "/api/stripe/webhook",
    callbackLabel: "Endpoint URL (Developers → Webhooks)",
    providerConsole: "dashboard.stripe.com → Developers → Webhooks → Add endpoint",
    permissions: ["checkout.session.completed", "customer.subscription.*", "invoice.payment_failed"],
    managePath: "/billing",
    hasConnectAction: false,
    hasDisconnectAction: false,
  },
  {
    id: "storage-node",
    label: "Team storage node",
    powers: "Keeping large CAD and video files on a machine the team owns instead of paying for cloud storage.",
    scope: "team",
    requiredEnv: [],
    optionalEnv: [],
    callbackPath: "/api/storage-node/pair/poll",
    callbackLabel: "Poll URL the node reads while pairing",
    providerConsole: "Run the storage-node agent on the team machine; it prints a pairing code",
    permissions: ["A pairing code approved by an owner or admin"],
    managePath: "/team/storage",
    hasConnectAction: false,
    hasDisconnectAction: false,
  },
  {
    id: "fusion-relay",
    label: "Fusion 360 relay",
    powers: "Driving Fusion 360 on a laptop from Vantage. Fusion has no cloud API; the relay is local by design.",
    scope: "team",
    requiredEnv: ["FUSION_RELAY_SIGNING_SECRET"],
    optionalEnv: ["DATABASE_CAD_RELAY_URL"],
    callbackPath: null,
    callbackLabel: "",
    providerConsole: "Install the Vantage Fusion add-in on the laptop, then pair it from CAD Connections",
    permissions: ["A pairing code approved by an owner or admin"],
    managePath: "/cad/connections",
    hasConnectAction: false,
    hasDisconnectAction: false,
  },
] as const;

export function connectorById(id: ConnectorId): ConnectorDefinition {
  const found = CONNECTORS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown connector: ${id}`);
  return found;
}

/**
 * The deployment's public origin, with no trailing slash.
 *
 * Falls back to the dev port rather than throwing: a page that cannot render
 * because BETTER_AUTH_URL is unset is a worse answer than a page that shows a
 * localhost callback URL and tells the reader to set BETTER_AUTH_URL.
 */
export function deploymentBaseUrl(env: Record<string, string | undefined>): string {
  const explicit = env.BETTER_AUTH_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim();
  return (explicit || "http://localhost:3001").replace(/\/$/, "");
}

/**
 * The URL to register with the provider — computed from the base URL alone.
 *
 * Never gated on the credentials being present: the admin who has not created
 * the OAuth application yet is the only person who needs this string.
 */
export function connectorCallbackUrl(
  def: ConnectorDefinition,
  env: Record<string, string | undefined>,
): string | null {
  if (!def.callbackPath) return null;
  const override = def.callbackOverrideEnv ? env[def.callbackOverrideEnv]?.trim() : "";
  if (override) return override;
  return `${deploymentBaseUrl(env)}${def.callbackPath}`;
}

/** Required variables that are absent or blank, in declaration order. */
export function missingConnectorEnv(
  def: ConnectorDefinition,
  env: Record<string, string | undefined>,
): string[] {
  return def.requiredEnv.filter((name) => !env[name]?.trim());
}

/** "A", "A and B", "A, B and C" — a list a person reads, not a JSON array. */
export function joinEnvNames(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export type ConnectorStatus = {
  id: ConnectorId;
  label: string;
  powers: string;
  scope: ConnectorScope;
  state: ConnectorState;
  /** The one line the card shows next to the name. */
  statusLine: string;
  /** The paragraph under it — always actionable, never a bare "setup required". */
  detail: string;
  missingEnv: string[];
  callbackUrl: string | null;
  callbackLabel: string;
  providerConsole: string;
  permissions: string[];
  managePath: string;
  canConnect: boolean;
  canDisconnect: boolean;
};

export type ConnectorLinkProof = {
  /** A real stored row exists. Never derived from environment variables. */
  linked?: boolean;
  /** Who the stored credential belongs to, when the provider told us. */
  account?: string | null;
  /** Epoch ms. When in the past and no refresh token is held, the link is expired. */
  expiresAt?: number | null;
  /** A refresh token is stored, so an expiry is recoverable without the member. */
  refreshable?: boolean;
  /** Overrides `detail` when the connector has something specific to add. */
  note?: string | null;
};

/**
 * Status line, in the three shapes the settings page promises:
 *
 *   Connected as jane@team.org
 *   Not configured — set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET
 *   Token expired — reconnect
 */
export function connectorStatusLine(input: {
  state: ConnectorState;
  account?: string | null;
  missingEnv?: readonly string[];
}): string {
  switch (input.state) {
    case "connected":
      return input.account?.trim() ? `Connected as ${input.account.trim()}` : "Connected";
    case "token_expired":
      return "Token expired — reconnect";
    case "not_configured":
      return input.missingEnv?.length
        ? `Not configured — set ${joinEnvNames(input.missingEnv)}`
        : "Not configured";
    case "ready":
      return "Ready to connect";
    default:
      return "Not connected";
  }
}

/**
 * The actionable paragraph. Order is deliberate: what is wrong, which variable
 * fixes it, where that variable is set, and only then the URL to register.
 */
export function connectorDetail(
  def: ConnectorDefinition,
  input: { state: ConnectorState; missingEnv: readonly string[]; callbackUrl: string | null; note?: string | null },
): string {
  const register = input.callbackUrl
    ? ` Register this exact ${def.callbackLabel} on the provider (${def.providerConsole}): ${input.callbackUrl}`
    : ` Create the credential at ${def.providerConsole}.`;

  const setupSentence = `Set ${joinEnvNames(input.missingEnv)} in your deployment environment (${ENV_LOCATION}), then redeploy.${register}`;

  // A stored link plus missing platform credentials is a real combination —
  // someone rotated GITHUB_OAUTH_CLIENT_ID away and the old row is still there
  // holding a token. Saying only "Not configured" hides the credential; saying
  // only "reconnect" hides why reconnecting cannot work yet. Say both.
  const envTail = input.missingEnv.length > 0 ? ` This deployment is also missing ${joinEnvNames(input.missingEnv)} (${ENV_LOCATION}), so a new authorisation cannot be started until that is set.` : "";

  if (input.note?.trim()) return `${input.note.trim()}${envTail}`;

  if (input.state === "not_configured") return setupSentence;

  if (input.state === "token_expired") {
    return `The stored token is past its expiry and could not be refreshed. Disconnect and connect again to issue a new one.${envTail || register}`;
  }
  if (input.state === "connected") {
    const base = input.callbackUrl
      ? `${def.powers} Registered ${def.callbackLabel}: ${input.callbackUrl}`
      : def.powers;
    return `${base}${envTail}`;
  }
  if (input.state === "ready") {
    return `Credentials are set on this deployment — finish the link on ${def.managePath}.${register}`;
  }
  return `${def.powers}${register}`;
}

/**
 * Full status for one connector, from environment plus whatever proof of a
 * stored row the caller could gather. Callers that cannot reach the database
 * pass no proof and get an env-only answer, which is still honest: it never
 * claims Connected.
 */
export function describeConnector(
  def: ConnectorDefinition,
  env: Record<string, string | undefined>,
  proof: ConnectorLinkProof = {},
): ConnectorStatus {
  const missingEnv = missingConnectorEnv(def, env);
  const callbackUrl = connectorCallbackUrl(def, env);

  let state: ConnectorState;
  // A real stored row outranks a missing variable. Deciding "not configured"
  // first meant that rotating GITHUB_OAUTH_CLIENT_ID away turned a dead
  // credential into a card that said "Not configured", offered no Disconnect,
  // and left the token sitting in the row with no way to clear it. The stored
  // link is the thing the reader has to act on; the missing variable is
  // appended to the detail, not substituted for it.
  if (proof.linked) {
    const expired =
      typeof proof.expiresAt === "number" && proof.expiresAt > 0 && proof.expiresAt <= Date.now();
    state = expired && !proof.refreshable ? "token_expired" : "connected";
  } else if (missingEnv.length > 0) {
    state = "not_configured";
  } else if (def.scope === "platform") {
    // A platform connector with every variable present IS the connection —
    // there is no second row for a person to create.
    state = "connected";
  } else {
    state = def.requiredEnv.length > 0 ? "ready" : "not_connected";
  }

  return {
    id: def.id,
    label: def.label,
    powers: def.powers,
    scope: def.scope,
    state,
    statusLine: connectorStatusLine({ state, account: proof.account, missingEnv }),
    detail: connectorDetail(def, { state, missingEnv, callbackUrl, note: proof.note }),
    missingEnv,
    callbackUrl,
    callbackLabel: def.callbackLabel,
    providerConsole: def.providerConsole,
    permissions: [...def.permissions],
    managePath: def.managePath,
    // Connect needs live platform credentials — offering it without them is
    // the "Connect button that reloads the page" this change removes.
    canConnect: def.hasConnectAction && missingEnv.length === 0,
    // Disconnect needs only a stored row. Deliberately NOT gated on the
    // credentials: someone whose deployment rotated the OAuth client away is
    // exactly the person who still needs to revoke the token Vantage holds.
    canDisconnect: def.hasDisconnectAction && Boolean(proof.linked),
  };
}
