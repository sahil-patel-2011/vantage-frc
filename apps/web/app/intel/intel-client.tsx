"use client";

import { useState, type FormEvent } from "react";
import {
  UsageCutoffBanner,
  resolveCutoffErrorCode,
} from "../../components/usage-cutoff-banner";
import { EmptyState, PageHeader } from "../../components/ui";
import {
  classifyIntelShell,
  intelNextActions,
  intelShellCopy,
  type IntelActiveEvent,
  type IntelScoutNote,
} from "../../lib/intel/intel-related";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { withOrgHref } from "../../lib/nav/product-nav";
import { IntelRelatedStrip, IntelShell } from "./intel-chrome";
import {
  IntelLookupForm,
  IntelReadyView,
  IntelSearchResults,
  type IntelCompareResult,
  type IntelDetail,
  type IntelSearchTeam,
} from "./intel-ready-view";
import "./intel.css";

export default function IntelClient({ orgId }: { orgId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IntelSearchTeam[]>([]);
  const [intel, setIntel] = useState<IntelDetail | null>(null);
  const [similar, setSimilar] = useState<Array<IntelSearchTeam & { epaTotal: number }>>([]);
  const [scoutNotes, setScoutNotes] = useState<IntelScoutNote[]>([]);
  const [activeEvent, setActiveEvent] = useState<IntelActiveEvent | null>(null);
  const [summary, setSummary] = useState("");
  const [compare, setCompare] = useState("");
  const [comparison, setComparison] = useState<IntelCompareResult | null>(null);
  const [pickName, setPickName] = useState("Primary pick list");
  const [status, setStatus] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("error");
  const [submitting, setSubmitting] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadingTeam, setLoadingTeam] = useState(false);

  const chemistryHref = comparison
    ? withOrgHref(
        `/chemistry?teams=${comparison.teams.map((t) => t.teamNumber).join(",")}`,
        orgId,
      )
    : withOrgHref("/chemistry", orgId);

  async function search(event: FormEvent) {
    event.preventDefault();
    setStatus("Looking up teams…");
    setFetchFailed(false);
    setErrorStatus(null);
    setCutoffCode(null);
    try {
      const response = await fetch(`/api/intel/teams?orgId=${orgId}&q=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as {
        teams?: IntelSearchTeam[];
        activeEvent?: IntelActiveEvent | null;
        error?: string;
      };
      if (!response.ok) {
        setErrorStatus(response.status);
        setFetchFailed(true);
        setResults([]);
        setStatus(data.error ?? "Could not search teams");
        setMessageKind("error");
        return;
      }
      setResults(data.teams ?? []);
      if (data.activeEvent) setActiveEvent(data.activeEvent);
      setStatus("");
      setMessageKind("success");
    } catch {
      setFetchFailed(true);
      setResults([]);
      setStatus("Network error — please try again.");
      setMessageKind("error");
    }
  }

  async function select(teamNumber: number) {
    setStatus(`Loading Team ${teamNumber}…`);
    setLoadingTeam(true);
    setFetchFailed(false);
    setErrorStatus(null);
    setCutoffCode(null);
    try {
      const response = await fetch(`/api/intel/teams?orgId=${orgId}&team=${teamNumber}`, {
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as {
        team?: IntelDetail;
        similarTeams?: Array<IntelSearchTeam & { epaTotal: number }>;
        scoutObservations?: IntelScoutNote[];
        activeEvent?: IntelActiveEvent | null;
        error?: string;
      };
      if (!response.ok) {
        setErrorStatus(response.status);
        setFetchFailed(true);
        setIntel(null);
        setSimilar([]);
        setScoutNotes([]);
        setStatus(data.error ?? "Could not load team");
        setMessageKind("error");
        return;
      }
      setIntel(data.team ?? null);
      setSimilar(data.similarTeams ?? []);
      setScoutNotes(data.scoutObservations ?? []);
      if (data.activeEvent) setActiveEvent(data.activeEvent);
      setSummary("");
      setComparison(null);
      setStatus("");
      setMessageKind("success");
    } catch {
      setFetchFailed(true);
      setIntel(null);
      setStatus("Network error — please try again.");
      setMessageKind("error");
    } finally {
      setLoadingTeam(false);
    }
  }

  async function action(path: string, label: string) {
    if (!intel) return;
    setStatus(label);
    setCutoffCode(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        body: JSON.stringify({ orgId, teamNumber: intel.team.teamNumber }),
      });
      const data = (await response.json()) as {
        summary?: string;
        error?: string;
        code?: string;
        reason?: string;
      };
      const cutoff = resolveCutoffErrorCode(response.status, data);
      if (cutoff) {
        setCutoffCode(cutoff);
        setStatus(data.error ?? "Research paused until this team has credits.");
        setMessageKind("error");
        return;
      }
      if (path.includes("summary") && data.summary) setSummary(data.summary);
      setStatus(response.ok ? (path.includes("research") ? "Public notes updated." : "") : data.error ?? "");
      setMessageKind(response.ok ? "success" : "error");
      if (response.ok && path.includes("research")) await select(intel.team.teamNumber);
    } catch {
      setStatus("Network error — please try again.");
      setMessageKind("error");
    }
  }

  async function runComparison(event: FormEvent) {
    event.preventDefault();
    const numbers = compare
      .split(/[,\s]+/)
      .map(Number)
      .filter(Number.isInteger);
    if (intel && !numbers.includes(intel.team.teamNumber)) numbers.unshift(intel.team.teamNumber);
    setSubmitting(true);
    setCutoffCode(null);
    try {
      const response = await fetch("/api/intel/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        body: JSON.stringify({ orgId, teamNumbers: numbers.slice(0, 3) }),
      });
      const data = (await response.json()) as IntelCompareResult & { error?: string };
      setComparison(response.ok ? (data as IntelCompareResult) : null);
      setStatus(response.ok ? "" : data.error ?? "Compare failed");
      setMessageKind(response.ok ? "success" : "error");
    } catch {
      setComparison(null);
      setStatus("Network error — please try again.");
      setMessageKind("error");
    } finally {
      setSubmitting(false);
    }
  }

  async function savePick() {
    if (!intel) return;
    if (!activeEvent?.eventKey) {
      setStatus("Set your active event before saving a pick.");
      setMessageKind("error");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/intel/pick-lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        body: JSON.stringify({
          orgId,
          eventKey: activeEvent.eventKey,
          name: pickName,
          entries: [{ teamKey: intel.team.teamKey, rank: 1, tier: "review" }],
        }),
      });
      const data = (await response.json()) as { error?: string };
      setStatus(response.ok ? `Saved ${intel.team.teamNumber} to ${pickName}.` : data.error ?? "Save failed");
      setMessageKind(response.ok ? "success" : "error");
    } catch {
      setStatus("Network error — please try again.");
      setMessageKind("error");
    } finally {
      setSubmitting(false);
    }
  }

  const shell = classifyIntelShell({
    loading: loadingTeam && !intel,
    fetchFailed: fetchFailed && !intel && results.length === 0,
    orgId,
    hasSelectedTeam: intel != null,
  });

  if (shell === "loading" || shell === "error") {
    return (
      <IntelShell
        orgId={orgId}
        shell={shell}
        error={shell === "error" ? status || "Could not load Research." : undefined}
        errorStatus={errorStatus}
        onRetry={
          shell === "error"
            ? () => {
                setFetchFailed(false);
                setErrorStatus(null);
                setStatus("");
              }
            : undefined
        }
      />
    );
  }

  const findingCount = intel?.findings.length ?? 0;
  const readyActions = intelNextActions({
    orgId,
    shell,
    teamNumber: intel?.team.teamNumber ?? null,
    findingCount,
    scoutNoteCount: scoutNotes.length,
  });
  const emptyCopy = intelShellCopy("empty");

  return (
    <main className="module-page intel-page">
      <PageHeader
        breadcrumbs="Competition / Research"
        title="Research"
        description={intelShellCopy(intel ? "ready" : "empty").description}
      >
        <IntelRelatedStrip orgId={orgId} teamNumber={intel?.team.teamNumber ?? null} />
      </PageHeader>

      {cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}

      <IntelLookupForm query={query} onQueryChange={setQuery} onSearch={search} />

      {status ? (
        <div className={`telemetry-status${messageKind === "success" ? " success" : ""}`} role="status">
          {status}
        </div>
      ) : null}

      <IntelSearchResults results={results} onSelect={(teamNumber) => void select(teamNumber)} />

      {shell === "empty" && results.length === 0 ? (
        <EmptyState
          soft
          badge={emptyCopy.badge}
          badgeTone="setup"
          title={emptyCopy.title}
          description={emptyCopy.description}
        />
      ) : null}

      {shell === "ready" && intel ? (
        <IntelReadyView
          intel={intel}
          similar={similar}
          summary={summary}
          compare={compare}
          comparison={comparison}
          pickName={pickName}
          toolsOpen={toolsOpen}
          submitting={submitting}
          scoutNotes={scoutNotes}
          activeEvent={activeEvent}
          readyActions={readyActions}
          chemistryHref={chemistryHref}
          onWriteBrief={() => void action("/api/intel/summary", "Writing a brief…")}
          onFindNotes={() => void action("/api/research", "Looking up public notes…")}
          onToggleTools={() => setToolsOpen((open) => !open)}
          onCompareChange={setCompare}
          onCompare={runComparison}
          onPickNameChange={setPickName}
          onSavePick={() => void savePick()}
          onSelectSimilar={(teamNumber) => void select(teamNumber)}
        />
      ) : null}
    </main>
  );
}
