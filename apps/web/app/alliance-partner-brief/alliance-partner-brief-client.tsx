"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
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
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./alliance-partner-brief.css";

function isAlliancePartnerBriefView(value: unknown): value is AlliancePartnerBriefView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistAllianceBriefSnapshot(
  orgHint: string,
  seedHint: string,
  data: AlliancePartnerBriefView,
): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  const seedKey =
    data.status === "live" && data.brief ? String(data.brief.allianceSeed) : seedHint;
  try {
    await putFeatureSnapshot("alliance-brief", cacheOrg, data, seedKey);
    await putFeatureSnapshot("alliance-brief", cacheOrg, data);
    if (!orgHint) {
      await putFeatureSnapshot("alliance-brief", "_", data, seedKey);
      await putFeatureSnapshot("alliance-brief", "_", data);
    }
  } catch {
    // Live brief already painted; IndexedDB is best-effort.
  }
}

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
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
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
  const allianceBoardHref = withOrgHref("/strategy/draft", orgId);

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
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={allianceBoardHref}>Open Alliance board</Button>
        ) : null}
      </EmptyState>
      {shell === "ready" ? <BriefNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function AlliancePartnerBriefClient() {
  const [view, setView] = useState<AlliancePartnerBriefView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<AlliancePartnerBriefView | null>(null);
  viewRef.current = view;

  const load = useCallback((seedOverride?: number) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      const seedHint = seedOverride ? String(seedOverride) : "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<AlliancePartnerBriefView>(
          "alliance-brief",
          urlOrg || "_",
          seedHint,
        );
        if (!viewRef.current && cached?.data && isAlliancePartnerBriefView(cached.data)) {
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
      if (seedHint) query.set("allianceSeed", seedHint);
      try {
        const response = await fetch(
          `/api/alliance-partner-brief${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as AlliancePartnerBriefView | { error?: string };
        if (!response.ok || !isAlliancePartnerBriefView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Alliance-Partner Brief. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistAllianceBriefSnapshot(urlOrg, seedHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Alliance-Partner Brief. Showing the last copy on this device.");
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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as AlliancePartnerBriefView | { error?: string };
        if (!response.ok || !isAlliancePartnerBriefView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        void persistAllianceBriefSnapshot(orgId, String(seed), data);
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
      <BriefShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Alliance-Partner Brief" fromCache={fromCache} cachedAt={cachedAt} />
      </BriefShell>
    );
  }

  if (shell === "error") {
    return (
      <BriefShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Alliance-Partner Brief" fromCache={fromCache} cachedAt={cachedAt} />
      </BriefShell>
    );
  }

  if (shell === "setup") {
    return (
      <BriefShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Alliance-Partner Brief" fromCache={fromCache} cachedAt={cachedAt} />
      </BriefShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <BriefShell description={shellCopy.description} orgId={orgId} shell="setup">
        <OfflineBanner feature="Alliance-Partner Brief" fromCache={fromCache} cachedAt={cachedAt} />
      </BriefShell>
    );
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
        description="Once alliance selection is finalized, an auto-brief on your actual partners' roles and strengths — grounded in event metrics and your own scouting. Cross-check Strategy, Alliance board, and Scouting."
      >
        <div className="alliance-partner-brief-header-actions">
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>
      <OfflineBanner feature="Alliance-Partner Brief" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

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
          <Button as="a" variant="primary" href={allianceBoardHref}>
            Open Alliance board
          </Button>
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
            confirm field notes in <a href={scoutingHref}>Scouting</a>.
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
            No alliances have been picked yet on this board. Finalize alliance selection first.
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
        <Button variant="primary" type="button" disabled={busy} onClick={() => onGenerate(seed, view.eventKey)}>
          {brief ? "Regenerate" : "Generate brief"}
        </Button>
      </header>

      {!brief ? (
        <EmptyState
          soft
          badge="No brief yet"
          badgeTone="setup"
          title="Generate a partner brief for this alliance"
          description="Roles and strengths appear only from event metrics and your own scouting."
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
