"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, PageHeader, Panel } from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { safeAppPath } from "../../lib/security/safe-navigation";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Device = {
  id: string;
  label: string;
  expiresAt: string;
  lastUsedAt: string | null;
};

type SecurityView = {
  status: "live";
  enrollment: null | { confirmedAt: string | null };
  devices: Device[];
};

function isSecurityView(value: unknown): value is SecurityView {
  if (!value || typeof value !== "object") return false;
  const row = value as { status?: unknown; devices?: unknown };
  return row.status === "live" && Array.isArray(row.devices);
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

async function persistSecuritySnapshot(data: SecurityView): Promise<void> {
  try {
    await putFeatureSnapshot("security", "_", data);
  } catch {
    // Live Security already painted; IndexedDB is best-effort.
  }
}

function SecurityRelated({ orgId }: { orgId?: string }) {
  return (
    <nav className="product-hub-related" aria-label="Related settings">
      <Button as="a" variant="secondary" href="/account">
        Account
      </Button>
      <Button as="a" variant="secondary" href="/notifications/preferences">
        Notification prefs
      </Button>
      {orgId ? (
        <Button as="a" variant="secondary" href={`/team/security?orgId=${encodeURIComponent(orgId)}`}>
          Team security
        </Button>
      ) : null}
    </nav>
  );
}

export default function SecurityClient({
  orgId,
  stepUp = false,
  returnTo,
}: {
  orgId?: string;
  stepUp?: boolean;
  returnTo?: string;
}) {
  const [view, setView] = useState<SecurityView | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<SecurityView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<SecurityView>("security", "_");
      if (!viewRef.current && cached?.data && isSecurityView(cached.data)) {
        setView(cached.data);
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
      const response = await fetch("/api/security/mfa", {
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
        setMessage(responseError(body) || "Could not load security settings.");
        return;
      }
      if (!response.ok || !body || typeof body !== "object") {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Security. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setMessage(responseError(body) || "Could not load security settings.");
        return;
      }
      const next: SecurityView = {
        status: "live",
        enrollment: (body as { enrollment?: SecurityView["enrollment"] }).enrollment ?? null,
        devices: Array.isArray((body as { devices?: unknown }).devices)
          ? ((body as { devices: Device[] }).devices)
          : [],
      };
      setView(next);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistSecuritySnapshot(next);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Security. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
      setMessage("Could not load security settings.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(nextAction: string, extra: Record<string, unknown> = {}) {
    const response = await fetch("/api/security/mfa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: nextAction, ...(code ? { code } : {}), ...extra }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Security update failed.");
      return;
    }
    if (nextAction === "begin") setSetup(data);
    if (data.recoveryCodes) setRecovery(data.recoveryCodes);
    setMessage(
      nextAction === "confirm"
        ? "Authenticator app enabled. Save the recovery codes now."
        : "Security settings updated.",
    );
    setCode("");
    await load();
    if (nextAction === "step-up") location.assign(safeAppPath(returnTo, "/workspace"));
  }

  async function revoke(body: Record<string, unknown>) {
    if (
      !confirm(
        body.revokeAll
          ? "Disable 2FA and revoke remembered devices?"
          : "Revoke this remembered device?",
      )
    ) {
      return;
    }
    await fetch("/api/security/mfa", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
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
      <main className="module-page security-page">
        <PageHeader
          breadcrumbs="Account / Security"
          title="Security"
          description="Authenticator-app 2FA and remembered devices for this signed-in account."
        >
          <SecurityRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="Security" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Loading security…"}
          description={failure ? failure.description : "Checking authenticator enrollment and remembered devices."}
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

  return (
        <main className="module-page security-page">
          <PageHeader
            breadcrumbs="Account / Security"
            title="Security"
            description="Authenticator-app 2FA and remembered devices for this signed-in account. Appearance and notification prefs live under Account."
          >
            <SecurityRelated orgId={orgId} />
          </PageHeader>
          <OfflineBanner feature="Security" fromCache={fromCache} cachedAt={cachedAt} />
          {message ? (
            <p role="status" className="telemetry-status">
              {message}
            </p>
          ) : null}
          {stepUp && orgId ? (
            <Panel className="step-up-card">
              <h2>Verify for this organization</h2>
              <p>
                This team has a stricter 2FA policy. Enter a current authenticator code or an unused recovery code. Other
                organizations keep their own policies.
              </p>
              <label>
                Verification code
                <input
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/[^0-9A-F-]/gi, ""))}
                />
              </label>
              <Button
                variant="primary"
                type="button"
                onClick={() => void action("step-up", { orgId, rememberDays: 14 })}
              >
                Verify and continue
              </Button>
            </Panel>
          ) : null}
          <section className="admin-grid">
            <Panel as="article">
              <h2>Authenticator app</h2>
              <p>No SMS. Codes stay in your authenticator app; the secret is encrypted at rest.</p>
              {!view.enrollment?.confirmedAt && !setup ? (
                <Button variant="primary" type="button" onClick={() => void action("begin")}>
                  Set up authenticator
                </Button>
              ) : null}
              {setup ? (
                <>
                  <label>
                    Setup key
                    <output className="secret-output">{setup.secret}</output>
                  </label>
                  <p>Add this key or URI to your authenticator app, then confirm a current code.</p>
                  <label>
                    6-digit code
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                    />
                  </label>
                  <Button variant="primary" type="button" onClick={() => void action("confirm")}>
                    Confirm setup
                  </Button>
                </>
              ) : null}
              {view.enrollment?.confirmedAt ? (
                <>
                  <strong className="status-good">2FA enabled</strong>
                  <label>
                    Current authenticator code
                    <input
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                    />
                  </label>
                  <Button variant="secondary" type="button" onClick={() => void action("regenerate")}>
                    Regenerate recovery codes
                  </Button>
                  <Button variant="secondary" type="button" onClick={() => void revoke({ revokeAll: true })}>
                    Disable 2FA
                  </Button>
                </>
              ) : null}
            </Panel>
            <Panel as="article">
              <h2>Remembered devices</h2>
              {view.devices.length === 0 ? (
                <EmptyState
                  soft
                  title="No remembered devices"
                  description="After step-up verification, trusted devices can appear here."
                />
              ) : (
                view.devices.map((device) => (
                  <div className="saved-board" key={device.id}>
                    <div>
                      <strong>{device.label}</strong>
                      <small>Expires {new Date(device.expiresAt).toLocaleDateString()}</small>
                    </div>
                    <Button variant="secondary" type="button" onClick={() => void revoke({ deviceId: device.id })}>
                      Revoke
                    </Button>
                  </div>
                ))
              )}
            </Panel>
          </section>
          {recovery.length > 0 ? (
            <Panel className="recovery-codes">
              <h2>One-time recovery codes</h2>
              <p>
                Store these offline. Vantage stores only their hashes; each code works once and will not be shown again.
              </p>
              <div>
                {recovery.map((item) => (
                  <code key={item}>{item}</code>
                ))}
              </div>
            </Panel>
          ) : null}
        </main>
      );
}
