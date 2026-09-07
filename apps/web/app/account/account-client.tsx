"use client";

import { useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel, TabBar } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  ACCOUNT_RELATED_INCLUDE,
  CONNECTIONS_RELATED_INCLUDE,
  accountNextActions,
  accountRelatedLinks,
  buildConnectionConnectors,
  classifyConnectionsShell,
  connectionBadgeLabel,
  connectionBadgeTone,
  connectionsEmptyCopy,
  connectionsNextActions,
  connectionsRelatedLinks,
  formatAccountOrgLabel,
  formatAccountRole,
  type ConnectionConnectorStatus,
} from "../../lib/account";
import { withOrgHref } from "../../lib/nav/product-nav";
import {
  readPushClientState,
  subscribeToPush,
  unsubscribeFromPush,
  type PushClientState,
} from "../../lib/push/client";
import { SettingsBar } from "../../components/settings-bar";
import { signOutAndRedirect } from "../../lib/sign-out";
import AppearancePanel from "./appearance-panel";
import "./account.css";

type NotificationPrefs = {
  matchAlerts: boolean;
  scoutReminders: boolean;
  syncFailures: boolean;
  productUpdates: boolean;
  todoAssigned: boolean;
  todoCompleted: boolean;
  dutyAssigned: boolean;
  calendarEvents: boolean;
  sponsorReminders: boolean;
  teamChat: boolean;
};

type EmailPrefs = {
  productUpdates: boolean;
  coachAssignments: boolean;
  coachTodos: boolean;
  coachPracticeReminders: boolean;
  sponsorReminders: boolean;
};

type Integration = { status: "available" | "setup_required"; detail: string };

type ConnectorIntegration = {
  status: ConnectionConnectorStatus;
  detail: string;
};

type AccountView = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  recoveryEmail?: string | null;
  phoneE164?: string | null;
  phoneVerified?: boolean;
  phoneOtp?: { configured: boolean; message: string };
  themePreference?: "light" | "dark";
  notificationPrefs?: NotificationPrefs;
  emailPrefs?: EmailPrefs;
  emailDelivery?: Integration;
  unreadNotificationCount?: number;
  integrations?: {
    google: Integration;
    tba: Integration;
    onshape?: ConnectorIntegration;
    discord?: ConnectorIntegration;
    github?: ConnectorIntegration;
    slack?: ConnectorIntegration;
  };
};

type OrgContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  planCode: string | null;
  workspaceCount: number;
};

type Tab = "profile" | "appearance" | "notifications" | "integrations";

const PREF_LABELS: { key: keyof NotificationPrefs; title: string; detail: string }[] = [
  {
    key: "todoAssigned",
    title: "Todo assignments",
    detail: "Inbox when a coach or teammate assigns you a todo.",
  },
  {
    key: "todoCompleted",
    title: "Todo completions",
    detail: "Inbox when someone finishes a todo you created or own.",
  },
  {
    key: "dutyAssigned",
    title: "Duty assignments",
    detail: "Inbox when you are put on a scouting, pit, drive, or outreach duty.",
  },
  {
    key: "calendarEvents",
    title: "Calendar events",
    detail: "Inbox when your subteam (or whole team) gets a new or updated event.",
  },
  { key: "matchAlerts", title: "Match alerts", detail: "Upcoming match reminders when live TBA data is available." },
  { key: "scoutReminders", title: "Scout reminders", detail: "Assigned scouting form nudges for your workspace." },
  { key: "syncFailures", title: "Sync failures", detail: "Notify when TBA/reference ingest health degrades." },
  { key: "productUpdates", title: "In-app product notes", detail: "Release notes and product updates in the inbox (on by default)." },
  {
    key: "sponsorReminders",
    title: "Sponsor CRM reminders",
    detail: "Thank-you, renewal, and overdue follow-up nudges for your team's sponsors.",
  },
  {
    key: "teamChat",
    title: "Team chat",
    detail: "Inbox when someone posts in Team chat (including Slack-bridged messages) or mentions you.",
  },
];

