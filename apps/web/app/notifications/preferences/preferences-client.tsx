"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import {
  NOTIFICATION_RELATED_INCLUDE,
  notificationRelatedLinks,
} from "../../../lib/notifications";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import "../../product-hub.css";
import "../notifications.css";

type InAppPrefs = {
  matchAlerts: boolean;
  scoutReminders: boolean;
  syncFailures: boolean;
  productUpdates: boolean;
  todoAssigned: boolean;
  todoCompleted: boolean;
  dutyAssigned: boolean;
  calendarEvents: boolean;
  sponsorReminders: boolean;
};

type EmailPrefs = {
  productUpdates: boolean;
  coachAssignments: boolean;
  coachTodos: boolean;
  coachPracticeReminders: boolean;
  sponsorReminders: boolean;
  performanceDigest: boolean;
  announcements: boolean;
  duesReminders: boolean;
  memberOnboarding: boolean;
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
    detail: "Assigned scouting form nudges for your team.",
  },
  {
    key: "syncFailures",
    title: "Sync failures",
    detail: "Notify when TBA/reference ingest health degrades.",
  },
  {
    key: "productUpdates",
    title: "In-app product notes",
    detail: "Release notes and product updates in the inbox (on by default).",
  },
  {
    key: "sponsorReminders",
    title: "Sponsor CRM reminders",
    detail: "Thank-you, renewal, and overdue follow-up nudges for your team's sponsors.",
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
  {
    key: "performanceDigest",
    title: "Daily performance digest",
    detail:
      "One email on days your team has real data — match results, tomorrow's schedule, and grounded pointers. On by default; sends nothing on quiet days.",
  },
  {
    key: "announcements",
    title: "Urgent team announcements",
    detail:
      "Email only for announcements your team marks urgent or asks everyone to acknowledge — departure times, safety notices, deadlines. Every announcement still reaches your inbox. On by default.",
  },
  {
    key: "duesReminders",
    title: "Dues reminders",
    detail:
      "Email when your treasurer sends a reminder and your own answer says dues are outstanding. Never sent to anyone whose answer asked for financial assistance. On by default.",
  },
  {
    key: "memberOnboarding",
    title: "New member onboarding",
    detail:
      "A short sequence after you join a team, and only when you actually have something outstanding — a form to fill in, an announcement to acknowledge, a profile to finish. On by default.",
  },
];

const DEFAULT_IN_APP: InAppPrefs = {
  matchAlerts: true,
  scoutReminders: true,
  syncFailures: true,
  productUpdates: true,
  todoAssigned: true,
  todoCompleted: true,
  dutyAssigned: true,
  calendarEvents: true,
  sponsorReminders: true,
};

const DEFAULT_EMAIL: EmailPrefs = {
  productUpdates: true,
  coachAssignments: false,
  coachTodos: false,
  coachPracticeReminders: false,
  sponsorReminders: false,
  performanceDigest: true,
  announcements: true,
  duesReminders: true,
  memberOnboarding: true,
};

type PrefsView = {
  status: "live";
  notificationPrefs: InAppPrefs;
  emailPrefs: EmailPrefs;
  delivery: Delivery | null;
};

