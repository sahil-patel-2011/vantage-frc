"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, ToolStrip, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { withOrgHref } from "../../lib/nav/product-nav";
import { fetchProductSession } from "../../lib/nav/product-session";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { SettingsBar } from "../../components/settings-bar";
import { signOutAndRedirect } from "../../lib/sign-out";
import { AccountNotificationsPanel } from "./account-notifications-panel";
import { AccountProfilePanel } from "./account-profile-panel";
import { AccountRelated, NextActions, OrgContextCard } from "./account-shell";
import {
  DEFAULT_EMAIL_PREFS,
  DEFAULT_NOTIFICATION_PREFS,
  type AccountView,
  type EmailPrefs,
  type NotificationPrefs,
  type OrgContext,
  type Tab,
} from "./account-types";
import AppearancePanel from "./appearance-panel";
import "../product-hub.css";
import "./account.css";

type AccountOfflineCache = {
  account: AccountView;
  org: OrgContext;
};

function emptyOrg(): OrgContext {
  return {
    orgId: null,
    orgName: null,
    teamNumber: null,
    role: null,
    planCode: null,
    workspaceCount: 0,
  };
}

function isAccountCache(value: unknown): value is AccountOfflineCache {
  if (!value || typeof value !== "object") return false;
  const row = value as { account?: unknown; org?: unknown };
  if (!row.account || typeof row.account !== "object") return false;
  if (!row.org || typeof row.org !== "object") return false;
  return "orgId" in (row.org as object);
}

async function persistAccountSnapshot(data: AccountOfflineCache): Promise<void> {
  try {
    await putFeatureSnapshot("account", "_", data);
  } catch {
    // Live Account already painted; IndexedDB is best-effort.
  }
}

