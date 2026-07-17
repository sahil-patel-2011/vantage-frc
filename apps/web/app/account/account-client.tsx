"use client";

import { useEffect, useState } from "react";
import { ThemeToggle } from "../theme-provider";
import { signOutAndRedirect } from "../../lib/sign-out";

type NotificationPrefs = {
  matchAlerts: boolean;
  scoutReminders: boolean;
  syncFailures: boolean;
  productUpdates: boolean;
};

type Integration = { status: "available" | "setup_required"; detail: string };

type AccountView = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  displayName?: string | null;
  themePreference?: "light" | "dark";
  notificationPrefs?: NotificationPrefs;
  integrations?: {
    google: Integration;
    tba: Integration;
  };
};

type Tab = "profile" | "appearance" | "notifications" | "integrations";

const PREF_LABELS: { key: keyof NotificationPrefs; title: string; detail: string }[] = [
  { key: "matchAlerts", title: "Match alerts", detail: "Upcoming match reminders when live TBA data is available." },
  { key: "scoutReminders", title: "Scout reminders", detail: "Assigned scouting form nudges for your workspace." },
  { key: "syncFailures", title: "Sync failures", detail: "Notify when TBA/reference ingest health degrades." },
  { key: "productUpdates", title: "Product updates", detail: "Occasional Vantage product notes (off by default)." },
];

export default function AccountClient() {
  const [tab, setTab] = useState<Tab>("profile");
  const [account, setAccount] = useState<AccountView | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    matchAlerts: true,
    scoutReminders: true,
    syncFailures: true,
    productUpdates: false,
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
        body: JSON.stringify({ notificationPrefs: prefs }),
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
    <main className="intel-app account-page">
      <header className="intel-header">
        <div>
          <span className="eyebrow">Account</span>
          <h1>Your settings</h1>
          <p>Profile, appearance, notifications, and integration status for this signed-in session.</p>
        </div>
      </header>

      <nav className="account-tabs" aria-label="Account sections">
        {(
          [
            ["profile", "Profile"],
            ["appearance", "Appearance"],
            ["notifications", "Alerts"],
            ["integrations", "Links"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "active" : undefined}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {message ? (
        <p className={`telemetry-status${messageOk ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      {!account && !message ? (
        <section className="soft-empty" aria-busy="true">
          <span className="app-badge setup">Loading</span>
          <h2>Loading account</h2>
          <p>Pulling your profile and preferences…</p>
        </section>
      ) : null}

      {tab === "profile" && account ? (
        <section className="intel-panel account-panel">
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
        </section>
      ) : null}

      {tab === "appearance" ? (
        <section className="intel-panel appearance-panel account-panel">
          <ThemeToggle expanded />
        </section>
      ) : null}

      {tab === "notifications" ? (
        <section className="intel-panel account-panel">
          <h2>Notification preferences</h2>
          <p className="app-muted">Controls what Vantage may notify you about. It does not invent live competition data.</p>
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
          <button className="primary-action" type="button" disabled={busy} onClick={() => void savePrefs()}>
            Save preferences
          </button>
        </section>
      ) : null}

      {tab === "integrations" ? (
        <section className="admin-grid">
          <article className="intel-panel">
            <h2>Google</h2>
            <span className={`app-badge ${account?.integrations?.google.status === "available" ? "good" : "setup"}`}>
              {account?.integrations?.google.status === "available" ? "Available" : "Setup required"}
            </span>
            <p>{account?.integrations?.google.detail ?? "Checking Google configuration…"}</p>
            <a href="/signin">Open sign-in</a>
          </article>
          <article className="intel-panel">
            <h2>The Blue Alliance</h2>
            <span className={`app-badge ${account?.integrations?.tba.status === "available" ? "good" : "setup"}`}>
              {account?.integrations?.tba.status === "available" ? "Configured" : "Not configured"}
            </span>
            <p>{account?.integrations?.tba.detail ?? "Checking TBA configuration…"}</p>
            {orgId ? <a href={`/team/data?orgId=${orgId}`}>Open TBA connectors</a> : null}
          </article>
          <article className="intel-panel">
            <h2>Security</h2>
            <p>Authenticator app, remembered devices, and step-up verification live on the Security page.</p>
            <a href="/security">Open security settings</a>
          </article>
        </section>
      ) : null}
    </main>
  );
}