function isPrefsView(value: unknown): value is PrefsView {
  if (!value || typeof value !== "object") return false;
  const row = value as { status?: unknown; notificationPrefs?: unknown; emailPrefs?: unknown };
  return row.status === "live" && row.notificationPrefs != null && row.emailPrefs != null;
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

async function persistPrefsSnapshot(data: PrefsView): Promise<void> {
  try {
    await putFeatureSnapshot("notification-prefs", "_", data);
  } catch {
    // Live Notification preferences already painted; IndexedDB is best-effort.
  }
}

function PrefsRelated() {
  const links = notificationRelatedLinks({
    include: [...NOTIFICATION_RELATED_INCLUDE],
    active: "preferences",
  });
  return (
    <nav className="product-hub-related notif-related" aria-label="Related account tools">
      <Button as="a" variant="secondary" href="/notifications">
        Inbox
      </Button>
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

export default function NotificationPreferencesClient() {
  const [view, setView] = useState<PrefsView | null>(null);
  const [inAppPrefs, setInAppPrefs] = useState<InAppPrefs>(DEFAULT_IN_APP);
  const [emailPrefs, setEmailPrefs] = useState<EmailPrefs>(DEFAULT_EMAIL);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<PrefsView | null>(null);
  viewRef.current = view;

  const applyView = useCallback((next: PrefsView) => {
    setView(next);
    setInAppPrefs(next.notificationPrefs);
    setEmailPrefs(next.emailPrefs);
    setDelivery(next.delivery);
  }, []);

  const load = useCallback(async () => {
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<PrefsView>("notification-prefs", "_");
      if (!viewRef.current && cached?.data && isPrefsView(cached.data)) {
        applyView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setErrorStatus(null);
    try {
      const response = await fetch("/api/notifications/preferences", {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setMessage(responseError(body) || "Could not load preferences.");
        setMessageOk(false);
        return;
      }
      if (!response.ok || !body || typeof body !== "object") {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Notification preferences. Showing the last copy on this device.");
          setMessageOk(false);
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setMessage(responseError(body) || "Could not load preferences.");
        setMessageOk(false);
        return;
      }
      const row = body as {
        notificationPrefs?: InAppPrefs;
        emailPrefs?: EmailPrefs;
        delivery?: Delivery;
      };
      const next: PrefsView = {
        status: "live",
        notificationPrefs: row.notificationPrefs ?? DEFAULT_IN_APP,
        emailPrefs: row.emailPrefs ?? DEFAULT_EMAIL,
        delivery: row.delivery ?? null,
      };
      applyView(next);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistPrefsSnapshot(next);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Notification preferences. Showing the last copy on this device.");
        setMessageOk(false);
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
      setMessage("Could not load preferences.");
      setMessageOk(false);
    }
  }, [applyView]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setMessage("");
    setMessageOk(false);
    try {
      // `/api/account` is the single writer for notification_prefs — this page only reads
      // from `/api/notifications/preferences`. It returns no delivery status, so the badge
      // stays as loaded (it reflects deployment email config, not the saved prefs).
      const response = await fetch("/api/account", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationPrefs: inAppPrefs, emailPrefs }),
      });
      const data = (await response.json()) as {
        error?: string;
        notificationPrefs?: InAppPrefs;
        emailPrefs?: EmailPrefs;
      };
      if (!response.ok) {
        setMessage(data.error ?? "Could not save preferences.");
        return;
      }
      if (data.notificationPrefs) setInAppPrefs(data.notificationPrefs);
      if (data.emailPrefs) setEmailPrefs(data.emailPrefs);
      const next: PrefsView = {
        status: "live",
        notificationPrefs: data.notificationPrefs ?? inAppPrefs,
        emailPrefs: data.emailPrefs ?? emailPrefs,
        delivery,
      };
      setView(next);
      setFromCache(false);
      await persistPrefsSnapshot(next);
      setMessage("Preferences saved. Opted-out categories stay out of your inbox and email.");
      setMessageOk(true);
    } finally {
      setBusy(false);
    }
  }

  const failure =
    !view && fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message,
          },
        )
      : null;

  if (!view) {
    return (
      <main className="module-page notif-prefs-page notif-page">
        <PageHeader
          breadcrumbs="Account / Notifications"
          title="Notification preferences"
          description="Choose which events land in your inbox, plus optional email opt-ins."
        >
          <PrefsRelated />
        </PageHeader>
        <OfflineBanner feature="Notification preferences" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Loading preferences…"}
          description={failure ? failure.description : "Pulling your inbox and email opt-ins."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "live":
      return (
        <main className="module-page notif-prefs-page notif-page">
          <PageHeader
            breadcrumbs="Account / Notifications"
            title="Notification preferences"
            description="Choose which events land in your inbox, plus optional email opt-ins."
          >
            <PrefsRelated />
          </PageHeader>
          <OfflineBanner feature="Notification preferences" fromCache={fromCache} cachedAt={cachedAt} />

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
              Each switch turns off exactly one kind of message and nothing else — opting out of dues
              reminders does not stop urgent announcements, and the other way round. The coach and sponsor
              categories start off; the rest start on. Every message carries its own unsubscribe link.
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
            <Button variant="primary" type="button" disabled={busy} onClick={() => void save()}>
              Save preferences
            </Button>
          </Panel>
        </main>
      );
    default: {
      const _never: never = view;
      return _never;
    }
  }
}
