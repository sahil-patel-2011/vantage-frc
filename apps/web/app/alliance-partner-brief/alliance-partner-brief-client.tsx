"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import type { AlliancePartnerBriefView } from "../../lib/alliance-partner-brief/compute-alliance-partner-brief";
import {
  ALLIANCE_PARTNER_BRIEF_RELATED_INCLUDE,
  alliancePartnerBriefNextActions,
  alliancePartnerBriefRelatedLinks,
  alliancePartnerBriefShellCopy,
  classifyAlliancePartnerBriefShell,
  formatAlliancePartnerBriefMetric,
  shouldShowAlliancePartnerBriefSummaryTiles,
  type AlliancePartnerBriefNextAction,
  type AlliancePartnerBriefShellKind,
} from "../../lib/alliance-partner-brief/alliance-partner-brief-related";
import type { AllianceOption, PartnerAnalysis } from "../../lib/alliance-partner-brief/types";
import { renderReceiptFrom, type RenderReceipt } from "../../lib/ai-render/outcome";
import { RenderAttribution } from "../../components/ui/render-attribution";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./alliance-partner-brief.css";

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

function BriefRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = alliancePartnerBriefRelatedLinks(orgId, {
    include: [...ALLIANCE_PARTNER_BRIEF_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related alliance-partner-brief-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function BriefNextActionsPanel({ actions }: { actions: AlliancePartnerBriefNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions alliance-partner-brief-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Strategy, Alliance board, and Scouting — never DEMO partner metrics.</p>
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

function BriefShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: AlliancePartnerBriefShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = alliancePartnerBriefNextActions({ orgId, shell });
  const copy = alliancePartnerBriefShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "alliance-partner-brief", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const allianceBoardHref = withOrgHref("/strategy/draft", orgId);
  const scoutingHref = hubHref("/competition", "scouting", orgId);

  return (
    <main className="module-page alliance-partner-brief-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Alliance-Partner Brief"}
          </>
        }
        title="Alliance-Partner Brief"
        description={description}
      >
        <BriefRelatedStrip orgId={orgId} />
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
                ? "No alliances yet"
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
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Open Workspace
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href={allianceBoardHref}>
              Open Alliance board
            </a>
            <a className="app-button secondary" href={strategyHref}>
              Open Strategy
            </a>
            <a className="app-button secondary" href={scoutingHref}>
              Open Scouting
            </a>
          </>
        ) : null}
      </EmptyState>
      <BriefNextActionsPanel actions={actions} />
    </main>
  );
}

