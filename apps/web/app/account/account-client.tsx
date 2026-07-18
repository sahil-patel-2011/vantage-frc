"use client";

import { useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel, TabBar } from "../../components/ui";
import { ThemeToggle } from "../theme-provider";
import { signOutAndRedirect } from "../../lib/sign-out";

type NotificationPrefs = {
  matchAlerts: boolean;
  scoutReminders: boolean;
  syncFailures: boolean;
  productUpdates: boolean;
  todoAssigned: boolean;
  todoCompleted: boolean;
  dutyAssigned: boolean;
  calendarEvents: boolean;
};

type EmailPrefs = {
  productUpdates: boolean;
  coachAssignments: boolean;
  coachTodos: boolean;
  coachPracticeReminders: boolean;
};

type Integration = { status: "available" | "setup_required"; detail: string };

type AccountView = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  displayName?: string | null;
  themePreference?: "light" | "dark";
  notificationPrefs?: NotificationPrefs;
  emailPrefs?: EmailPrefs;
  integrations?: {
    google: Integration;
    tba: Integration;
  };
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
  { key: "productUpdates", title: "In-app product notes", detail: "Occasional Vantage product notes in the inbox (off by default)." },
];

const EMAIL_PREF_LABELS: { key: keyof EmailPrefs; title: string; detail: string }[] = [
  {
    key: "productUpdates",
    title: "Product updates / changelog",
    detail: "Occasional Vantage product notes by email. Off until you opt in.",
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
];

function withOrg(href: string, orgId: string | null) {
  if (!orgId) return href;
  const join = href.includes("?") ? "&" : "?";
  return `${href}${join}orgId=${encodeURIComponent(orgId)}`;
}

export default function AccountClient() {
  const [tab, setTab] = useState<Tab>("profile");
  const [account, setAccount] = useState<AccountView | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    matchAlerts: true,
    scoutReminders: true,
    syncFailures: true,
    productUpdates: false,
    todoAssigned: true,
    todoCompleted: true,
    dutyAssigned: true,
    calendarEvents: true,
  });
  const [emailPrefs, setEmailPrefs] = useState<EmailPrefs>({
    productUpdates: false,
    coachAssignments: false,
    coachTodos: false,
    coachPracticeReminders: false,
  });
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);

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

  async function load() {
    const response = await fetch("/api/account");
    if (!response.ok) {
      setMessage("Could not load account settings.");
      setMessageOk(false);
      return;
    }
    const data = (await response.json()) as AccountView;
    setAccount(data);
    setDisplayName(data.displayName ?? data.name ?? "");
    if (data.notificationPrefs) setPrefs(data.notificationPrefs);
    if (data.emailPrefs) setEmailPrefs(data.emailPrefs);
    const meResponse = await fetch("/api/me");
    if (meResponse.ok) {
      const me = await meResponse.json();
      setOrgId(me.orgId ?? null);
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
        body: JSON.stringify({ displayName }),
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

  async function signOut() {
    setBusy(true);
    await signOutAndRedirect("/");
  }

  const initial = (displayName.trim()?.[0] ?? account?.email?.trim()?.[0] ?? "V").toUpperCase();

  return (
    <main className="module-page account-page">
      <PageHeader
        breadcrumbs="Account / Settings"
        title="Your settings"
        description="Profile, appearance, notification preferences, email opt-ins, and where security and API keys live."
      />

      <nav className="settings-hub" aria-label="Related settings">
        <a href="/security">
          <strong>Security</strong>
          <span>Authenticator app, remembered devices</span>
        </a>
        <a href="/notifications">
          <strong>Inbox</strong>
          <span>In-app alerts for this account</span>
        </a>
        <button type="button" onClick={() => setTab("notifications")}>
          <strong>Notification prefs</strong>
          <span>In-app alerts and email opt-ins</span>
        </button>
        {orgId ? (
          <>
            <a href={withOrg("/team/security", orgId)}>
              <strong>Team security</strong>
              <span>Auth policy and delegated powers</span>
            </a>
            <a href={withOrg("/team", orgId)}>
              <strong>API keys</strong>
              <span>BYOK providers and connectors</span>
            </a>
            <a href={withOrg("/team/budgets", orgId)}>
              <strong>API budgets</strong>
              <span>Hard spend and token limits</span>
            </a>
          </>
        ) : null}
      </nav>

      <TabBar
        className="account-tabs"
        aria-label="Account sections"
        value={tab}
        onChange={(id) => setTab(id as Tab)}
        tabs={[
          { id: "profile", label: "Profile" },
          { id: "appearance", label: "Appearance" },
          { id: "notifications", label: "Notifications" },
          { id: "integrations", label: "Connections" },
        ]}
      />

      {message ? (
        <p className={`telemetry-status${messageOk ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      {!account && !message ? (
        <EmptyState
          soft
          badge="Loading"
          badgeTone="setup"
          title="Loading account"
          description="Pulling your profile and preferences…"
          aria-busy
        />
      ) : null}

      {tab === "profile" && account ? (
        <Panel className="account-panel">
          <div className="account-identity">
            {account.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="soft-avatar lg" src={account.image} alt="" />
            ) : (
              <span className="soft-avatar lg">{initial}</span>
            )}
            <div>
              <strong>{displayName || "Signed-in user"}</strong>
              <span>{account.email ?? "—"}</span>
            </div>
          </div>
          <form className="account-form" onSubmit={(event) => void saveProfile(event)}>
            <label>
              Display name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={80}
                autoComplete="name"
                required
              />
            </label>
            <label>
              Email
              <input value={account.email ?? ""} readOnly disabled />
            </label>
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
          <ThemeToggle expanded />
        </Panel>
      ) : null}

      {tab === "notifications" ? (
        <Panel className="account-panel">
          <h2>In-app notifications</h2>
          <p className="app-muted">
            Controls what Vantage may put in your inbox — including coach→member todos, duties, and calendar events.
            It does not invent live competition data.{" "}
            <a href="/notifications">Open inbox</a>
            {" · "}
            <a href="/notifications/preferences">Full preference center</a>
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

          <h2 className="account-prefs-heading">Email opt-ins</h2>
          <p className="app-muted">
            Email stays off until you explicitly opt in. Auth codes and security notices are separate.{" "}
            <a href="/notifications/preferences">Open email preference center</a>
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
        <section className="admin-grid settings-connections">
          <Panel as="article">
            <h2>Google</h2>
            <span className={`app-badge ${account?.integrations?.google.status === "available" ? "good" : "setup"}`}>
              {account?.integrations?.google.status === "available" ? "Available" : "Setup required"}
            </span>
            <p>{account?.integrations?.google.detail ?? "Checking Google configuration…"}</p>
            <a href="/signin">Open sign-in</a>
          </Panel>
          <Panel as="article">
            <h2>The Blue Alliance</h2>
            <span className={`app-badge ${account?.integrations?.tba.status === "available" ? "good" : "setup"}`}>
              {account?.integrations?.tba.status === "available" ? "Configured" : "Not configured"}
            </span>
            <p>{account?.integrations?.tba.detail ?? "Checking TBA configuration…"}</p>
            {orgId ? <a href={withOrg("/team/data", orgId)}>Open TBA connectors</a> : null}
          </Panel>
          <Panel as="article">
            <h2>Security &amp; API keys</h2>
            <p>Personal 2FA lives on Security. Team API keys, BYOK providers, and budgets live under Team admin.</p>
            <div className="settings-inline-links">
              <a href="/security">Security</a>
              {orgId ? <a href={withOrg("/team", orgId)}>Team API keys</a> : null}
              {orgId ? <a href={withOrg("/team/budgets", orgId)}>API budgets</a> : null}
            </div>
          </Panel>
        </section>
      ) : null}
    </main>
  );
}
