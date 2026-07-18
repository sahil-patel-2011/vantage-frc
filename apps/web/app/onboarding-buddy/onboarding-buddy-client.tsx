"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { pairingStatusLabel } from "../../lib/onboarding-buddy";
import type { OnboardingBuddyView } from "../../lib/onboarding-buddy/compute-onboarding-buddy";
import type { OnboardingBuddyPairing } from "../../lib/onboarding-buddy/types";

type LiveView = Extract<OnboardingBuddyView, { status: "live" }>;

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function OnboardingBuddyClient() {
  const [view, setView] = useState<OnboardingBuddyView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Onboarding Buddy"}
          </>
        }
        title="Onboarding Buddy"
        description="Auto-pair new members with a tenured buddy and track a first-week plan. Suggestions use only real membership records."
      >
        {orgId ? (
          <a className="app-button secondary" href={`/team?orgId=${encodeURIComponent(orgId)}`}>
            Team
          </a>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Onboarding Buddy"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <UnpairedMembers view={view} busy={busy} mutate={mutate} />
          <Pairings view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Members", value: String(summary.totalMembers) },
    { label: "Unpaired new members", value: String(summary.unpairedCount) },
    { label: "Active pairings", value: String(summary.activePairingCount) },
    { label: "Completed pairings", value: String(summary.completedPairingCount) },
    { label: "Pairing coverage", value: pct(summary.pairingCoverage) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
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
      <EmptyState
        badge="All caught up"
        badgeTone="good"
        title="No unpaired new members"
        description="Every recently-joined member either has a buddy or has been on the team for a while."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>New members needing a buddy</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.unpairedMembers.map((member) => {
          const suggested = view.suggestedBuddyByMember[member.userId] ?? null;
          return (
            <li key={member.userId} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <div>
                <strong>{member.name}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  Joined {member.tenureDays} day(s) ago
                  {suggested ? ` · suggested buddy: ${suggested.name}` : " · no buddy candidate yet"}
                </small>
              </div>
              <button
                type="button"
                className="app-button"
                disabled={busy || !suggested}
                onClick={() =>
                  suggested &&
                  mutate({ action: "create-pairing", newMemberId: member.userId, buddyId: suggested.userId })
                }
              >
                Pair with {suggested ? suggested.name : "—"}
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
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
        badge="No pairings yet"
        badgeTone="setup"
        title="No buddy pairings logged"
        description="Pair a new member above to generate a first-week plan."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Pairings</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 14 }}>
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
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
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
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {pairing.planItems.map((item) => (
            <li key={item.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
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
