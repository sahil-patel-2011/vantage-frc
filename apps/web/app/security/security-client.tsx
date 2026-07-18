"use client";

import { useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";

type Device = {
  id: string;
  label: string;
  expiresAt: string;
  lastUsedAt: string | null;
};

export default function SecurityClient({
  orgId,
  stepUp = false,
  returnTo,
}: {
  orgId?: string;
  stepUp?: boolean;
  returnTo?: string;
}) {
  const [status, setStatus] = useState<{
    enrollment: null | { confirmedAt: string | null };
    devices: Device[];
  }>({ enrollment: null, devices: [] });
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/security/mfa");
    const data = await response.json();
    if (response.ok) {
      setStatus(data);
      setMessage("");
    } else {
      setMessage(data.error ?? "Could not load security settings.");
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function action(nextAction: string, extra: Record<string, unknown> = {}) {
    const response = await fetch("/api/security/mfa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: nextAction, code, ...extra }),
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
    if (nextAction === "step-up" && returnTo) location.assign(returnTo);
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

  return (
    <main className="module-page security-page">
      <PageHeader
        breadcrumbs="Account / Security"
        title="Security"
        description="Authenticator-app 2FA and remembered devices for this signed-in account. Appearance and notification prefs live under Account."
      >
        <nav className="settings-inline-links" aria-label="Related settings">
          <a href="/account">Account</a>
          <a href="/account?tab=notifications">Notification prefs</a>
          {orgId ? <a href={`/team/security?orgId=${encodeURIComponent(orgId)}`}>Team security</a> : null}
        </nav>
      </PageHeader>

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
          <button className="primary-action" type="button" onClick={() => void action("step-up", { orgId, rememberDays: 14 })}>
            Verify and continue
          </button>
        </Panel>
      ) : null}

      {loading ? (
        <EmptyState soft title="Loading security…" description="Checking authenticator enrollment and remembered devices." aria-busy />
      ) : (
        <section className="admin-grid">
          <Panel as="article">
            <h2>Authenticator app</h2>
            <p>No SMS. Codes stay in your authenticator app; the secret is encrypted at rest.</p>
            {!status.enrollment?.confirmedAt && !setup ? (
              <button className="primary-action" type="button" onClick={() => void action("begin")}>
                Set up authenticator
              </button>
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
                <button type="button" onClick={() => void action("confirm")}>
                  Confirm setup
                </button>
              </>
            ) : null}
            {status.enrollment?.confirmedAt ? (
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
                <button type="button" onClick={() => void action("regenerate")}>
                  Regenerate recovery codes
                </button>
                <button className="danger-action" type="button" onClick={() => void revoke({ revokeAll: true })}>
                  Disable 2FA
                </button>
              </>
            ) : null}
          </Panel>
          <Panel as="article">
            <h2>Remembered devices</h2>
            {status.devices.length === 0 ? (
              <EmptyState soft title="No remembered devices" description="After step-up verification, trusted devices can appear here." />
            ) : (
              status.devices.map((device) => (
                <div className="saved-board" key={device.id}>
                  <div>
                    <strong>{device.label}</strong>
                    <small>Expires {new Date(device.expiresAt).toLocaleDateString()}</small>
                  </div>
                  <button type="button" onClick={() => void revoke({ deviceId: device.id })}>
                    Revoke
                  </button>
                </div>
              ))
            )}
          </Panel>
        </section>
      )}

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
