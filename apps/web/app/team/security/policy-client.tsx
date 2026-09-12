"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { PageHeader, Panel, Button } from "../../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";

type AuthPolicy = {
  allowPassword: boolean;
  allowGoogle: boolean;
  allowEmailOtp: boolean;
  mfaPolicy: string;
  rememberedDeviceDays: number;
};

const DEFAULT_POLICY: AuthPolicy = {
  allowPassword: false,
  allowGoogle: true,
  allowEmailOtp: true,
  mfaPolicy: "optional",
  rememberedDeviceDays: 14,
};

function isAuthPolicy(value: unknown): value is AuthPolicy {
  if (!value || typeof value !== "object") return false;
  const row = value as AuthPolicy;
  return typeof row.allowEmailOtp === "boolean" && typeof row.mfaPolicy === "string";
}

async function persistAuthPolicySnapshot(orgId: string, data: AuthPolicy): Promise<void> {
  if (!orgId.trim()) return;
  try {
    await putFeatureSnapshot("auth-policy", orgId, data);
  } catch {
    // Live sign-in policy already painted; IndexedDB is best-effort.
  }
}

export default function AuthPolicyClient({ orgId }: { orgId: string }) {
  const [policy, setPolicy] = useState<AuthPolicy>(DEFAULT_POLICY);
  const [message, setMessage] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  loadedRef.current = loaded;

  const load = useCallback(async () => {
    let hadCache = loadedRef.current;
    try {
      const cached = await getFeatureSnapshot<AuthPolicy>("auth-policy", orgId);
      if (cached?.data && isAuthPolicy(cached.data)) {
        if (!loadedRef.current) {
          setPolicy(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          setLoaded(true);
        }
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    try {
      const response = await fetch(`/api/organizations/auth-policy?orgId=${orgId}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setPolicy(DEFAULT_POLICY);
        setFromCache(false);
        setCachedAt(null);
        setLoaded(true);
        setMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load sign-in policy.",
        );
        return;
      }
      const next =
        data && typeof data === "object" && "policy" in data ? (data as { policy?: unknown }).policy : null;
      if (!response.ok || !isAuthPolicy(next)) {
        if (hadCache || loadedRef.current) {
          setFromCache(true);
          setMessage("Could not refresh sign-in policy. Showing the last copy on this device.");
          setLoaded(true);
          return;
        }
        setLoaded(true);
        return;
      }
      setPolicy(next);
      setFromCache(false);
      setCachedAt(null);
      setLoaded(true);
      setMessage("");
      await persistAuthPolicySnapshot(orgId, next);
    } catch {
      if (hadCache || loadedRef.current) {
        setFromCache(true);
        setMessage("Could not refresh sign-in policy. Showing the last copy on this device.");
      }
      setLoaded(true);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/organizations/auth-policy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, ...policy }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Sign-in policy saved and audited." : (data.error ?? "Could not save."));
    if (response.ok) await persistAuthPolicySnapshot(orgId, policy);
  }

  return (
    <main className="module-page team-security-page">
      <PageHeader
        breadcrumbs="Settings / Team security"
        title="Team security"
        description="Team sign-in policy, 2FA requirements, hub access for scouts/viewers, and delegated admin powers. Personal authenticator setup lives under Account → Security."
      >
        <nav className="settings-inline-links" aria-label="Related settings">
          <a href={`/team?orgId=${orgId}`}>Invites</a>
          <a href={`/team/budgets?orgId=${orgId}`}>Chat limits</a>
          <a href={`/team/ai-keys?orgId=${orgId}`}>Team keys</a>
          <a href="/security">Personal 2FA</a>
        </nav>
      </PageHeader>
      <OfflineBanner feature="Team security" fromCache={fromCache} cachedAt={cachedAt} />

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
            <option value="required">Required for team access</option>
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
        <Button variant="primary" type="submit">
          Save access policy
        </Button>
      </Panel>
    </main>
  );
}
