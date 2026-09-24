"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../../components/ui";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { fetchProductSession } from "../../../lib/nav/product-session";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import { strategyCanSync } from "../../../lib/strategy/strategy-related";

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
  /** Fail closed until /api/me confirms owner or admin. */
  const [canManage, setCanManage] = useState(false);
  /** Fail closed until the policy read says this account can change team settings. */
  const [canEditPolicy, setCanEditPolicy] = useState(false);
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
        setCanEditPolicy(false);
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
      const record =
        data && typeof data === "object" ? (data as { policy?: unknown; canManage?: unknown }) : null;
      const next = record && "policy" in record ? record.policy : null;
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
      setCanEditPolicy(record?.canManage === true);
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

  useEffect(() => {
    let cancelled = false;
    void fetchProductSession(orgId).then((session) => {
      if (cancelled) return;
      if (!session) {
        setCanManage(false);
        return;
      }
      const membership = session.memberships?.find((entry) => entry.orgId === orgId);
      setCanManage(strategyCanSync(membership?.role ?? session.role));
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/organizations/auth-policy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, ...policy }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Saved." : (data.error ?? "Could not save."));
    if (response.ok) await persistAuthPolicySnapshot(orgId, policy);
  }

  return (
    <main className="module-page team-security-page">
      <PageHeader
        breadcrumbs="Settings / Team security"
        title="Team security"
        description="Choose how people sign in to your team. What each person can open is set on Team admin."
      >
        <nav className="team-admin-settings-links" aria-label="Related settings">
          {canManage ? <a href={withOrgHref("/team/admin", orgId)}>Team admin</a> : null}
          <a href={`/team/ai-keys?orgId=${orgId}`}>AI keys</a>
          <a href="/security">Your own two-step sign-in</a>
        </nav>
      </PageHeader>
      <OfflineBanner feature="Team security" fromCache={fromCache} cachedAt={cachedAt} />

      {message ? (
        <p role="status" className="telemetry-status">
          {message}
        </p>
      ) : null}

      {!loaded ? (
        <EmptyState soft title="Loading sign-in policy…" description="Checking which methods this team allows." aria-busy />
      ) : canEditPolicy ? (
      <Panel as="form" className="auth-policy-form" onSubmit={save}>
        <h2>Ways to sign in</h2>
        <p>Only people you invite can join, whichever way they sign in.</p>
        <label className="state-control">
          <input
            type="checkbox"
            checked={policy.allowEmailOtp}
            onChange={(event) => setPolicy({ ...policy, allowEmailOtp: event.target.checked })}
          />
          <span>
            <strong>Emailed code</strong>
            <small>We email a short code each time they sign in</small>
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
            <small>They can reset a forgotten password by email</small>
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
            <small>Their Google account must use the email you invited</small>
          </span>
        </label>
        <h2>Two-step sign-in (authenticator app)</h2>
        <label>
          For this team
          <select
            value={policy.mfaPolicy}
            onChange={(event) => setPolicy({ ...policy, mfaPolicy: event.target.value })}
          >
            <option value="off">Off</option>
            <option value="optional">Optional</option>
            <option value="required">Required for everyone</option>
          </select>
        </label>
        <label>
          Don&apos;t ask again on the same device for
          <input
            type="number"
            min={0}
            max={90}
            value={policy.rememberedDeviceDays}
            onChange={(event) => setPolicy({ ...policy, rememberedDeviceDays: Number(event.target.value) })}
          />
          <small>days (0 means ask every time)</small>
        </label>
        <Button variant="primary" type="submit">
          Save sign-in rules
        </Button>
      </Panel>
      ) : (
        <EmptyState
          soft
          badge="No access"
          badgeTone="setup"
          title="Owners and admins set sign-in methods"
          description="An owner or mentor chooses emailed codes, passwords, Google, and whether two-step sign-in is required. Your own authenticator app is under Account."
        >
          <Button as="a" variant="secondary" href="/security">
            Your own two-step sign-in
          </Button>
        </EmptyState>
      )}

      {canManage ? (
        <Panel className="auth-policy-form team-security-access-pointer">
          <h2>Who can open what</h2>
          <p>
            Each person&apos;s role, the sections they can open, extra powers and budget access are set in one place:
            their <strong>Access</strong> button on Team admin.
          </p>
          <Button as="a" variant="secondary" href={`${withOrgHref("/team/admin", orgId)}#people`}>
            Open Team admin
          </Button>
        </Panel>
      ) : null}
    </main>
  );
}
