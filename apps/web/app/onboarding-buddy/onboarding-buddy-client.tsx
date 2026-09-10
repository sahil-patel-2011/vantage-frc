"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmptyState, PageHeader, Panel, SelectField } from "../../components/ui";
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
import { withOrgHref } from "../../lib/nav/product-nav";
import "./onboarding-buddy.css";

type LiveView = Extract<OnboardingBuddyView, { status: "live" }>;

function BuddyRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = onboardingBuddyRelatedLinks(orgId, {
    include: [...ONBOARDING_BUDDY_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related onboarding-buddy-related" aria-label="Related team tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
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
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
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
  const steps = shell === "setup" ? onboardingBuddySetupSteps(orgId) : [];

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
            ? "Setup required"
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
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button is-primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</a>
        ) : null}
        {shell === "empty" ? (
          <a className="app-button is-primary" href="#onboarding-buddy-unpaired">Pair a member</a>
        ) : null}
      </EmptyState>
      {steps.length > 0 ? (
        <Panel className="onboarding-buddy-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="onboarding-buddy-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted onboarding-buddy-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <BuddyNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function OnboardingBuddyClient() {
  const [view, setView] = useState<OnboardingBuddyView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/onboarding-buddy${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as OnboardingBuddyView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
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
        });
        const data = (await response.json()) as OnboardingBuddyView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return <BuddyShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <BuddyShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <BuddyShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <BuddyShell description={shellCopy.description} orgId={orgId} shell="setup" />;
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
        description="Auto-pair new members with a tenured buddy and track a first-week plan. Suggestions use only real membership records. Cross-check Workspace, Onboarding, and Team Data."
      >
        <div className="onboarding-buddy-header-actions">
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

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
          <a className="app-button is-primary" href="#onboarding-buddy-unpaired">
            Pair a member
          </a>
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
        <button
          type="button"
          className="app-button"
          disabled={busy || !selected}
          onClick={() =>
            selected &&
            mutate({ action: "create-pairing", newMemberId: member.userId, buddyId: selected.userId })
          }
        >
          Pair with {selected ? selected.name : "—"}
        </button>
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
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() => mutate({ action: "set-status", pairingId: pairing.id, status: "completed" })}
            >
              Mark complete
            </button>
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
