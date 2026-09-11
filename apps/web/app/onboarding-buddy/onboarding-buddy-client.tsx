"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, SelectField, Button } from "../../components/ui";
import { eligibleBuddyCandidates, pairingStatusLabel } from "../../lib/onboarding-buddy";
import type { OnboardingBuddyView } from "../../lib/onboarding-buddy/compute-onboarding-buddy";
import {
  ONBOARDING_BUDDY_RELATED_INCLUDE,
  classifyOnboardingBuddyShell,
  formatOnboardingBuddyCoverage,
  formatOnboardingBuddyMetric,
  onboardingBuddyNextActions,
  onboardingBuddyRelatedLinks,
  onboardingBuddySetupSteps,
  onboardingBuddyShellCopy,
  shouldShowOnboardingBuddySummaryTiles,
  type OnboardingBuddyNextAction,
  type OnboardingBuddyShellKind,
} from "../../lib/onboarding-buddy/onboarding-buddy-related";
import type { OnboardingBuddyMember, OnboardingBuddyPairing } from "../../lib/onboarding-buddy/types";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./onboarding-buddy.css";

type LiveView = Extract<OnboardingBuddyView, { status: "live" }>;

function isOnboardingBuddyView(value: unknown): value is OnboardingBuddyView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistOnboardingBuddySnapshot(
  orgHint: string,
  data: OnboardingBuddyView,
): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("onboarding-buddy", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("onboarding-buddy", "_", data);
  } catch {
    // Live Onboarding Buddy already painted; IndexedDB is best-effort.
  }
}

function BuddyRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = onboardingBuddyRelatedLinks(orgId, {
    include: [...ONBOARDING_BUDDY_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related onboarding-buddy-related" aria-label="Related team tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function BuddyNextActionsPanel({ actions }: { actions: OnboardingBuddyNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions onboarding-buddy-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function BuddyShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: OnboardingBuddyShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = onboardingBuddyNextActions({ orgId, shell });
  const copy = onboardingBuddyShellCopy(shell);
  const teamHref = hubWorkbenchHref("team", "onboarding-buddy", orgId);
  const setup = shell === "setup" ? onboardingBuddySetupSteps(orgId)[0] : null;

  return (
    <main className="module-page onboarding-buddy-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Onboarding Buddy"}
          </>
        }
        title="Onboarding Buddy"
        description={description}
      >
        <BuddyRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Needs setup"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No pairings yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href="#onboarding-buddy-unpaired">Pair a member</Button>
        ) : null}
      </EmptyState>
      {shell === "ready" ? <BuddyNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function OnboardingBuddyClient() {
  const [view, setView] = useState<OnboardingBuddyView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<OnboardingBuddyView | null>(null);
  viewRef.current = view;

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<OnboardingBuddyView>(
          "onboarding-buddy",
          urlOrg || "_",
        );
        if (!viewRef.current && cached?.data && isOnboardingBuddyView(cached.data)) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      try {
        const response = await fetch(
          `/api/onboarding-buddy${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as OnboardingBuddyView | { error?: string };
        if (!response.ok || !isOnboardingBuddyView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Onboarding Buddy. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistOnboardingBuddySnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Onboarding Buddy. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const pairingCount = view?.status === "live" ? view.pairings.length : 0;
  const unpairedCount = view?.status === "live" ? view.unpairedMembers.length : 0;
  const memberCount = view?.status === "live" ? view.members.length : 0;

  const shell = classifyOnboardingBuddyShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    pairingCount,
  });
  const shellCopy = onboardingBuddyShellCopy(shell);
  const nextActions = onboardingBuddyNextActions({
    orgId,
    shell,
    unpairedCount,
    pairingCount,
    memberCount,
  });
  const relatedLinks = onboardingBuddyRelatedLinks(orgId, {
    include: [...ONBOARDING_BUDDY_RELATED_INCLUDE],
  });
  const teamHref = hubWorkbenchHref("team", "onboarding-buddy", orgId);
  const showTiles = shouldShowOnboardingBuddySummaryTiles({
    memberCount,
    pairingCount,
    unpairedCount,
  });

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/onboarding-buddy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as OnboardingBuddyView | { error?: string };
        if (!response.ok || !isOnboardingBuddyView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        void persistOnboardingBuddySnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return (
      <BuddyShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Onboarding Buddy" fromCache={fromCache} cachedAt={cachedAt} />
      </BuddyShell>
    );
  }

  if (shell === "error") {
    return (
      <BuddyShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Onboarding Buddy" fromCache={fromCache} cachedAt={cachedAt} />
      </BuddyShell>
    );
  }

  if (shell === "setup") {
    return (
      <BuddyShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Onboarding Buddy" fromCache={fromCache} cachedAt={cachedAt} />
      </BuddyShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <BuddyShell description={shellCopy.description} orgId={orgId} shell="setup">
        <OfflineBanner feature="Onboarding Buddy" fromCache={fromCache} cachedAt={cachedAt} />
      </BuddyShell>
    );
  }

  return (
    <main className="module-page onboarding-buddy-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Onboarding Buddy"}
          </>
        }
        title="Onboarding Buddy"
        description="Auto-pair new members with a tenured buddy and track a first-week plan. Suggestions use only real membership records. Cross-check Your team, Onboarding, and Team Data."
      >
        <div className="onboarding-buddy-header-actions">
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>

      <OfflineBanner feature="Onboarding Buddy" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <BuddyNextActionsPanel actions={nextActions} />

      {showTiles ? (
        <Panel className="onboarding-buddy-panel" aria-label="Buddy pairing counts">
          <div className="onboarding-buddy-stats">
            <div>
              <strong>{formatOnboardingBuddyMetric(view.summary.totalMembers, true)}</strong>
              <span className="app-muted">Members</span>
            </div>
            <div>
              <strong>{formatOnboardingBuddyMetric(view.summary.unpairedCount, true)}</strong>
              <span className="app-muted">Unpaired new members</span>
            </div>
            <div>
              <strong>{formatOnboardingBuddyMetric(view.summary.activePairingCount, true)}</strong>
              <span className="app-muted">Active pairings</span>
            </div>
            <div>
              <strong>{formatOnboardingBuddyMetric(view.summary.completedPairingCount, true)}</strong>
              <span className="app-muted">Completed pairings</span>
            </div>
            <div>
              <strong>{formatOnboardingBuddyCoverage(view.summary.pairingCoverage, true)}</strong>
              <span className="app-muted">Pairing coverage</span>
            </div>
          </div>
        </Panel>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No pairings yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
          className="product-hub-setup"
        >
          <Button as="a" variant="primary" href="#onboarding-buddy-unpaired">
            Pair a member
          </Button>
        </EmptyState>
      ) : null}

      <div className="onboarding-buddy-layout">
        <UnpairedMembers view={view} busy={busy} mutate={mutate} />
        <Pairings view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function UnpairedMembers({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.unpairedMembers.length === 0) {
    return (
      <div id="onboarding-buddy-unpaired">
        <EmptyState
          soft
          badge="All caught up"
          badgeTone="good"
          title="No unpaired new members"
          description="Every recently-joined member either has a buddy or has been on the team for a while."
        />
      </div>
    );
  }
  return (
    <Panel className="onboarding-buddy-panel" id="onboarding-buddy-unpaired" aria-label="Unpaired members">
      <header>
        <h2>New members needing a buddy</h2>
        <p className="app-muted">Suggestions use real tenure and active load.</p>
      </header>
      <ul className="onboarding-buddy-list">
        {view.unpairedMembers.map((member) => (
          <UnpairedMemberRow
            key={member.userId}
            member={member}
            members={view.members}
            suggested={view.suggestedBuddyByMember[member.userId] ?? null}
            busy={busy}
            mutate={mutate}
          />
        ))}
      </ul>
    </Panel>
  );
}

function UnpairedMemberRow({
  member,
  members,
  suggested,
  busy,
  mutate,
}: {
  member: OnboardingBuddyMember;
  members: OnboardingBuddyMember[];
  suggested: OnboardingBuddyMember | null;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const candidates = eligibleBuddyCandidates(members, member.userId);
  const [buddyId, setBuddyId] = useState(suggested?.userId ?? candidates[0]?.userId ?? "");
  const selected = candidates.find((c) => c.userId === buddyId) ?? null;

  return (
    <li className="onboarding-buddy-row">
      <div>
        <strong>{member.name}</strong>
        <small className="app-muted" style={{ display: "block" }}>
          Joined {member.tenureDays} day(s) ago
          {suggested ? ` · suggested buddy: ${suggested.name}` : " · no buddy candidate yet"}
        </small>
      </div>
      <div className="onboarding-buddy-pick">
        <SelectField
          label="Buddy"
          value={buddyId}
          onChange={(event) => setBuddyId(event.target.value)}
          disabled={busy || candidates.length === 0}
          required
          options={candidates.map((candidate) => ({
            value: candidate.userId,
            label: candidate.name,
          }))}
        />
        <Button variant="primary" type="button" disabled={busy || !selected} onClick={() => selected && mutate({ action: "create-pairing", newMemberId: member.userId, buddyId: selected.userId }) }>
          Pair with {selected ? selected.name : "—"}
        </Button>
      </div>
    </li>
  );
}

function Pairings({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.pairings.length === 0) {
    return (
      <EmptyState
        soft
        badge="No pairings yet"
        badgeTone="setup"
        title="No buddy pairings logged"
        description="Pair a new member above to generate a first-week plan."
      />
    );
  }
  return (
    <Panel className="onboarding-buddy-panel" aria-label="Buddy pairings">
      <header>
        <h2>Pairings</h2>
        <p className="app-muted">Progress moves when you tick off a plan step.</p>
      </header>
      <ul className="onboarding-buddy-list">
        {view.pairings.map((pairing) => (
          <PairingCard key={pairing.id} pairing={pairing} busy={busy} mutate={mutate} />
        ))}
      </ul>
    </Panel>
  );
}

function PairingCard({
  pairing,
  busy,
  mutate,
}: {
  pairing: OnboardingBuddyPairing;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <li className="app-card soft-panel" style={{ padding: 12, display: "grid", gap: 8 }}>
      <div className="onboarding-buddy-row" style={{ alignItems: "flex-start" }}>
        <div>
          <strong>
            {pairing.newMemberName} <span className="app-muted">buddied with</span> {pairing.buddyName}
          </strong>
          <small className="app-muted" style={{ display: "block" }}>
            {pairingStatusLabel(pairing.status)} · paired {new Date(pairing.pairedAt).toLocaleDateString()} ·{" "}
            {pairing.planProgress.done}/{pairing.planProgress.total} plan steps done
          </small>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {pairing.status === "active" ? (
            <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "set-status", pairingId: pairing.id, status: "completed" })}>
              Mark complete
            </Button>
          ) : null}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete pairing for ${pairing.newMemberName}?`)) {
                mutate({ action: "delete-pairing", pairingId: pairing.id });
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>
      {pairing.planItems.length > 0 ? (
        <ul className="onboarding-buddy-plan">
          {pairing.planItems.map((item) => (
            <li key={item.id}>
              <input
                type="checkbox"
                checked={item.done}
                disabled={busy}
                onChange={() => mutate({ action: "toggle-item", itemId: item.id, done: !item.done })}
              />
              <div>
                <span style={item.done ? { textDecoration: "line-through" } : undefined}>
                  Day {item.dayOffset}: {item.title}
                </span>
                {item.description ? (
                  <small className="app-muted" style={{ display: "block" }}>
                    {item.description}
                  </small>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
