"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import type { AlliancePartnerBriefView } from "../../lib/alliance-partner-brief/compute-alliance-partner-brief";
import type { AllianceOption, PartnerAnalysis } from "../../lib/alliance-partner-brief/types";

type LiveView = Extract<AlliancePartnerBriefView, { status: "live" }>;

function slotLabel(slot: PartnerAnalysis["slot"]): string {
  if (slot === "captain") return "Captain";
  if (slot === "first") return "1st pick";
  return "2nd pick";
}

function allianceLabel(option: AllianceOption): string {
  const teams = [option.captainTeamKey, option.firstPickTeamKey, option.secondPickTeamKey]
    .filter((key): key is string => Boolean(key))
    .map((key) => key.replace(/^frc/, ""))
    .join(" / ");
  return `Seed ${option.seed}${teams ? ` — ${teams}` : ""}`;
}

export default function AlliancePartnerBriefClient() {
  const [view, setView] = useState<AlliancePartnerBriefView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seedOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seedOverride) query.set("allianceSeed", String(seedOverride));
    void fetch(`/api/alliance-partner-brief${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as AlliancePartnerBriefView | { error?: string };
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

  const generate = useCallback(
    async (seed: number, eventKey: string) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/alliance-partner-brief", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, action: "generate-brief", eventKey, allianceSeed: seed }),
        });
        const data = (await response.json()) as AlliancePartnerBriefView | { error?: string };
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
            <a href={orgId ? `/strategy?orgId=${encodeURIComponent(orgId)}` : "/strategy"}>Competition</a>
            {" / Alliance-Partner Brief"}
          </>
        }
        title="Alliance-Partner Brief"
        description="Once alliance selection is finalized, an auto-brief on your actual partners' roles and strengths — grounded in event metrics and your own scouting."
      >
        {orgId ? (
          <a className="app-button secondary" href={`/strategy/draft?orgId=${encodeURIComponent(orgId)}`}>
            Alliance board
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
          title="Could not load the alliance-partner brief"
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
        <LiveBody view={view} busy={busy} onSelectSeed={(seed) => load(seed)} onGenerate={generate} />
      )}
    </main>
  );
}

function LiveBody({
  view,
  busy,
  onSelectSeed,
  onGenerate,
}: {
  view: LiveView;
  busy: boolean;
  onSelectSeed: (seed: number) => void;
  onGenerate: (seed: number, eventKey: string) => void;
}) {
  const finalizedAlliances = view.alliances.filter((a) => a.captainTeamKey);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>{view.allianceBoardName}</h2>
            <small className="app-muted">
              {view.eventName ?? view.eventKey} {view.ourTeamKey ? `· Your team: ${view.ourTeamKey.replace(/^frc/, "")}` : ""}
            </small>
          </div>
        </header>

        {finalizedAlliances.length === 0 ? (
          <p className="app-muted" style={{ marginTop: 12 }}>
            No alliances have been picked yet on this board. Finalize alliance selection first.
          </p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {finalizedAlliances.map((option) => (
              <button
                key={option.seed}
                type="button"
                className={`app-button ${view.selectedSeed === option.seed ? "" : "secondary"}`}
                onClick={() => onSelectSeed(option.seed)}
              >
                {option.isOurAlliance ? "★ " : ""}
                {allianceLabel(option)}
              </button>
            ))}
          </div>
        )}
      </Panel>

      {view.selectedSeed != null ? (
        <BriefPanel view={view} busy={busy} onGenerate={onGenerate} />
      ) : null}
    </div>
  );
}

function BriefPanel({
  view,
  busy,
  onGenerate,
}: {
  view: LiveView;
  busy: boolean;
  onGenerate: (seed: number, eventKey: string) => void;
}) {
  const seed = view.selectedSeed!;
  const brief = view.brief;

  return (
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Partner brief — seed {seed}</h2>
        <button
          type="button"
          className="app-button"
          disabled={busy}
          onClick={() => onGenerate(seed, view.eventKey)}
        >
          {brief ? "Regenerate" : "Generate brief"}
        </button>
      </header>

      {!brief ? (
        <p className="app-muted" style={{ marginTop: 12 }}>
          No brief generated yet for this alliance. Generate one to see roles and strengths for your partners.
        </p>
      ) : (
        <>
          <small className="app-muted">Generated {new Date(brief.generatedAt).toLocaleString()}</small>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12, marginTop: 12 }}>
            {brief.partners.map((partner) => (
              <li key={partner.teamKey} className="app-card soft-panel" style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <strong>
                      {partner.teamNumber ?? partner.teamKey.replace(/^frc/, "")}
                      {partner.nickname ? ` — ${partner.nickname}` : ""}
                    </strong>
                    <small className="app-muted" style={{ display: "block" }}>
                      {slotLabel(partner.slot)} · {partner.roleLabel}
                    </small>
                  </div>
                </div>
                {partner.strengths.length > 0 ? (
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                    {partner.strengths.map((strength) => (
                      <li key={strength}>{strength}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="app-muted" style={{ margin: "8px 0 0" }}>
                    No strengths on file yet.
                  </p>
                )}
                <small className="app-muted" style={{ display: "block", marginTop: 6 }}>
                  Evidence: {partner.evidenceNote}
                </small>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
