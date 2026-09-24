"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../../components/ui";
import { ACCOUNT_EMAIL_COPY, studentEmailDelivery } from "../../../lib/account/account-api-related";
import { PushDevicePanel } from "../../account/account-push-panel";
import {
  DEFAULT_EMAIL_PREFS,
  DEFAULT_NOTIFICATION_PREFS,
  EMAIL_PREF_LABELS,
  PREF_LABELS,
  type EmailPrefs,
  type NotificationPrefs,
} from "../../account/account-types";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import {
  NOTIFICATION_RELATED_INCLUDE,
  notificationRelatedLinks,
} from "../../../lib/notifications";
import {
  clearFeatureSnapshot,
  getFeatureSnapshot,
  putFeatureSnapshot,
} from "../../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import "../../product-hub.css";
import "../notifications.css";

type InAppPrefs = NotificationPrefs;

type Delivery = { status: "available" | "setup_required"; detail: string };

// One list of switches for the whole app. The Account tab links here instead of
// keeping its own copy (it had Team chat and push; this page did not).
const IN_APP_PREF_LABELS = PREF_LABELS;
const DEFAULT_IN_APP: InAppPrefs = DEFAULT_NOTIFICATION_PREFS;
const DEFAULT_EMAIL: EmailPrefs = DEFAULT_EMAIL_PREFS;

/** Email really goes out only when delivery is available and not the local-only mailbox. */
function emailIsOn(delivery: Delivery | null): boolean {
  return delivery?.status === "available" && delivery.detail === ACCOUNT_EMAIL_COPY.ready;
}

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

function studentDelivery(delivery: Delivery | null): Delivery | null {
  if (!delivery) return null;
  // Already student copy (the API and the cache both store it). Re-running the
  // mapper turned "does not send email" back into "Email delivery is on".
  if ((Object.values(ACCOUNT_EMAIL_COPY) as string[]).includes(delivery.detail)) return delivery;
  return {
    status: delivery.status,
    detail: studentEmailDelivery({
      status: delivery.status,
      missingEnv: [],
      detail: delivery.detail,
    }).detail,
  };
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
      <a href="/notifications">Inbox</a>
      {links.map((link) => (
        <a key={link.href} href={link.href}>{link.label}</a>
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
    const sanitized = { ...next, delivery: studentDelivery(next.delivery) };
    setView(sanitized);
    setInAppPrefs(sanitized.notificationPrefs);
    setEmailPrefs(sanitized.emailPrefs);
    setDelivery(sanitized.delivery);
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
        try {
          await clearFeatureSnapshot("notification-prefs", "_");
        } catch {
          // Best-effort: painted board already dropped.
        }
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
      const rawDelivery = row.delivery ?? null;
      const next: PrefsView = {
        status: "live",
        notificationPrefs: { ...DEFAULT_IN_APP, ...(row.notificationPrefs ?? {}) },
        emailPrefs: { ...DEFAULT_EMAIL, ...(row.emailPrefs ?? {}) },
        delivery: studentDelivery(rawDelivery),
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
      setMessage("Saved.");
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
          description="Every notification switch in one place: your inbox, this device, and email."
        >
          <PrefsRelated />
        </PageHeader>
        <OfflineBanner feature="Notification preferences" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Loading preferences…"}
          description={failure ? failure.description : "Loading your inbox and email opt-ins."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : failure?.showRetry ? (
            <Button variant="primary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  const emailOn = emailIsOn(delivery);
  return (
    <main className="module-page notif-prefs-page notif-page">
      <PageHeader
        breadcrumbs="Account / Notifications"
        title="Notification preferences"
        description="Every notification switch in one place: your inbox, this device, and email."
      >
        <PrefsRelated />
      </PageHeader>
      <OfflineBanner feature="Notification preferences" fromCache={fromCache} cachedAt={cachedAt} />

      <Panel className="account-panel">
        <h2>Inbox</h2>
        <p className="app-muted">What shows up in your inbox. Everything starts on.</p>
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
        <PushDevicePanel orgId={null} />
      </Panel>

      <Panel className="account-panel">
        <h2>Email</h2>
        {/* Honest status in the right colour: green only when email really goes out. */}
        <p className={`notif-email-status ${emailOn ? "on" : "off"}`} role="status">
          {emailOn
            ? "Emails are on. We only send the kinds you switch on below."
            : "Emails are off on this server, so you'll still get inbox alerts but no email. Your choices below are saved for when email is turned on."}
        </p>
        <p className="app-muted">
          Each switch turns off one kind of email. Sign-in codes and security notices always arrive.
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
      </Panel>

      <div className="notif-prefs-save">
        <Button variant="primary" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
        {message ? (
          <p className={`notif-prefs-message${messageOk ? " success" : ""}`} role="status">
            {message}
          </p>
        ) : null}
      </div>
    </main>
  );
}