export default function AlliancePartnerBriefClient() {
  const [view, setView] = useState<AlliancePartnerBriefView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Honest badge for the latest brief render: "AI" only when a model wrote it.
  const [renderReceipt, setRenderReceipt] = useState<RenderReceipt | null>(null);

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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const finalizedCount =
    view?.status === "live" ? view.alliances.filter((a) => a.captainTeamKey).length : 0;
  const partnerCount = view?.status === "live" ? (view.brief?.partners.length ?? 0) : 0;
  const hasBrief = view?.status === "live" ? view.brief != null : false;

  const shell = classifyAlliancePartnerBriefShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    finalizedCount,
  });
  const shellCopy = alliancePartnerBriefShellCopy(shell);
  const nextActions = alliancePartnerBriefNextActions({
    orgId,
    shell,
    finalizedCount,
    partnerCount,
    hasBrief,
  });
  const relatedLinks = alliancePartnerBriefRelatedLinks(orgId, {
    include: [...ALLIANCE_PARTNER_BRIEF_RELATED_INCLUDE],
  });
  const competitionHref = hubWorkbenchHref("competition", "alliance-partner-brief", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const allianceBoardHref = withOrgHref("/strategy/draft", orgId);
  const scoutingHref = hubHref("/competition", "scouting", orgId);

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
        const receipt = renderReceiptFrom(data);
        if (receipt) setRenderReceipt(receipt);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return <BriefShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <BriefShell
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
      <BriefShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <BriefShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page alliance-partner-brief-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Alliance-Partner Brief"}
          </>
        }
        title="Alliance-Partner Brief"
        description="Once alliance selection is finalized, an auto-brief on your actual partners' roles and strengths — grounded in event metrics and your own scouting. Never DEMO partner metrics. Cross-check Strategy, Alliance board, and Scouting."
      >
        <div className="alliance-partner-brief-header-actions">
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

      <RenderAttribution receipt={renderReceipt} feature="alliance-partner-brief" />

      <BriefNextActionsPanel actions={nextActions} />

      {shouldShowAlliancePartnerBriefSummaryTiles(finalizedCount) ? (
        <SummaryTiles
          finalizedCount={finalizedCount}
          partnerCount={partnerCount}
          hasBrief={hasBrief}
          loaded
        />
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No alliances yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href={allianceBoardHref}>
            Open Alliance board
          </a>
          <a className="app-button secondary" href={strategyHref}>
            Open Strategy
          </a>
          <a className="app-button secondary" href={scoutingHref}>
            Open Scouting
          </a>
        </EmptyState>
      ) : null}

      <div className="alliance-partner-brief-layout">
        <LiveBody view={view} busy={busy} onSelectSeed={(seed) => load(seed)} onGenerate={generate} />
        <Panel className="alliance-partner-brief-tip" aria-label="Alliance-Partner Brief tip">
          <span className="eyebrow">Grounding path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Finalize captains on the{" "}
            <a href={allianceBoardHref}>Alliance board</a>, keep{" "}
            <a href={strategyHref}>Strategy</a> picks grounded in scouted and reference metrics, and
            confirm field notes in <a href={scoutingHref}>Scouting</a> — never invent DEMO partner
            roles or strengths.
          </p>
        </Panel>
      </div>
    </main>
  );
}

function SummaryTiles({
  finalizedCount,
  partnerCount,
  hasBrief,
  loaded,
}: {
  finalizedCount: number;
  partnerCount: number;
  hasBrief: boolean;
  loaded: boolean;
}) {
  const tiles = [
    { label: "Finalized alliances", value: formatAlliancePartnerBriefMetric(finalizedCount, loaded) },
    {
      label: "Brief partners",
      value: hasBrief ? formatAlliancePartnerBriefMetric(partnerCount, loaded) : "—",
    },
  ];
  return (
    <section className="alliance-partner-brief-stats" aria-label="Alliance-Partner Brief counts">
      {tiles.map((tile) => (
        <div key={tile.label}>
          <strong>{tile.value}</strong>
          <span className="app-muted" style={{ display: "block" }}>
            {tile.label}
          </span>
        </div>
      ))}
    </section>
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
    <>
      <Panel className="alliance-partner-brief-panel" id="alliance-partner-brief-board">
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>{view.allianceBoardName}</h2>
            <small className="app-muted">
              {view.eventName ?? view.eventKey}{" "}
              {view.ourTeamKey ? `· Your team: ${view.ourTeamKey.replace(/^frc/, "")}` : ""}
            </small>
          </div>
        </header>

        {finalizedAlliances.length === 0 ? (
          <p className="app-muted" style={{ marginTop: 12 }}>
            No alliances have been picked yet on this board. Finalize alliance selection first — never
            invent DEMO captains.
          </p>
        ) : (
          <div className="alliance-partner-brief-seeds">
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
    </>
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
    <Panel id="alliance-partner-brief-panel" className="alliance-partner-brief-panel">
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
        <EmptyState
          soft
          badge="No brief yet"
          badgeTone="setup"
          title="Generate a partner brief for this alliance"
          description="Roles and strengths appear only from event metrics and your own scouting — never DEMO partner claims."
        />
      ) : (
        <>
          <small className="app-muted">Generated {new Date(brief.generatedAt).toLocaleString()}</small>
          <ul className="alliance-partner-brief-list">
            {brief.partners.map((partner) => (
              <li key={partner.teamKey} className="app-card soft-panel alliance-partner-brief-card">
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
                    No strengths on file yet — never invent DEMO claims.
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
