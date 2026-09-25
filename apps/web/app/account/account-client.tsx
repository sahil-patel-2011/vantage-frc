"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useFollowUrl } from "../../lib/nav/use-follow-url";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, ToolStrip, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { withOrgHref } from "../../lib/nav/product-nav";
import { fetchProductSession } from "../../lib/nav/product-session";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { SettingsBar } from "../../components/settings-bar";
import { signOutAndRedirect } from "../../lib/sign-out";
import { KitCard, KitEyebrow, KitRow } from "../../components/ui/kit";
import { TOUR_STORAGE_KEY } from "../../lib/tour/tour-steps";
import { AccountNotificationsPanel } from "./account-notifications-panel";
import { AccountProfilePanel } from "./account-profile-panel";
import { OrgContextCard } from "./account-shell";
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
import { LocalModelPanel } from "./local-model-panel";
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
  const [teamRole, setTeamRole] = useState("");
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

  // Account's own related links ("Notification settings") point at its other tabs.
  useFollowUrl(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested === "profile" || requested === "appearance" || requested === "notifications") setTab(requested);
  });

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
    setTeamRole(data.teamRole ?? "");
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
          teamRole: teamRole || undefined,
          recoveryEmail: recoveryEmail.trim() || null,
          phoneE164: phoneE164.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not save profile.");
        return;
      }
      // Reload first: load() clears the message, and the note must survive it.
      await load();
      setMessage("Profile saved.");
      setMessageOk(true);
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
  const canManageTeam = Boolean(orgId) && (org.role === "owner" || org.role === "admin");

  return (
    <main className="module-page account-page">
      <PageHeader
        /* "Account", not "Your settings".
           The page lists two groups, "Your settings" and "Team settings", so
           titling the whole page after one of them was both a duplicate of the
           group label 440px below it and wrong about what the page holds.
           "Account" is what the top bar calls this route, which is the point:
           a page title that matches the thing you tapped to get here is not a
           repetition. (The breadcrumb that used to make it a third sighting is
           already gone.) */
        title="Account"
        description="Your profile and alerts, plus the team settings your role can reach."
      />

      <OfflineBanner feature="Account" fromCache={fromCache} cachedAt={cachedAt} />

      {/* Who you are signed in as, said once and plainly. The page opened
          straight into settings rows, so the first question it answered was
          "which toggle" rather than "whose account is this" — which matters on
          a shared shop laptop. No join date here: nothing in the session
          carries one, and a made-up "member since" is worse than no line. */}
      {/* Centred, and the avatar is the biggest thing on the screen, because
          the first question this page answers is "whose account am I looking
          at" — which matters most on the shared shop laptop where it is
          usually somebody else's. */}
      <section className="acct-hero" aria-label="Signed in as">
        <span className="acct-avatar" aria-hidden="true">
          {(displayName.trim() || "?").charAt(0).toUpperCase()}
        </span>
        <h2 className="acct-name">{displayName.trim() || "Your account"}</h2>
        {account?.email ? <p className="acct-email">{account.email}</p> : null}
        {/* Role and team only. The reference shows a join date here and the
            session does not carry one; a plausible-looking invented date is
            worse than a shorter row. */}
        {org.role || org.orgName ? (
          <dl className="acct-facts">
            {org.role ? (
              <div>
                <dt>Role</dt>
                <dd>{org.role}</dd>
              </div>
            ) : null}
            {org.orgName ? (
              <div>
                <dt>Team</dt>
                <dd>{org.orgName}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </section>

      <SettingsBar role={org.role} orgId={org.orgId} />

      {/* One place for money and help. AI spending and usage only for the people who can
          change them. */}
      <KitEyebrow>{canManageTeam ? "AI and help" : "Help"}</KitEyebrow>
      <KitCard>
        {canManageTeam ? (
          <>
            <KitRow icon="bolt" tone="amber" title="AI limits" subtitle="A monthly limit or pause for your team's AI key" href={withOrgHref("/ai?tab=budgets", orgId || null)} />
            <KitRow icon="stats" tone="teal" title="AI usage" subtitle="What your team's AI key has been used for" href={withOrgHref("/team/usage", orgId || null)} />
          </>
        ) : null}
        {!orgId ? (
          <KitRow icon="users" tone="blue" title="You're not on a team yet" subtitle="See what's next" href="/onboarding" />
        ) : null}
        <KitRow icon="chat" tone="cyan" title="Help and support" href="/support" />
      </KitCard>

      {/* On Profile a success shows beside Save (savedNote); here too it said it twice. */}
      {message && !(messageOk && tab === "profile") ? (
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


          {/* The one section switcher. `SettingsBar` used to render the same
              three destinations as a second row of links with the same
              accessible name, so the page carried two `navigation` landmarks
              called "Account sections" and the browser test's locator matched
              both. This is the copy that switches the panel in place; the
              other one has been removed. */}
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
              teamRole={teamRole}
              onTeamRoleChange={setTeamRole}
              savedNote={messageOk ? message : ""}
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

          {/* Lives beside appearance because it is the same kind of setting: a
              per-person, per-machine choice about how Vantage behaves here. */}
          {tab === "appearance" ? (
            // A per-device option most people never need; folded, not 500px under Appearance.
            <details className="appearance-more appearance-more--card">
              <summary>Run a model on this computer</summary>
              <LocalModelPanel />
            </details>
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

      {/* The three things people come to this page to do that are not a
          toggle. One card, one shape each, chevrons so they read as somewhere
          you go rather than something that happens on tap.

          No "Delete account" row: the reference has one and this deployment
          has no endpoint behind it, and a destructive-looking button that
          silently does nothing is worse than its absence. */}
      <KitEyebrow>Account</KitEyebrow>
      <KitCard className="acct-actions">
        <KitRow
          icon="sparkles"
          tone="violet"
          title="What’s new"
          subtitle="Recent updates and features"
          href="/whats-new"
        />
        <KitRow
          icon="play"
          tone="blue"
          title="Replay the tour"
          subtitle="Walk through the five stops on Home again"
          onClick={() => {
            try {
              window.localStorage.removeItem(TOUR_STORAGE_KEY);
            } catch {
              // Private windows throw. Reloading still shows the tour for the
              // rest of this session, which is what was asked for.
            }
            window.location.assign("/dashboard");
          }}
        />
        <KitRow
          icon="logout"
          tone="cyan"
          title="Sign out"
          subtitle="End this session on this device"
          onClick={() => void signOut()}
          chevron={false}
        />
      </KitCard>

      <p className="kit-footnote">Vantage · FRC scouting and strategy</p>
    </main>
  );
}
