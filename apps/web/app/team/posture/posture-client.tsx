"use client";

import { useEffect, useState } from "react";

type AuthPolicy = {
  allowPassword: boolean;
  allowGoogle: boolean;
  allowEmailOtp: boolean;
  mfaPolicy: "off" | "optional" | "required";
  rememberedDeviceDays: number;
  isDefault?: boolean;
};

type Posture = {
  roleCounts: Record<string, number>;
  adminCount: number;
  memberCount: number;
  authPolicy: AuthPolicy;
  pendingInvites: number;
  delegatedMembers: number;
  blockedRequests7d: number;
  authChanges30d: number;
};

type Advisory = { level: "warn" | "info"; text: string; href?: string; hrefLabel?: string };

function advisories(posture: Posture, orgId: string): Advisory[] {
  const list: Advisory[] = [];
  const { authPolicy: policy } = posture;
  if (policy.isDefault) {
    list.push({
      level: "info",
      text: "No authentication policy has been set — the platform defaults apply.",
      href: `/team/security?orgId=${orgId}`,
      hrefLabel: "Set access policy",
    });
  }
  if (policy.mfaPolicy !== "required") {
    list.push({
      level: "warn",
      text: `Authenticator 2FA is ${policy.mfaPolicy}. Requiring it for org access is the strongest control.`,
      href: `/team/security?orgId=${orgId}`,
      hrefLabel: "Review access policy",
    });
  }
  if (posture.adminCount < 2) {
    list.push({
      level: "warn",
      text: "Only one owner/admin. Add a backup admin so access isn't lost if that account is unavailable.",
      href: `/team?orgId=${orgId}`,
      hrefLabel: "Manage members",
    });
  }
  if (policy.allowPassword) {
    list.push({
      level: "info",
      text: "Password sign-in is enabled. Passkey-style OTP and Google are lower-maintenance if you don't need it.",
    });
  }
  if (policy.rememberedDeviceDays > 30) {
    list.push({
      level: "info",
      text: `Remembered 2FA devices last ${policy.rememberedDeviceDays} days — a shorter window re-verifies more often.`,
    });
  }
  if (posture.pendingInvites > 0) {
    list.push({
      level: "info",
      text: `${posture.pendingInvites} invitation${posture.pendingInvites === 1 ? "" : "s"} still pending. Revoke any you no longer expect to be accepted.`,
      href: `/team?orgId=${orgId}`,
      hrefLabel: "Invitation ledger",
    });
  }
  if (posture.blockedRequests7d > 0) {
    list.push({
      level: "info",
      text: `${posture.blockedRequests7d} AI request${posture.blockedRequests7d === 1 ? "" : "s"} blocked by policy in the last 7 days.`,
      href: `/team/usage?orgId=${orgId}`,
      hrefLabel: "Blocked requests",
    });
  }
  return list;
}

const methodSummary = (policy: AuthPolicy) =>
  [policy.allowEmailOtp && "Email code", policy.allowGoogle && "Google", policy.allowPassword && "Password"]
    .filter(Boolean)
    .join(", ") || "None";

export default function PostureClient({ orgId }: { orgId: string }) {
  const [posture, setPosture] = useState<Posture | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const response = await fetch(`/api/organizations/security-posture?orgId=${orgId}`);
      const data = await response.json();
      if (!active) return;
      if (!response.ok) setMessage(data.error ?? "Unable to load security posture");
      else {
        setMessage("");
        setPosture(data);
      }
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, [orgId]);

  const items = posture ? advisories(posture, orgId) : [];

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / SECURITY POSTURE</span>
          <h1>This team&apos;s access at a glance</h1>
          <p className="app-muted">
            A read-only roll-up of the controls protecting this workspace, with suggestions where a setting could
            be tightened. Nothing here changes automatically.
          </p>
        </div>
        <nav className="intel-actions" aria-label="Security links">
          <a href={`/team/security?orgId=${orgId}`}>Access policy</a>
          <a href={`/team/audit?orgId=${orgId}`}>Audit log</a>
          <a href={`/team?orgId=${orgId}`}>Team admin</a>
        </nav>
      </header>

      {message && <p role="status" className="telemetry-status">{message}</p>}
      {loading && <p className="app-muted">Loading posture…</p>}

      {!loading && posture && (
        <>
          <section className="metric-grid">
            <article>
              <span>Members</span>
              <strong>{posture.memberCount}</strong>
            </article>
            <article>
              <span>Owners + admins</span>
              <strong>{posture.adminCount}</strong>
            </article>
            <article>
              <span>2FA policy</span>
              <strong style={{ fontSize: "18px" }}>{posture.authPolicy.mfaPolicy}</strong>
            </article>
            <article>
              <span>Delegated members</span>
              <strong>{posture.delegatedMembers}</strong>
            </article>
            <article>
              <span>Pending invites</span>
              <strong>{posture.pendingInvites}</strong>
            </article>
            <article>
              <span>Blocked AI · 7d</span>
              <strong>{posture.blockedRequests7d}</strong>
            </article>
          </section>

          <section className="admin-grid">
            <section className="intel-panel">
              <span className="eyebrow">SIGN-IN &amp; ACCESS</span>
              <p className="app-muted" style={{ marginTop: "0.5rem" }}>
                Sign-in methods: <strong>{methodSummary(posture.authPolicy)}</strong>
                <br />
                Authenticator 2FA: <strong>{posture.authPolicy.mfaPolicy}</strong>
                <br />
                Remembered devices: <strong>{posture.authPolicy.rememberedDeviceDays} days</strong>
                <br />
                Policy changes (30d): <strong>{posture.authChanges30d}</strong>
              </p>
            </section>
            <section className="intel-panel">
              <span className="eyebrow">SUGGESTIONS</span>
              {!items.length && (
                <p className="app-muted" style={{ marginTop: "0.5rem" }}>
                  Nothing stands out — the core controls look healthy.
                </p>
              )}
              {items.map((item, index) => (
                <article
                  className="admin-org"
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}
                  key={index}
                >
                  <div>
                    <strong style={{ color: item.level === "warn" ? "#ffb936" : undefined }}>
                      {item.level === "warn" ? "Review" : "Note"}
                    </strong>
                    <small>{item.text}</small>
                  </div>
                  {item.href && (
                    <a href={item.href} style={{ whiteSpace: "nowrap" }}>
                      {item.hrefLabel ?? "Open"}
                    </a>
                  )}
                </article>
              ))}
            </section>
          </section>
        </>
      )}
    </main>
  );
}