export default function AccountClient() {
  const [tab, setTab] = useState<Tab>("profile");
  const [account, setAccount] = useState<AccountView | null>(null);
  const [org, setOrg] = useState<OrgContext>({
    orgId: null,
    orgName: null,
    teamNumber: null,
    role: null,
    planCode: null,
    workspaceCount: 0,
  });
  const [displayName, setDisplayName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [phoneE164, setPhoneE164] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [emailPrefs, setEmailPrefs] = useState<EmailPrefs>(DEFAULT_EMAIL_PREFS);
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadStatus, setLoadStatus] = useState<number | null>(null);
  const accountRef = useRef<AccountView | null>(null);
  accountRef.current = account;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("tab");
    if (requested === "integrations") {
      const org = params.get("orgId");
      window.location.replace(org ? `/connectors?orgId=${encodeURIComponent(org)}` : "/connectors");
      return;
    }
    if (
      requested === "profile" ||
      requested === "appearance" ||
      requested === "notifications"
    ) {
      setTab(requested);
    }
  }, []);

  function selectTab(next: Tab) {
    setTab(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === "profile") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function applyAccount(data: AccountView) {
    setAccount(data);
    setDisplayName(data.displayName ?? data.name ?? "");
    setFirstName(data.firstName ?? "");
    setLastName(data.lastName ?? "");
    setDateOfBirth(data.dateOfBirth ?? "");
    setRecoveryEmail(data.recoveryEmail ?? "");
    setPhoneE164(data.phoneE164 ?? "");
    if (data.notificationPrefs) setPrefs(data.notificationPrefs);
    if (data.emailPrefs) setEmailPrefs(data.emailPrefs);
  }

  const load = useCallback(async () => {
    let hadCache = Boolean(accountRef.current);
    try {
      const cached = await getFeatureSnapshot<AccountOfflineCache>("account", "_");
      if (!accountRef.current && cached?.data && isAccountCache(cached.data)) {
        applyAccount(cached.data.account);
        setOrg(cached.data.org);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
        setLoading(false);
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    try {
      const response = await fetch("/api/account", {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      if (response.status === 401 || response.status === 403) {
        setMessage("");
        setMessageOk(false);
        setAccount(null);
        setOrg(emptyOrg());
        setFromCache(false);
        setCachedAt(null);
        setLoadStatus(response.status);
        setFetchFailed(true);
        return;
      }
      if (!response.ok) {
        if (hadCache || accountRef.current) {
          setFromCache(true);
          return;
        }
        setMessage("");
        setMessageOk(false);
        setAccount(null);
        setLoadStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setLoadStatus(null);
      const data = (await response.json()) as AccountView;
      applyAccount(data);
      setMessage("");

      const me = await fetchProductSession();
      const nextOrg: OrgContext = me
        ? {
            orgId: me.orgId ?? null,
            orgName: me.orgName ?? null,
            teamNumber: me.teamNumber ?? null,
            role: me.role ?? null,
            planCode: typeof me.planCode === "string" ? me.planCode : null,
            workspaceCount: Array.isArray(me.memberships)
              ? me.memberships.length
              : me.orgId
                ? 1
                : 0,
          }
        : emptyOrg();
      setOrg(nextOrg);
      setFromCache(false);
      setCachedAt(null);
      await persistAccountSnapshot({ account: data, org: nextOrg });
    } catch {
      if (hadCache || accountRef.current) {
        setFromCache(true);
        return;
      }
      setMessage("");
      setMessageOk(false);
      setAccount(null);
      setLoadStatus(null);
      setFetchFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setMessageOk(false);
    try {
      const response = await fetch("/api/account", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          dateOfBirth: dateOfBirth.trim() || undefined,
          recoveryEmail: recoveryEmail.trim() || null,
          phoneE164: phoneE164.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not save profile.");
        return;
      }
      setMessage("Profile saved.");
      setMessageOk(true);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function savePrefs() {
    setBusy(true);
    setMessage("");
    setMessageOk(false);
    try {
      const response = await fetch("/api/account", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationPrefs: prefs, emailPrefs }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not save notification preferences.");
        return;
      }
      setMessage("Notification preferences saved.");
      setMessageOk(true);
    } finally {
      setBusy(false);
    }
  }

  async function sendPhoneOtp() {
    setBusy(true);
    setMessage("");
    setMessageOk(false);
    try {
      const response = await fetch("/api/account/phone-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send", phoneE164 }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not send phone code.");
        return;
      }
      setMessage("Phone code sent.");
      setMessageOk(true);
    } finally {
      setBusy(false);
    }
  }

  async function verifyPhoneOtp() {
    setBusy(true);
    setMessage("");
    setMessageOk(false);
    try {
      const response = await fetch("/api/account/phone-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify", code: otpCode }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not verify phone.");
        return;
      }
      setMessage("Phone number confirmed.");
      setMessageOk(true);
      setOtpCode("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    await signOutAndRedirect("/");
  }

  const orgId = org.orgId;
  const hasProfile = Boolean(displayName.trim());
  const emailDeliveryReady = account?.emailDelivery?.status !== "setup_required";
  const googleReady = account?.integrations?.google.status === "available";
  const tbaReady = account?.integrations?.tba.status === "available";
  const showNextActions =
    Boolean(account) &&
    Boolean(orgId) &&
    (!hasProfile || !emailDeliveryReady || !googleReady || !tbaReady);

  return (
    <main className="module-page account-page">
      <PageHeader
        breadcrumbs="Account / Settings"
        title="Your settings"
        description="Personal profile and prefs for this login. Billing, AI usage, and team connectors follow your team."
      >
        {/* "Support" used to sit here pointing at /support, while the related
            strip one line below called the same page "Help & Support". Two
            names for one destination on one screen reads as two destinations.
            What's new stays: the strip does not carry it. */}
        <div className="account-header-actions">
          <Button as="a" variant="secondary" href="/whats-new">
            What’s new
          </Button>
        </div>
      </PageHeader>

      <OfflineBanner feature="Account" fromCache={fromCache} cachedAt={cachedAt} />

      <SettingsBar
        role={org.role}
        orgId={org.orgId}
        pathname="/account"
        activeTab={tab === "profile" ? null : tab}
      />

      <AccountRelated orgId={orgId} />

      {message ? (
        <p className={`telemetry-status${messageOk ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      {loading && !account ? (
        <EmptyState
          soft
          badge="Loading"
          badgeTone="setup"
          title="Loading account"
          description="Loading your profile, team, and preferences…"
          aria-busy
        />
      ) : null}

      {fetchFailed && !account ? (
        (() => {
          const kind = classifyLoadFailure({
            status: loadStatus,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          });
          const copy = loadFailureCopy(kind, {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message:
              "A network or server issue prevented loading. Try again, or open Support if this keeps failing.",
          });
          return (
            <EmptyState
              soft
              badge="Unavailable"
              badgeTone="setup"
              title={copy.title}
              description={copy.description}
            >
              {copy.primary ? (
                <Button as="a" variant="primary" href={copy.primary.href}>
                  {copy.primary.label}
                </Button>
              ) : copy.showRetry ? (
                <Button variant="primary" type="button" onClick={() => void load()}>
                  Retry
                </Button>
              ) : null}
            </EmptyState>
          );
        })()
      ) : null}

      {account ? (
        <>
          <OrgContextCard org={org} />

          {showNextActions ? (
            <NextActions
              orgId={orgId}
              hasProfile={hasProfile}
              emailDeliveryReady={emailDeliveryReady}
              googleReady={googleReady}
              tbaReady={tbaReady}
            />
          ) : null}

          {orgId ? (
            <section className="account-ai-keys app-card soft-panel" aria-label="AI keys">
              <header>
                <span className="app-badge">Keys</span>
                <h2>AI keys</h2>
                <p>
                  Your OpenAI or Anthropic key, or an Ollama / LM Studio URL. Yours override the team for your chats.
                </p>
              </header>
              <div className="account-ai-keys-actions">
                <Button as="a" variant="primary" href={withOrgHref("/team/ai-keys", orgId)}>
                  Open AI keys
                </Button>
              </div>
            </section>
          ) : null}

          <nav className="settings-hub" aria-label="Related settings">
            <a href="/security">
              <strong>Security</strong>
              <span>Authenticator app, remembered devices</span>
            </a>
            <a href="/notifications">
              <strong>Inbox</strong>
              <span>In-app alerts for this account</span>
            </a>
            <button type="button" onClick={() => selectTab("notifications")}>
              <strong>Notification prefs</strong>
              <span>In-app alerts and email opt-ins</span>
            </button>
            <a href="/whats-new">
              <strong>What’s new</strong>
              <span>Published releases for your plan</span>
            </a>
            {orgId ? (
              <>
                <a href={withOrgHref("/team/ai-keys", orgId)}>
                  <strong>AI keys</strong>
                  <span>Yours or the team’s · OpenAI, Anthropic, Ollama</span>
                </a>
                <a href={withOrgHref("/ai?tab=budgets", orgId)}>
                  <strong>Billing</strong>
                  <span>Chat limits and credits</span>
                </a>
                <a href={withOrgHref("/team/usage", orgId)}>
                  <strong>AI usage</strong>
                  <span>Live metered ledger for this team</span>
                </a>
                <a href={withOrgHref("/connectors", orgId)}>
                  <strong>Connectors</strong>
                  <span>Google, TBA, Onshape, GitHub, chat bridges</span>
                </a>
                <a href={withOrgHref("/team/security", orgId)}>
                  <strong>Team security</strong>
                  <span>Auth policy and delegated powers</span>
                </a>
              </>
            ) : (
              <a href="/workspace">
                <strong>Your team</strong>
                <span>Choose your team for keys, billing, and usage</span>
              </a>
            )}
          </nav>

          <ToolStrip
            aria-label="Account sections"
            value={tab}
            onChange={(id) => selectTab(id as Tab)}
            visibleCount={4}
            items={[
              { id: "profile", label: "Profile" },
              { id: "appearance", label: "Appearance" },
              { id: "notifications", label: "Notifications" },
            ]}
          />

          {tab === "profile" ? (
            <AccountProfilePanel
              account={account}
              org={org}
              displayName={displayName}
              firstName={firstName}
              lastName={lastName}
              dateOfBirth={dateOfBirth}
              recoveryEmail={recoveryEmail}
              phoneE164={phoneE164}
              otpCode={otpCode}
              busy={busy}
              onDisplayNameChange={setDisplayName}
              onFirstNameChange={setFirstName}
              onLastNameChange={setLastName}
              onDateOfBirthChange={setDateOfBirth}
              onRecoveryEmailChange={setRecoveryEmail}
              onPhoneE164Change={setPhoneE164}
              onOtpCodeChange={setOtpCode}
              onSave={saveProfile}
              onSendPhoneOtp={sendPhoneOtp}
              onVerifyPhoneOtp={verifyPhoneOtp}
              onSignOut={signOut}
            />
          ) : null}

          {tab === "appearance" ? (
            <Panel className="appearance-panel account-panel">
              <AppearancePanel />
            </Panel>
          ) : null}

          {tab === "notifications" ? (
            <AccountNotificationsPanel
              account={account}
              orgId={orgId}
              prefs={prefs}
              emailPrefs={emailPrefs}
              busy={busy}
              onPrefsChange={setPrefs}
              onEmailPrefsChange={setEmailPrefs}
              onSave={savePrefs}
            />
          ) : null}
        </>
      ) : null}
    </main>
  );
}
