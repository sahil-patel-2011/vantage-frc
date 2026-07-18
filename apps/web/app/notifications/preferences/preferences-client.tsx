"use client";

import { useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../../components/ui";

type InAppPrefs = {
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

type Delivery = { status: "available" | "setup_required"; detail: string };

const IN_APP_PREF_LABELS: { key: keyof InAppPrefs; title: string; detail: string }[] = [
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
  {
    key: "matchAlerts",
    title: "Match alerts",
    detail: "Upcoming match reminders when live TBA data is available.",
  },
  {
    key: "scoutReminders",
    title: "Scout reminders",
    detail: "Assigned scouting form nudges for your workspace.",
  },
  {
    key: "syncFailures",
    title: "Sync failures",
    detail: "Notify when TBA/reference ingest health degrades.",
  },
  {
    key: "productUpdates",
    title: "In-app product notes",
    detail: "Occasional Vantage product notes in the inbox (off by default).",
  },
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

const DEFAULT_IN_APP: InAppPrefs = {
  matchAlerts: true,
  scoutReminders: true,
  syncFailures: true,
  productUpdates: false,
  todoAssigned: true,
  todoCompleted: true,
  dutyAssigned: true,
  calendarEvents: true,
};

const DEFAULT_EMAIL: EmailPrefs = {
  productUpdates: false,
  coachAssignments: false,
  coachTodos: false,
  coachPracticeReminders: false,
};

export default function NotificationPreferencesClient() {
  const [inAppPrefs, setInAppPrefs] = useState<InAppPrefs>(DEFAULT_IN_APP);
  const [emailPrefs, setEmailPrefs] = useState<EmailPrefs>(DEFAULT_EMAIL);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/notifications/preferences");
    const data = (await response.json()) as {
      error?: string;
      notificationPrefs?: InAppPrefs;
      emailPrefs?: EmailPrefs;
      delivery?: Delivery;
    };
    if (!response.ok) {
      setMessage(data.error ?? "Could not load preferences.");
      setMessageOk(false);
      setLoading(false);
      return;
    }
    if (data.notificationPrefs) setInAppPrefs(data.notificationPrefs);
    if (data.emailPrefs) setEmailPrefs(data.emailPrefs);
    if (data.delivery) setDelivery(data.delivery);
    setMessage("");
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setBusy(true);
    setMessage("");
    setMessageOk(false);
    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationPrefs: inAppPrefs, emailPrefs }),
      });
      const data = (await response.json()) as {
        error?: string;
        delivery?: Delivery;
        notificationPrefs?: InAppPrefs;
        emailPrefs?: EmailPrefs;
      };
      if (!response.ok) {
        setMessage(data.error ?? "Could not save preferences.");
        return;
      }
      if (data.notificationPrefs) setInAppPrefs(data.notificationPrefs);
      if (data.emailPrefs) setEmailPrefs(data.emailPrefs);
      if (data.delivery) setDelivery(data.delivery);
      setMessage("Preferences saved. Opted-out categories stay out of your inbox and email.");
      setMessageOk(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="module-page notif-prefs-page">
      <PageHeader
        breadcrumbs="Account / Notifications"
        title="Notification preferences"
        description="Choose which coach→member events land in your inbox, plus optional email opt-ins. Auth codes and security notices are separate."
      >
        <a className="app-button secondary" href="/notifications">
          Open inbox
        </a>
        <a className="app-button secondary" href="/account?tab=notifications">
          Account settings
        </a>
      </PageHeader>

      {delivery ? (
        <p className="telemetry-status" role="status">
          <span className={`app-badge ${delivery.status === "available" ? "good" : "setup"}`}>
            {delivery.status === "available" ? "Email ready" : "Setup required"}
          </span>{" "}
          {delivery.detail}
        </p>
      ) : null}

      {message ? (
        <p className={`telemetry-status${messageOk ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      {loading ? (
        <EmptyState soft title="Loading preferences…" description="Pulling your inbox and email opt-ins." aria-busy />
      ) : (
        <>
          <Panel className="account-panel">
            <h2>In-app inbox</h2>
            <p className="app-muted">
              Controls what Vantage may put in{" "}
              <a href="/notifications">your notifications inbox</a>. Team todos, duties, and calendar alerts default
              on so assignments are not missed — turn off any category you do not want.
            </p>
            <ul className="account-prefs">
              {IN_APP_PREF_LABELS.map((item) => (
                <li key={item.key}>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </div>
                  <label className="account-switch">
                    <span className="sr-only">{item.title}</span>
                    <input
                      type="checkbox"
                      checked={inAppPrefs[item.key]}
                      onChange={(event) =>
                        setInAppPrefs((current) => ({ ...current, [item.key]: event.target.checked }))
                      }
                    />
                  </label>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel className="account-panel">
            <h2>Email opt-ins</h2>
            <p className="app-muted">
              Every email category starts off. Unsubscribe links are included in every opt-in message.
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
            <button className="primary-action" type="button" disabled={busy} onClick={() => void save()}>
              Save preferences
            </button>
          </Panel>
        </>
      )}
    </main>
  );
}