const EMAIL_PREF_LABELS: { key: keyof EmailPrefs; title: string; detail: string }[] = [
  {
    key: "productUpdates",
    title: "Product updates / changelog",
    detail: "Release-note emails when a staged release targets your plan. On by default — opt out anytime.",
  },
  {
    key: "coachAssignments",
    title: "Coach / mentor assignments",
    detail: "Email when a coach or mentor assigns you work.",
  },
  {
    key: "coachTodos",
    title: "Coach / mentor todos",
    detail: "Email when a todo is assigned to you.",
  },
  {
    key: "coachPracticeReminders",
    title: "Practice reminders",
    detail: "Email reminders for scheduled driver / team practice.",
  },
  {
    key: "sponsorReminders",
    title: "Sponsor reminders",
    detail: "Opt-in email for thank-you / renewal / overdue follow-up CRM nudges (never emails sponsors).",
  },
];

/**
 * Web-push registration for THIS browser. Rendered by state, never as a single
 * hopeful button: unsupported / iOS-not-installed / denied / server-unconfigured
 * each show their honest reason as text instead of a dead control.
 */
function PushDevicePanel({ orgId }: { orgId: string | null }) {
  const [push, setPush] = useState<PushClientState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void readPushClientState().then((state) => {
      if (!cancelled) setPush(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    setPush(await readPushClientState());
  }

  async function enable() {
    setPushBusy(true);
    setPushError("");
    try {
      const result = await subscribeToPush(orgId ?? undefined);
      if (!result.ok) setPushError(result.reason);
    } finally {
      await refresh();
      setPushBusy(false);
    }
  }

  async function disable() {
    setPushBusy(true);
    setPushError("");
    try {
      await unsubscribeFromPush();
    } finally {
      await refresh();
      setPushBusy(false);
    }
  }

  return (
    <>
      <h2 className="account-prefs-heading">This device</h2>
      <p className="app-muted">
        Push notifications reach this browser even when the tab is closed. Each device is registered
        separately.
      </p>
      {push === null ? <p className="app-muted">Checking this browser…</p> : null}
      {push && (push.state === "unsupported" || push.state === "ios_needs_home_screen" || push.state === "denied" || push.state === "setup_required") ? (
        <p className="app-muted">{push.reason}</p>
      ) : null}
      {push?.state === "available" ? (
        <div className="account-actions">
          <button className="app-button" type="button" disabled={pushBusy} onClick={() => void enable()}>
            Turn on push for this device
          </button>
        </div>
      ) : null}
      {push?.state === "subscribed" ? (
        <div className="account-actions">
          <p style={{ margin: 0 }}>Push is on for this device.</p>
          <button className="app-button secondary" type="button" disabled={pushBusy} onClick={() => void disable()}>
            Turn off
          </button>
        </div>
      ) : null}
      {pushError ? (
        <p className="app-muted" role="alert">
          {pushError}
        </p>
      ) : null}
    </>
  );
}

function AccountRelated({ orgId }: { orgId: string | null }) {
  const links = accountRelatedLinks(orgId, { include: [...ACCOUNT_RELATED_INCLUDE] });
  return (
    <nav className="product-hub-related account-related" aria-label="Related account tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function ConnectionsRelated({ orgId }: { orgId: string | null }) {
  const links = connectionsRelatedLinks(orgId, { include: [...CONNECTIONS_RELATED_INCLUDE] });
  return (
    <nav className="product-hub-related connections-related" aria-label="Related connection tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function ConnectionsNextActions({
  orgId,
  googleReady,
  tbaReady,
  onshapeStatus,
  discordStatus,
  githubStatus,
  slackStatus,
}: {
  orgId: string | null;
  googleReady: boolean;
  tbaReady: boolean;
  onshapeStatus: ConnectionConnectorStatus;
  discordStatus: ConnectionConnectorStatus;
  githubStatus: ConnectionConnectorStatus;
  slackStatus: ConnectionConnectorStatus;
}) {
  const actions = connectionsNextActions({
    orgId,
    googleReady,
    tbaReady,
    onshapeStatus,
    discordStatus,
    githubStatus,
    slackStatus,
  });
  return (
    <section className="account-next-actions app-card soft-panel" aria-label="Connection next actions">
      <header>
        <h2>Next actions</h2>
        <p>
          Connected appears only for real OAuth, webhook, or PAT rows — never a DEMO linked account.
        </p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={`Open ${action.label}`}>Open</a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function NextActions({
  orgId,
  hasProfile,
  emailDeliveryReady,
  googleReady,
  tbaReady,
}: {
  orgId: string | null;
  hasProfile: boolean;
  emailDeliveryReady: boolean;
  googleReady: boolean;
  tbaReady: boolean;
}) {
  const actions = accountNextActions({
    orgId,
    hasProfile,
    emailDeliveryReady,
    googleReady,
    tbaReady,
  });
  return (
    <section className="account-next-actions app-card soft-panel" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>
          Profile is personal; billing and usage follow your active workspace — never DEMO plan or ledger figures.
        </p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={`Open ${action.label}`}>Open</a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function OrgContextCard({ org }: { org: OrgContext }) {
  const label = formatAccountOrgLabel(org);
  const role = formatAccountRole(org.role);

  if (!org.orgId) {
    return (
      <EmptyState
        soft
        badge="Setup required"
        badgeTone="setup"
        title="No workspace selected"
        description={
          org.workspaceCount > 0
            ? "Your profile prefs still apply to this login. Pick an active team for billing, AI usage, and connectors."
            : "You are signed in, but no team membership is attached yet. Ask an owner for an invite — nothing is pre-seeded here."
        }
      >
        <div className="account-empty-actions">
          <a className="app-button" href="/workspace">
            Open Workspace
          </a>
          <a className="app-button secondary" href="/support">
            Help & Support
          </a>
        </div>
      </EmptyState>
    );
  }

  return (
    <Panel className="account-org-context" aria-label="Active workspace">
      <div className="account-org-context-top">
        <div>
          <h2>Active workspace</h2>
          <p>{label}</p>
        </div>
        <div className="account-org-meta">
          {role ? <span className="app-badge">{role}</span> : null}
          {org.planCode?.trim() ? (
            <span className="app-badge good">{org.planCode.trim()}</span>
          ) : (
            <span className="app-badge setup">Plan unset</span>
          )}
        </div>
      </div>
      <p className="app-muted">
        Display name and notification prefs are personal. AI keys, billing, and connectors follow this workspace.
      </p>
      <div className="settings-inline-links">
        <a href="/workspace">Switch workspace</a>
        <a href={withOrgHref("/team/ai-keys", org.orgId)}>AI keys</a>
        <a href={withOrgHref("/ai?tab=budgets", org.orgId)}>Billing</a>
        <a href={withOrgHref("/team/usage", org.orgId)}>AI usage</a>
      </div>
    </Panel>
  );
}

export default function AccountClient() {
  const [tab, setTab] = useState<Tab>("profile");
  const [account, setAccount] = useState<AccountView | null>(null);
  const [org, setOrg] = useState<OrgContext>({
    orgId: null,
    orgName: null,
    teamNumber: null,
    role: null,
    planCode: null,
    workspaceCount: 0,
  });
  const [displayName, setDisplayName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [phoneE164, setPhoneE164] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    matchAlerts: true,
    scoutReminders: true,
    syncFailures: true,
    productUpdates: true,
    todoAssigned: true,
    todoCompleted: true,
    dutyAssigned: true,
    calendarEvents: true,
    sponsorReminders: true,
    teamChat: true,
  });
  const [emailPrefs, setEmailPrefs] = useState<EmailPrefs>({
    productUpdates: true,
    coachAssignments: false,
    coachTodos: false,
    coachPracticeReminders: false,
    sponsorReminders: false,
  });
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadStatus, setLoadStatus] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("tab");
    if (
      requested === "profile" ||
      requested === "appearance" ||
      requested === "notifications" ||
      requested === "integrations"
    ) {
      setTab(requested);
    }
  }, []);

  function selectTab(next: Tab) {
    setTab(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === "profile") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function load() {
    setLoading(true);
    setFetchFailed(false);
    try {
      const response = await fetch("/api/account");
      if (!response.ok) {
        setMessage("");
        setMessageOk(false);
        setAccount(null);
        setLoadStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setLoadStatus(null);
      const data = (await response.json()) as AccountView;
      setAccount(data);
      setDisplayName(data.displayName ?? data.name ?? "");
      setFirstName(data.firstName ?? "");
      setLastName(data.lastName ?? "");
      setDateOfBirth(data.dateOfBirth ?? "");
      setRecoveryEmail(data.recoveryEmail ?? "");
      setPhoneE164(data.phoneE164 ?? "");
      if (data.notificationPrefs) setPrefs(data.notificationPrefs);
      if (data.emailPrefs) setEmailPrefs(data.emailPrefs);
      setMessage("");

      const meResponse = await fetch("/api/me");
      if (meResponse.ok) {
        const me = (await meResponse.json()) as {
          orgId?: string | null;
          orgName?: string | null;
          teamNumber?: number | null;
          role?: string | null;
          planCode?: string | null;
          workspaces?: unknown[];
        };
        setOrg({
          orgId: me.orgId ?? null,
          orgName: me.orgName ?? null,
          teamNumber: me.teamNumber ?? null,
          role: me.role ?? null,
          planCode: me.planCode ?? null,
          workspaceCount: Array.isArray(me.workspaces) ? me.workspaces.length : me.orgId ? 1 : 0,
        });
      } else {
        setOrg({
          orgId: null,
          orgName: null,
          teamNumber: null,
          role: null,
          planCode: null,
          workspaceCount: 0,
        });
      }
    } catch {
      setMessage("");
      setMessageOk(false);
      setAccount(null);
      setLoadStatus(null);
      setFetchFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setMessageOk(false);
    try {
      const response = await fetch("/api/account", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          dateOfBirth: dateOfBirth.trim() || undefined,
          recoveryEmail: recoveryEmail.trim() || null,
          phoneE164: phoneE164.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not save profile.");
        return;
      }
      setMessage("Profile saved.");
      setMessageOk(true);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function savePrefs() {
    setBusy(true);
    setMessage("");
    setMessageOk(false);
    try {
      const response = await fetch("/api/account", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationPrefs: prefs, emailPrefs }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not save notification preferences.");
        return;
      }
      setMessage("Notification preferences saved.");
      setMessageOk(true);
    } finally {
      setBusy(false);
    }
  }

  async function sendPhoneOtp() {
    setBusy(true);
    setMessage("");
    setMessageOk(false);
    try {
      const response = await fetch("/api/account/phone-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send", phoneE164 }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not send phone code.");
        return;
      }
      setMessage("Phone code sent.");
      setMessageOk(true);
    } finally {
      setBusy(false);
    }
  }

  async function verifyPhoneOtp() {
    setBusy(true);
    setMessage("");
    setMessageOk(false);
    try {
      const response = await fetch("/api/account/phone-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify", code: otpCode }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not verify phone.");
        return;
      }
      setMessage("Phone verified for OTP.");
      setMessageOk(true);
      setOtpCode("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    await signOutAndRedirect("/");
  }

  const initial = (displayName.trim()?.[0] ?? account?.email?.trim()?.[0] ?? "?").toUpperCase();
  const orgId = org.orgId;
  const hasProfile = Boolean(displayName.trim());
  const emailDeliveryReady = account?.emailDelivery?.status !== "setup_required";
  const googleReady = account?.integrations?.google.status === "available";
  const tbaReady = account?.integrations?.tba.status === "available";
  const onshapeStatus: ConnectionConnectorStatus =
    account?.integrations?.onshape?.status ?? (orgId ? "empty" : "setup_required");
  const discordStatus: ConnectionConnectorStatus =
    account?.integrations?.discord?.status ?? (orgId ? "empty" : "setup_required");
  const githubStatus: ConnectionConnectorStatus =
    account?.integrations?.github?.status ?? (orgId ? "empty" : "setup_required");
  const slackStatus: ConnectionConnectorStatus =
    account?.integrations?.slack?.status ?? (orgId ? "empty" : "setup_required");
  const connectionCards = buildConnectionConnectors({
    orgId,
    google: account?.integrations?.google,
    tba: account?.integrations?.tba,
    onshape: account?.integrations?.onshape,
    discord: account?.integrations?.discord,
    github: account?.integrations?.github,
    slack: account?.integrations?.slack,
  });
  const connectionsShell = classifyConnectionsShell({
    orgId,
    loading,
    fetchFailed,
    // Team connectors only — Google is deployment/personal, not a workspace link.
    connectors: connectionCards.filter((c) => c.id !== "google").map((c) => ({ status: c.status })),
  });
  const connectionsCopy = connectionsEmptyCopy(connectionsShell);
  const showConnectionNextActions =
    !loading &&
    !fetchFailed &&
    account != null &&
    tab === "integrations" &&
    (connectionsShell === "setup" ||
      connectionsShell === "empty" ||
      !googleReady ||
      !tbaReady ||
      onshapeStatus === "setup_required" ||
      onshapeStatus === "empty" ||
      discordStatus === "setup_required" ||
      discordStatus === "empty" ||
      slackStatus === "setup_required" ||
      slackStatus === "empty" ||
      githubStatus === "empty");
  const showNextActions =
    !loading &&
    !fetchFailed &&
    account != null &&
    tab !== "integrations" &&
    (!orgId || !hasProfile || !emailDeliveryReady || !googleReady || !tbaReady);

  return (
    <main className="module-page account-page">
      <PageHeader
        breadcrumbs="Account / Settings"
        title="Your settings"
        description="Personal profile and prefs for this login. Billing, AI usage, and team connectors follow your active workspace."
      >
        <div className="account-header-actions">
          <a className="app-button secondary" href="/whats-new">
            What’s new
          </a>
          <a className="app-button secondary" href="/support">
            Support
          </a>
        </div>
      </PageHeader>

      <SettingsBar
        role={org.role}
        orgId={org.orgId}
        pathname="/account"
        activeTab={tab === "profile" ? null : tab}
      />

      <AccountRelated orgId={orgId} />

      {message ? (
        <p className={`telemetry-status${messageOk ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      {loading ? (
        <EmptyState
          soft
          badge="Loading"
          badgeTone="setup"
          title="Loading account"
          description="Pulling your profile, workspace context, and preferences…"
          aria-busy
        />
      ) : null}

      {fetchFailed ? (
        <>
          {(() => {
            const kind = classifyLoadFailure({
              status: loadStatus,
              online: typeof navigator === "undefined" ? true : navigator.onLine,
            });
            const copy = loadFailureCopy(kind, {
              nextPath:
                typeof window === "undefined"
                  ? null
                  : `${window.location.pathname}${window.location.search}`,
              message:
                "A network or server issue prevented loading. Try again, or open Support if this keeps failing.",
            });
            return (
              <EmptyState
                soft
                badge="Unavailable"
                badgeTone="setup"
                title={copy.title}
                description={copy.description}
              >
                <div className="account-empty-actions">
                  {copy.primary ? (
                    <a className="app-button" href={copy.primary.href}>
                      {copy.primary.label}
                    </a>
                  ) : null}
                  {copy.showRetry ? (
                    <button type="button" className="app-button" onClick={() => void load()}>
                      Retry
                    </button>
                  ) : null}
                  <a className="app-button secondary" href="/support">
                    Help & Support
                  </a>
                </div>
              </EmptyState>
            );
          })()}
          <NextActions
            orgId={null}
            hasProfile={false}
            emailDeliveryReady
            googleReady
            tbaReady
          />
        </>
      ) : null}

      {!loading && !fetchFailed && account ? (
        <>
          <OrgContextCard org={org} />

          {showNextActions ? (
            <NextActions
              orgId={orgId}
              hasProfile={hasProfile}
              emailDeliveryReady={emailDeliveryReady}
              googleReady={googleReady}
              tbaReady={tbaReady}
            />
          ) : null}

          {orgId ? (
            <section className="account-ai-keys app-card soft-panel" aria-label="AI keys">
              <header>
                <span className="app-badge">Keys</span>
                <h2>AI keys</h2>
                <p>
                  Your OpenAI or Anthropic key, or an Ollama / LM Studio URL. Yours override the team for your chats.
                </p>
              </header>
              <div className="account-ai-keys-actions">
                <a className="app-button primary" href={withOrgHref("/team/ai-keys", orgId)}>
                  Open AI keys
                </a>
              </div>
            </section>
          ) : null}

          <nav className="settings-hub" aria-label="Related settings">
            <a href="/security">
              <strong>Security</strong>
              <span>Authenticator app, remembered devices</span>
            </a>
            <a href="/notifications">
              <strong>Inbox</strong>
              <span>In-app alerts for this account</span>
            </a>
            <button type="button" onClick={() => selectTab("notifications")}>
              <strong>Notification prefs</strong>
              <span>In-app alerts and email opt-ins</span>
            </button>
            <a href="/whats-new">
              <strong>What’s new</strong>
              <span>Published releases for your plan</span>
            </a>
            {orgId ? (
              <>
                <a href={withOrgHref("/team/ai-keys", orgId)}>
                  <strong>AI keys</strong>
                  <span>Yours or the team’s · OpenAI, Anthropic, Ollama</span>
                </a>
                <a href={withOrgHref("/ai?tab=budgets", orgId)}>
                  <strong>Billing</strong>
                  <span>API budgets and Usage Credits</span>
                </a>
                <a href={withOrgHref("/team/usage", orgId)}>
                  <strong>AI usage</strong>
                  <span>Live metered ledger for this team</span>
                </a>
                <a href={withOrgHref("/team/security", orgId)}>
                  <strong>Team security</strong>
                  <span>Auth policy and delegated powers</span>
                </a>
              </>
            ) : (
              <a href="/workspace">
                <strong>Workspace</strong>
                <span>Choose a team for keys, billing, and usage</span>
              </a>
            )}
          </nav>

          <TabBar
            className="account-tabs"
            aria-label="Account sections"
            value={tab}
            onChange={(id) => selectTab(id as Tab)}
            tabs={[
              { id: "profile", label: "Profile" },
              { id: "appearance", label: "Appearance" },
              { id: "notifications", label: "Notifications" },
              { id: "integrations", label: "Connections" },
            ]}
          />

          {tab === "profile" ? (
            <Panel className="account-panel">
              <div className="account-identity">
                {account.image ? (
                   
                  <img className="soft-avatar lg" src={account.image} alt="" />
                ) : (
                  <span className="soft-avatar lg">{initial}</span>
                )}
                <div>
                  <strong>{displayName || "Signed-in user"}</strong>
                  <span>{account.email ?? "—"}</span>
                  <span className="account-identity-scope">
                    {orgId
                      ? `Personal account · workspace ${formatAccountOrgLabel(org) ?? "active"}`
                      : "Personal account · no workspace selected"}
                  </span>
                </div>
              </div>
              <form className="account-form" onSubmit={(event) => void saveProfile(event)}>
                <label>
                  Display name
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    maxLength={80}
                    autoComplete="nickname"
                    required
                  />
                </label>
                <label>
                  First name
                  <input
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    maxLength={60}
                    autoComplete="given-name"
                  />
                </label>
                <label>
                  Last name
                  <input
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    maxLength={60}
                    autoComplete="family-name"
                  />
                </label>
                <label>
                  Date of birth
                  <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(event) => setDateOfBirth(event.target.value)}
                    autoComplete="bday"
                  />
                </label>
                <label>
                  Sign-in email
                  <input value={account.email ?? ""} readOnly disabled />
                </label>
                <label>
                  Recovery email
                  <input
                    type="email"
                    value={recoveryEmail}
                    onChange={(event) => setRecoveryEmail(event.target.value)}
                    autoComplete="email"
                    placeholder="A second inbox for account recovery"
                  />
                </label>
                <label>
                  Phone number for OTP
                  <input
                    type="tel"
                    value={phoneE164}
                    onChange={(event) => setPhoneE164(event.target.value)}
                    autoComplete="tel"
                    placeholder="+15551234567"
                  />
                </label>
                <p className="app-muted">
                  {account.phoneVerified
                    ? "Phone is verified for OTP."
                    : account.phoneOtp?.configured
                      ? "Save the number, then send a code to verify it."
                      : account.phoneOtp?.message ?? "SMS OTP is setup-required until Twilio env is set."}
                </p>
                <div className="account-actions">
                  <button className="app-button secondary" type="button" disabled={busy} onClick={() => void sendPhoneOtp()}>
                    Send phone code
                  </button>
                  <input
                    value={otpCode}
                    onChange={(event) => setOtpCode(event.target.value)}
                    maxLength={6}
                    inputMode="numeric"
                    placeholder="6-digit code"
                    aria-label="Phone OTP code"
                  />
                  <button className="app-button secondary" type="button" disabled={busy || otpCode.length !== 6} onClick={() => void verifyPhoneOtp()}>
                    Verify phone
                  </button>
                </div>
                <div className="account-actions">
                  <button className="primary-action" type="submit" disabled={busy}>
                    Save profile
                  </button>
                  <button className="danger-action" type="button" disabled={busy} onClick={() => void signOut()}>
                    Sign out
                  </button>
                </div>
              </form>
            </Panel>
          ) : null}

          {tab === "appearance" ? (
            <Panel className="appearance-panel account-panel">
              <AppearancePanel />
            </Panel>
          ) : null}

          {tab === "notifications" ? (
            <Panel className="account-panel">
              {account.emailDelivery?.status === "setup_required" ? (
                <EmptyState
                  soft
                  badge="Setup required"
                  badgeTone="setup"
                  title="Email delivery not configured"
                  description={account.emailDelivery.detail}
                >
                  <p className="app-muted">
                    In-app prefs still save. Opt-in email stays quiet until Resend is configured on this deployment.
                  </p>
                </EmptyState>
              ) : null}
              <h2>In-app notifications</h2>
              <p className="app-muted">
                Controls what Vantage may put in your inbox — including coach→member todos, duties, and calendar events.
                It does not invent live competition data.{" "}
                <a href="/notifications">Open inbox</a>
                {" · "}
                <a href="/notifications/preferences">Full preference center</a>
                {" · "}
                <a href="/whats-new">What’s new</a>
              </p>
              <ul className="account-prefs">
                {PREF_LABELS.map((item) => (
                  <li key={item.key}>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.detail}</small>
                    </div>
                    <label className="account-switch">
                      <span className="sr-only">{item.title}</span>
                      <input
                        type="checkbox"
                        checked={prefs[item.key]}
                        onChange={(event) => setPrefs((current) => ({ ...current, [item.key]: event.target.checked }))}
                      />
                    </label>
                  </li>
                ))}
              </ul>

              <PushDevicePanel orgId={orgId} />

              <h2 className="account-prefs-heading">Email opt-ins</h2>
              <p className="app-muted">
                Email stays off until you explicitly opt in. Auth codes and security notices are separate.{" "}
                <a href="/notifications/preferences">Open email preference center</a>
                {" · "}
                <a href="/support">Help & Support</a>
              </p>
              <ul className="account-prefs">
                {EMAIL_PREF_LABELS.map((item) => (
                  <li key={item.key}>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.detail}</small>
                    </div>
                    <label className="account-switch">
                      <span className="sr-only">{item.title}</span>
                      <input
                        type="checkbox"
                        checked={emailPrefs[item.key]}
                        onChange={(event) =>
                          setEmailPrefs((current) => ({ ...current, [item.key]: event.target.checked }))
                        }
                      />
                    </label>
                  </li>
                ))}
              </ul>
              <button className="primary-action" type="button" disabled={busy} onClick={() => void savePrefs()}>
                Save preferences
              </button>
            </Panel>
          ) : null}

          {tab === "integrations" ? (
            <section className="settings-connections" aria-label="Connections">
              <ConnectionsRelated orgId={orgId} />

              {connectionsShell === "setup" || connectionsShell === "empty" ? (
                <EmptyState
                  soft
                  badge={connectionsCopy.badge}
                  badgeTone={connectionsCopy.badgeTone}
                  title={connectionsCopy.title}
                  description={connectionsCopy.description}
                >
                  <div className="account-empty-actions">
                    {!orgId ? (
                      <a className="app-button" href="/workspace">
                        Open Workspace
                      </a>
                    ) : (
                      <a className="app-button" href={withOrgHref("/cad/connections", orgId)}>
                        Open CAD Connections
                      </a>
                    )}
                    <a
                      className="app-button secondary"
                      href={orgId ? withOrgHref("/team/discord", orgId) : "/support"}
                    >
                      {orgId ? "Open Discord" : "Help & Support"}
                    </a>
                    {orgId ? (
                      <a className="app-button secondary" href={withOrgHref("/team/slack", orgId)}>
                        Open Slack
                      </a>
                    ) : null}
                  </div>
                </EmptyState>
              ) : null}

              {showConnectionNextActions ? (
                <ConnectionsNextActions
                  orgId={orgId}
                  googleReady={googleReady}
                  tbaReady={tbaReady}
                  onshapeStatus={onshapeStatus}
                  discordStatus={discordStatus}
                  githubStatus={githubStatus}
                  slackStatus={slackStatus}
                />
              ) : null}

              <div className="admin-grid settings-connections-grid">
                {connectionCards.map((card) => (
                  <Panel as="article" key={card.id} className="settings-connection-card">
                    <div className="settings-connection-card-top">
                      <h2>{card.label}</h2>
                      <span className={`app-badge ${connectionBadgeTone(card.status)}`}>
                        {connectionBadgeLabel(card.status)}
                      </span>
                    </div>
                    <p>{card.detail}</p>
                    <a href={card.href}>{card.cta}</a>
                  </Panel>
                ))}
              </div>

              <Panel as="article" className="settings-connection-footer">
                <h2>Security, keys &amp; usage</h2>
                <p>
                  Personal 2FA lives on Security. Workspace AI keys, billing, and usage follow the active team — never
                  invented spend. Team connectors above stay empty until real links exist.
                </p>
                <div className="settings-inline-links">
                  <a href="/security">Security</a>
                  {orgId ? <a href={withOrgHref("/team/ai-keys", orgId)}>AI keys</a> : null}
                  {orgId ? <a href={withOrgHref("/ai?tab=budgets", orgId)}>Billing</a> : null}
                  {orgId ? <a href={withOrgHref("/team/usage", orgId)}>AI usage</a> : null}
                  {orgId ? <a href={withOrgHref("/cad/connections", orgId)}>CAD Connections</a> : null}
                  {orgId ? <a href={withOrgHref("/team/discord", orgId)}>Discord</a> : null}
                  <a href="/account?tab=profile">Account</a>
                  <a href="/whats-new">What’s new</a>
                  <a href="/support">Support</a>
                </div>
              </Panel>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
