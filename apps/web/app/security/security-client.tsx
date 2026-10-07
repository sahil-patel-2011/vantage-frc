"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, ConfirmProvider, EmptyState, PageHeader, Panel, useConfirm } from "../../components/ui";
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
      <a href="/account">Account</a>
      <a href="/notifications/preferences">Notification prefs</a>
      {orgId ? (
        <a href={`/team/security?orgId=${encodeURIComponent(orgId)}`}>Team security</a>
      ) : null}
    </nav>
  );
}

type SecurityProps = { orgId?: string; stepUp?: boolean; returnTo?: string };

export default function SecurityClient(props: SecurityProps) {
  return <ConfirmProvider key={props.orgId ?? "account"}><SecuritySettings {...props} /></ConfirmProvider>;
}

function SecuritySettings({
  orgId,
  stepUp = false,
  returnTo,
}: SecurityProps) {
  const [view, setView] = useState<SecurityView | null>(null);
  const [setup, setSetup] = useState<{
    secret: string;
    uri: string;
    /** Absent when the barcode could not be drawn; the setup key still works. */
    qrDataUri?: string | null;
  } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const loadSequence = useRef(0);
  const mounted = useRef(false);
  const confirm = useConfirm();
  const viewRef = useRef<SecurityView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<SecurityView>("security", "_");
      if (sequence !== loadSequence.current) return;
      if (!viewRef.current && cached?.data && isSecurityView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    if (sequence !== loadSequence.current) return;
    setFetchFailed(false);
    setErrorStatus(null);
    try {
      const response = await fetch("/api/security/mfa", {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const body: unknown = await response.json().catch(() => null);
      if (sequence !== loadSequence.current) return;
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
      if (sequence !== loadSequence.current) return;
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
    mounted.current = true;
    void load();
    return () => { mounted.current = false; loadSequence.current += 1; };
  }, [load]);

  async function action(nextAction: string, extra: Record<string, unknown> = {}) {
    if (busyRef.current || fromCache) return;
    loadSequence.current += 1;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    if (nextAction === "confirm" || nextAction === "regenerate") setRecovery([]);
    try {
      const response = await fetch("/api/security/mfa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        body: JSON.stringify({ action: nextAction, ...(nextAction !== "begin" ? { code } : {}), ...extra }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (!response.ok) throw new Error(responseError(data) || "Security update failed. Try again.");
      if (!data || typeof data !== "object") throw new Error("The update was not confirmed. Refresh Security before trying again.");
      if (nextAction === "begin") {
        if (!("secret" in data) || typeof data.secret !== "string" || !("uri" in data) || typeof data.uri !== "string") throw new Error("Setup details were not received. Try again.");
        setSetup({ secret: data.secret, uri: data.uri, qrDataUri: "qrDataUri" in data && typeof data.qrDataUri === "string" ? data.qrDataUri : null });
      }
      if (nextAction === "confirm" || nextAction === "regenerate") {
        if (!("recoveryCodes" in data) || !Array.isArray(data.recoveryCodes) || !data.recoveryCodes.length || !data.recoveryCodes.every((item: unknown) => typeof item === "string")) throw new Error("Recovery codes were not received. Refresh Security, then generate new recovery codes.");
        setRecovery(data.recoveryCodes);
        if (nextAction === "confirm") setSetup(null);
      }
      setCode("");
      if (nextAction === "step-up") {
        location.assign(safeAppPath(returnTo, "/dashboard"));
        return;
      }
      await load();
      if (!mounted.current) return;
      setMessage(nextAction === "confirm" ? "Authenticator app enabled. Save the recovery codes below before continuing." : nextAction === "regenerate" ? "New recovery codes are ready. Save them now; your previous codes no longer work." : "Scan the code below to finish setup.");
    } catch (error) {
      if (!mounted.current) return;
      setMessage(error instanceof Error && error.name !== "TimeoutError" && error.name !== "TypeError" ? error.message : "The response did not arrive. Refresh Security to check the result before trying again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function revoke(body: Record<string, unknown>) {
    if (busyRef.current || fromCache) return;
    loadSequence.current += 1;
    busyRef.current = true;
    setBusy(true);
    try {
      if (!(await confirm({
        title: body.revokeAll ? "Disable authenticator verification?" : "Forget this device?",
        body: body.revokeAll ? "This removes your authenticator and recovery codes and revokes all remembered devices. Teams requiring 2FA will require setup again." : "This device will need authenticator verification the next time your team requires it.",
        confirmLabel: body.revokeAll ? "Disable 2FA" : "Forget device", tone: "destructive",
      }))) return;
      const response = await fetch("/api/security/mfa", {
        method: "DELETE", headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS), body: JSON.stringify(body),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (!response.ok) throw new Error(responseError(data) || "The change could not be saved.");
      if (!data || typeof data !== "object" || !("success" in data) || data.success !== true) throw new Error("The change was not confirmed. Refresh Security to check the result.");
      if (body.revokeAll) { setSetup(null); setRecovery([]); setCode(""); }
      await load();
      if (!mounted.current) return;
      setMessage(body.revokeAll ? "Authenticator verification is disabled and remembered devices have been revoked." : "Device forgotten.");
    } catch (error) {
      if (!mounted.current) return;
      setMessage(error instanceof Error && error.name !== "TimeoutError" && error.name !== "TypeError" ? error.message : "The response did not arrive. Refresh Security to check the result.");
    } finally {
      busyRef.current = false;
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
      <main className="module-page security-page">
        <PageHeader
          breadcrumbs="Account / Security"
          title="Security"
          description="A second sign-in step with an app like Google Authenticator, and the devices you told us to remember."
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
            description="A second sign-in step with an app like Google Authenticator, and the devices you told us to remember. Appearance and notifications are under Account."
          >
            <SecurityRelated orgId={orgId} />
            <Button type="button" variant="secondary" disabled={busy} onClick={() => { if (!busyRef.current) void load(); }}>Refresh security</Button>
          </PageHeader>
          <OfflineBanner feature="Security" fromCache={fromCache} cachedAt={cachedAt} force={fromCache} variant="degraded" detail={fromCache ? "Showing a saved copy. Refresh Security to verify the current settings before making changes." : undefined} />
          {busy || message ? (
            <p role="status" className="telemetry-status">
              {busy ? "Updating security…" : message}
            </p>
          ) : null}
          {stepUp && orgId && view.enrollment?.confirmedAt && !recovery.length ? (
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
                  disabled={busy || fromCache}
                  onChange={(event) => setCode(event.target.value.replace(/[^0-9A-F-]/gi, ""))}
                />
              </label>
              <Button
                variant="primary"
                type="button"
                disabled={busy || fromCache || !code.trim()}
                onClick={() => void action("step-up", { orgId, rememberDays: 14 })}
              >
                Verify and continue
              </Button>
            </Panel>
          ) : null}
          <section className="admin-grid">
            <Panel as="article">
              <h2>Authenticator app</h2>
              <p>No text messages. The codes come from the app on your phone, and Vantage keeps the setup key locked away.</p>
              {!view.enrollment?.confirmedAt && !setup ? (
                <Button variant="primary" type="button" disabled={busy || fromCache} onClick={() => void action("begin")}>
                  Set up authenticator
                </Button>
              ) : null}
              {setup ? (
                <>
                  {/* Scanning is the path nearly everyone takes: open Microsoft
                      Authenticator, add a work account, point the phone at the
                      screen. Typing a thirty-two character secret on a phone
                      keyboard is the fallback, so it sits below and folded away. */}
                  {setup.qrDataUri ? (
                    <div className="mfa-qr">
                      {/* A data URI, not a served asset, so next/image has
                          nothing to optimise here. */}
                      <img
                        src={setup.qrDataUri}
                        alt="QR code for adding this account to your authenticator app"
                        width={240}
                        height={240}
                      />
                      <p>
                        In <strong>Microsoft Authenticator</strong>, tap <strong>+</strong> →{" "}
                        <strong>Work or school account</strong> → <strong>Scan a QR code</strong>,
                        then point your phone at this. Google Authenticator, 1Password and Authy
                        read the same code.
                      </p>
                    </div>
                  ) : null}
                  <details className="mfa-manual">
                    <summary data-disclosure>
                      {setup.qrDataUri ? "Can’t scan it? Enter the key by hand" : "Enter the key by hand"}
                    </summary>
                    <label>
                      Setup key
                      <output className="secret-output">{setup.secret}</output>
                    </label>
                    <p className="app-muted">
                      Choose “Enter code manually” in your authenticator app and paste this. The
                      account name is your email; the issuer is Vantage.
                    </p>
                  </details>
                  <p>Then enter the six-digit code your app shows.</p>
                  <label>
                    6-digit code
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      disabled={busy || fromCache}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                    />
                  </label>
                  <Button variant="primary" type="button" disabled={busy || fromCache || code.length !== 6} onClick={() => void action("confirm")}>
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
                      disabled={busy || fromCache}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                    />
                  </label>
                  <Button variant="secondary" type="button" disabled={busy || fromCache || code.length !== 6} onClick={() => void action("regenerate")}>
                    Regenerate recovery codes
                  </Button>
                  <Button variant="secondary" type="button" disabled={busy || fromCache} onClick={() => void revoke({ revokeAll: true })}>
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
                  description="Devices you told us to remember show up here."
                />
              ) : (
                view.devices.map((device) => (
                  <div className="saved-board" key={device.id}>
                    <div>
                      <strong>{device.label}</strong>
                      <small>Expires {new Date(device.expiresAt).toLocaleDateString()}</small>
                    </div>
                    <Button variant="secondary" type="button" disabled={busy || fromCache} onClick={() => void revoke({ deviceId: device.id })}>
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
              {stepUp && orgId ? <Button type="button" variant="primary" disabled={busy} onClick={() => setRecovery([])}>I saved my codes — continue</Button> : null}
            </Panel>
          ) : null}
        </main>
      );
}
