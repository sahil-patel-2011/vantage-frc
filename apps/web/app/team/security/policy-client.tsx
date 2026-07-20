"use client";

import { useEffect, useState } from "react";
import { PageHeader, Panel } from "../../../components/ui";

export default function AuthPolicyClient({ orgId }: { orgId: string }) {
  const [policy, setPolicy] = useState({
    allowPassword: false,
    allowGoogle: true,
    allowEmailOtp: true,
    mfaPolicy: "optional",
    rememberedDeviceDays: 14,
  });
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetch(`/api/organizations/auth-policy?orgId=${orgId}`)
      .then((response) => response.json())
      .then((data) => {
        if (data.policy) setPolicy(data.policy);
      });
  }, [orgId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/organizations/auth-policy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, ...policy }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Authentication policy saved and audited." : data.error);
  }

  return (
    <main className="module-page team-security-page">
      <PageHeader
        breadcrumbs="Settings / Team security"
        title="Team security"
        description="Organization sign-in policy, 2FA requirements, hub access for scouts/viewers, and delegated admin powers. Personal authenticator setup lives under Account → Security."
      >
        <nav className="settings-inline-links" aria-label="Related settings">
          <a href={`/team?orgId=${orgId}`}>Team admin</a>
          <a href={`/team/budgets?orgId=${orgId}`}>API budgets</a>
          <a href={`/team?orgId=${orgId}#custom-providers`}>API keys</a>
          <a href="/security">Personal 2FA</a>
        </nav>
      </PageHeader>

      {message ? (
        <p role="status" className="telemetry-status">
          {message}
        </p>
      ) : null}

      <Panel as="form" className="auth-policy-form" onSubmit={save}>
        <h2>Allowed sign-in methods</h2>
        <p>
          These methods only authenticate an identity. Membership remains invite-only and verified-email matching still
          applies.
        </p>
        <label className="state-control">
          <input
            type="checkbox"
            checked={policy.allowEmailOtp}
            onChange={(event) => setPolicy({ ...policy, allowEmailOtp: event.target.checked })}
          />
          <span>
            <strong>Email one-time code</strong>
            <small>Short-lived, single-use numeric code</small>
          </span>
        </label>
        <label className="state-control">
          <input
            type="checkbox"
            checked={policy.allowPassword}
            onChange={(event) => setPolicy({ ...policy, allowPassword: event.target.checked })}
          />
          <span>
            <strong>Email and password</strong>
            <small>Verified email, breach check, reset code, session revocation</small>
          </span>
        </label>
        <label className="state-control">
          <input
            type="checkbox"
            checked={policy.allowGoogle}
            onChange={(event) => setPolicy({ ...policy, allowGoogle: event.target.checked })}
          />
          <span>
            <strong>Google</strong>
            <small>Verified Google email and existing membership only</small>
          </span>
        </label>
        <h2>Authenticator-app 2FA</h2>
        <label>
          Policy
          <select
            value={policy.mfaPolicy}
            onChange={(event) => setPolicy({ ...policy, mfaPolicy: event.target.value })}
          >
            <option value="off">Off</option>
            <option value="optional">Optional</option>
            <option value="required">Required for organization access</option>
          </select>
        </label>
        <label>
          Remember verified device for
          <input
            type="number"
            min={0}
            max={90}
            value={policy.rememberedDeviceDays}
            onChange={(event) => setPolicy({ ...policy, rememberedDeviceDays: Number(event.target.value) })}
          />
          <small>days (0 disables remembered devices)</small>
        </label>
        <button className="primary-action" type="submit">
          Save access policy
        </button>
      </Panel>
    </main>
  );
}
