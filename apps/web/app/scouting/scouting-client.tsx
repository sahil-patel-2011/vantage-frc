"use client";

import { useOnline } from "../../lib/offline/use-online";

import { OfflineBanner } from "../../components/offline-banner";

import type { SchemaDefinition, ScoutSchema, SyncEntry, ScoutIdentity } from "@vantage/scouting";
import {
  applyFormResetBehavior,
  applyVoiceTranscriptToForm,
  DEFAULT_DRIVETRAIN_OPTIONS,
  isLayoutOnlyField,
  normalizeRobotImageRefs,
} from "@vantage/scouting";
import { isScoutIdentityField, SCOUT_IDENTITY_LOCK_COPY } from "@vantage/scouting/identity";
import {
  fieldConfidenceHint,
  lintSchemaBudget,
  type FieldTrustSummary,
} from "@vantage/scouting/trust";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { EmptyState, FormRow, PageHeader, Panel, TabBar } from "../../components/ui";
import { ExportButton, type CsvColumn } from "../../components/ui/export-button";
import { CopyShareLink } from "../../components/copy-share-link";
import { useVenueShortcuts, VenueShortcutCheatsheet } from "../../hooks/use-venue-shortcuts";
import {
  clearScoutDraft,
  formatDraftSavedAgo,
  payloadHasDraftContent,
  readScoutDraft,
  scoutDraftStorageKey,
  writeScoutDraft,
} from "../../lib/scouting/draft-autosave";
import {
  cacheEvent,
  discardQuarantined,
  getCachedEvent,
  getQueuedMediaBlob,
  listQuarantine,
  pendingCounts,
  queueEntry,
  queueMedia,
  quarantineMedia,
  retryQuarantined,
  stableClientId,
  syncMediaOutbox,
  syncOutbox,
  type QuarantinedItem,
} from "../../lib/scout-offline";
import {
  DOWNSCALE_JPEG_QUALITY,
  downscaleDimensions,
  exceedsMediaCap,
  isDownscalableImageType,
  mediaKindLabel,
  oversizeMediaReason,
} from "../../lib/scouting/media-downscale";
import { buildAttachMediaWire } from "../../lib/scouting/attach-media-wire";
import { prepareScoutMediaFile, scoutMediaKind } from "../../lib/scouting/prepare-scout-media";
import { resolveScoutMediaPreview } from "../../lib/scouting/scout-media-preview";
import { nextMatchKey, scoutingPostSaveNextSteps } from "../../lib/scouting/form-builder";
import { StudioField, isStudioField } from "./studio-fields";
import {
  SCOUTING_RELATED_INCLUDE,
  classifyScoutingShell,
  formatScoutingMetric,
  scoutingNextActions,
  scoutingOfflineBannerDetail,
  scoutingRelatedLinks,
  scoutingSetupSteps,
  scoutingShellCopy,
  shouldShowScoutingRecentEntries,
  type ScoutingNextAction,
  type ScoutingShellKind,
} from "../../lib/scouting/scouting-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import ScoutingTrustPanel from "./scouting-trust-panel";
import ScoutHandoffPanel from "./scout-handoff-panel";
import ScoutVoiceNotesPanel from "./scout-voice-notes-panel";
import "./scouting-qr.css";

type Bootstrap = {
  eventKey: string | null;
  schemas: ScoutSchema[];
  canManageSchemas?: boolean;
  assignments: Array<{
    matchKey: string;
    teamKey: string;
    compLevel: string;
    matchNumber: number;
  }>;
  matches: Array<{
    matchKey: string;
    matchNumber: number;
    compLevel?: string;
    redAlliance?: { teamKeys?: string[] };
    blueAlliance?: { teamKeys?: string[] };
  }>;
  recentEntries: Array<{
    id: string;
    type: string;
    matchKey: string | null;
    teamKey: string;
    confidence: string;
    source: string;
    updatedAt: string;
    scoutName: string;
    scoutUserId?: string;
  }>;
  scoutIdentity?: ScoutIdentity;
};


type ScoutTab = "match" | "pit" | "conflicts" | "handoff" | "trust";

type RecentEntry = NonNullable<Bootstrap["recentEntries"]>[number];

/**
 * CSV shape of the recent-entries feed — the raw scouting rows teams otherwise
 * re-type into a Sheet. Identity, source, and confidence travel with the row so an
 * exported file is still auditable outside Vantage.
 */
const SCOUT_ENTRY_CSV_COLUMNS: CsvColumn<RecentEntry>[] = [
  { key: "matchKey", header: "Match", hint: "Blank for pit entries", value: (entry) => entry.matchKey },
  { key: "teamKey", header: "Team", hint: "TBA team key, e.g. frc1678", value: (entry) => entry.teamKey },
  { key: "type", header: "Type", hint: "match or pit" },
  { key: "scoutName", header: "Scout", hint: "Who submitted it" },
  { key: "source", header: "Source", hint: "How it arrived (form, QR handoff, sync)" },
  { key: "confidence", header: "Confidence", hint: "Scout's own confidence flag" },
  {
    key: "updatedAt",
    header: "Updated at",
    hint: "ISO-8601 UTC — latest timestamp wins per entry",
    value: (entry) => entry.updatedAt,
  },
];

type ConflictCandidate = {
  entryId: string;
  value: unknown;
  scoutName?: string | null;
  confidence?: string | null;
};

type TrustSnapshot = {
  fieldTrust: FieldTrustSummary[];
  leaderboard: Array<{
    userId: string;
    name: string;
    entries: number;
    checks: number;
    matches: number;
    conflicts: number;
    accuracy: number | null;
  }>;
};

type OfficialFlag = {
  fieldKey: string;
  status: string;
  scoutValue: unknown;
  officialValue: unknown;
  officialSource: string;
  detail: string;
  soft?: boolean;
};

function ScoutingRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = scoutingRelatedLinks(orgId, {
    include: [...SCOUTING_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related scout-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function ScoutingNextActionsPanel({ actions }: { actions: ScoutingNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions scout-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Forms, coverage, and strategy stay empty until you scout.</p>
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

function ScoutingShell({
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  embedded = false,
  children,
}: {
  orgId?: string | null;
  shell: ScoutingShellKind;
  error?: string;
  /** HTTP status of the failed load, so an expired session can offer sign-in. */
  errorStatus?: number | null;
  onRetry?: () => void;
  embedded?: boolean;
  children?: ReactNode;
}) {
  const actions = scoutingNextActions({ orgId, shell });
  const copy = scoutingShellCopy(shell);
  const steps = shell === "setup" ? scoutingSetupSteps(orgId) : [];
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus ?? null,
            message: error ?? null,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error ?? null,
          },
        )
      : null;
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";
  const commandHref = hubHref("/competition", "command", orgId);
  const formsHref = hubHref("/competition", "forms", orgId);
  const coverageHref = withOrgHref("/scouting/lineup", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const offlineHref = withOrgHref("/offline", orgId);

  return (
    <main className={`module-page scout-page soft-gate${embedded ? " is-embedded" : ""}`}>
      {embedded ? null : (
      <PageHeader
        breadcrumbs="Competition / Scouting"
        title="Scouting"
        description="Match and pit forms stay on this device until you sync."
      >
        <ScoutingRelatedStrip orgId={orgId} />
      </PageHeader>
      )}
      {children}
      <EmptyState
        soft
        className="scout-shell-empty"
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? copy.badge
                : copy.badge
        }
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : (error ?? copy.description)}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <a className="app-button" href={failure.primary.href}>
            {failure.primary.label}
          </a>
        ) : null}
        {failure?.showRetry && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? commandHref : workspaceHref}>
            {orgId ? "Set active event" : "Select workspace"}
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href={formsHref}>
              Open Form builder
            </a>
            <a className="app-button secondary" href={coverageHref}>
              Open Coverage
            </a>
            <a className="app-button secondary" href={strategyHref}>
              Open Strategy
            </a>
            <a className="app-button secondary" href={offlineHref}>
              Open Offline
            </a>
          </>
        ) : null}
        {!embedded && shell === "setup" && steps.length > 0 ? (
          <ol className="scout-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        ) : null}
      </EmptyState>
      {embedded || shell === "loading" ? null : <ScoutingNextActionsPanel actions={actions} />}
    </main>
  );
}

export default function ScoutingClient({ orgId, embedded = false }: { orgId: string; embedded?: boolean }) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [tab, setTab] = useState<ScoutTab>("match");
  const [matchKey, setMatchKey] = useState("");
  const [teamKey, setTeamKey] = useState("");
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [confidence, setConfidence] = useState<"high" | "normal" | "low">("normal");
  const [source, setSource] = useState<"manual" | "voice">("manual");
  const [entryClientId, setEntryClientId] = useState(() => stableClientId());
  const online = useOnline();
  const [fromCache, setFromCache] = useState(false);
  const [counts, setCounts] = useState({ entries: 0, media: 0, quarantined: 0 });
  const [quarantine, setQuarantine] = useState<QuarantinedItem[]>([]);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [bootstrapStatus, setBootstrapStatus] = useState<number | null>(null);
  const [saveReceipt, setSaveReceipt] = useState<{
    teamKey: string;
    matchKey?: string;
    entryType: "match" | "pit";
    offline: boolean;
  } | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "degraded">("idle");
  const [conflicts, setConflicts] = useState<Array<Record<string, unknown>>>([]);
  const [selectedWinners, setSelectedWinners] = useState<Record<string, string>>({});
  const [officialFlags, setOfficialFlags] = useState<OfficialFlag[]>([]);
  const [formulaName, setFormulaName] = useState("");
  const [formulaWeights, setFormulaWeights] = useState<Record<string, number>>({});
  const [showFormula, setShowFormula] = useState(false);
  const [trust, setTrust] = useState<TrustSnapshot | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const { cheatOpen, setCheatOpen, shortcuts } = useVenueShortcuts(orgId);

  const type = tab === "pit" ? "pit" : "match";

  const refreshCounts = useCallback(async () => {
    setCounts(await pendingCounts());
    setQuarantine(await listQuarantine(orgId));
  }, [orgId]);
  const loadTrust = useCallback(async (eventKey: string | null | undefined) => {
    if (!orgId || !eventKey || !navigator.onLine) return;
    try {
      const params = new URLSearchParams({ orgId, eventKey });
      const response = await fetch(`/api/scouting/trust?${params}`);
      if (!response.ok) return;
      const body = (await response.json()) as TrustSnapshot;
      setTrust({ fieldTrust: body.fieldTrust ?? [], leaderboard: body.leaderboard ?? [] });
    } catch {
      /* keep last-good field confidence */
    }
  }, [orgId]);
  const sync = useCallback(async () => {
    if (!orgId || !navigator.onLine) return;
    setSyncState("syncing");
    try {
      const entries = await syncOutbox(orgId, {
        onRetry: (n, delayMs) => {
          setSyncState("degraded");
          setMessage(`Sync retry ${n} in ${Math.round(delayMs / 1000)}s — entries stay queued`);
        },
      });
      const media = await syncMediaOutbox(orgId);
      if (entries.validations.length) setOfficialFlags(entries.validations);
      const quarantinedNow = entries.quarantined + media.quarantined;
      if (entries.count || media.synced || quarantinedNow) {
        const conflictCount = entries.validations.filter((flag) => flag.status === "conflict").length;
        const attention = quarantinedNow
          ? ` · ${quarantinedNow} need${quarantinedNow === 1 ? "s" : ""} attention below`
          : "";
        setMessage(
          conflictCount
            ? `Synced ${entries.count} entries · ${conflictCount} TBA contradiction${conflictCount === 1 ? "" : "s"} flagged${attention}`
            : `Synced ${entries.count} entries and ${media.synced} media files${attention}`,
        );
      }
      setSyncState("idle");
      await refreshCounts();
    } catch (error) {
      setSyncState(navigator.onLine ? "degraded" : "idle");
      setMessage(error instanceof Error ? error.message : "Sync paused — outbox kept");
    }
  }, [orgId, refreshCounts]);

  const flagsByField = useMemo(() => {
    const map = new Map<string, OfficialFlag[]>();
    for (const flag of officialFlags) {
      const list = map.get(flag.fieldKey) ?? [];
      list.push(flag);
      map.set(flag.fieldKey, list);
    }
    return map;
  }, [officialFlags]);

  const liveConflicts = useMemo(
    () => officialFlags.filter((flag) => flag.status === "conflict" || (flag.soft && flag.detail)),
    [officialFlags],
  );

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setFetchFailed(false);
      setBootstrapStatus(null);
      const cached = await getCachedEvent<Bootstrap>(orgId);
      if (cached) {
        setData(cached);
        setFromCache(true);
      }
      try {
        const response = await fetch(`/api/scouting/bootstrap?orgId=${encodeURIComponent(orgId)}`);
        if (response.ok) {
          const fresh = (await response.json()) as Bootstrap;
          setData(fresh);
          setFromCache(false);
          setFetchFailed(false);
          await cacheEvent(orgId, fresh);
          await loadTrust(fresh.eventKey);
        } else if (cached) {
          setMessage("Using cached event data — bootstrap unavailable");
        } else {
          setFetchFailed(true);
          setBootstrapStatus(response.status);
          setMessage("Could not load scouting bootstrap");
        }
      } catch {
        if (cached) {
          setMessage("Using cached event data");
        } else {
          setFetchFailed(true);
          setMessage("No cached event data available");
        }
      } finally {
        setLoading(false);
      }
      await refreshCounts();
      await sync();
    })();
    const handleOnline = () => {
      void sync();
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [orgId, refreshCounts, sync, loadTrust]);

  useEffect(() => {
    const deepMatch = searchParams.get("matchKey");
    const deepTeam = searchParams.get("teamKey");
    // Hub owns `tab=` (e.g. competition?tab=scouting). Prefer scoutTab; accept legacy
    // tab=trust|conflicts|… including duplicate tab keys after redirects.
    const scoutTabCandidates = [
      searchParams.get("scoutTab"),
      ...searchParams.getAll("tab"),
    ];
    const deepTab = scoutTabCandidates.find(
      (value): value is ScoutTab | "impact" =>
        value === "match" ||
        value === "pit" ||
        value === "conflicts" ||
        value === "handoff" ||
        value === "trust" ||
        value === "impact",
    );
    if (deepMatch) setMatchKey(deepMatch);
    if (deepTeam) setTeamKey(deepTeam);
    if (searchParams.get("handoff") || searchParams.get("code")) setTab("handoff");
    else if (deepTab) {
      setTab(deepTab === "impact" ? "trust" : deepTab);
    }
  }, [searchParams]);

  useEffect(() => {
    const assignment = data?.assignments[0];
    if (assignment && !matchKey && !searchParams.get("matchKey")) {
      setMatchKey(assignment.matchKey);
      setTeamKey(assignment.teamKey);
    }
  }, [data, matchKey, searchParams]);

  const matchOptions = useMemo(() => {
    if (!data) return [];
    if (data.assignments.length) {
      return data.assignments.map((assignment) => ({
        matchKey: assignment.matchKey,
        teamKey: assignment.teamKey,
        label: `${assignment.compLevel.toUpperCase()} ${assignment.matchNumber} · ${assignment.teamKey}`,
      }));
    }
    const options: Array<{ matchKey: string; teamKey: string; label: string }> = [];
    for (const match of data.matches) {
      const teams = [
        ...(match.redAlliance?.teamKeys ?? []),
        ...(match.blueAlliance?.teamKeys ?? []),
      ];
      const comp = match.compLevel?.toUpperCase() ?? "MATCH";
      for (const key of teams) {
        options.push({
          matchKey: match.matchKey,
          teamKey: key,
          label: `${comp} ${match.matchNumber} · ${key}`,
        });
      }
    }
    return options;
  }, [data]);

  const schema = useMemo(
    () => data?.schemas.find((candidate) => candidate.type === type),
    [data, type],
  );

  const formFields = useMemo(
    () => schema?.definition.fields.filter((field) => !isScoutIdentityField(field)) ?? [],
    [schema],
  );

  const schemaBudget = useMemo(
    () => (schema ? lintSchemaBudget(schema.definition) : null),
    [schema],
  );

  const trustByField = useMemo(() => {
    const map = new Map<string, FieldTrustSummary>();
    for (const row of trust?.fieldTrust ?? []) map.set(row.fieldKey, row);
    return map;
  }, [trust]);

  const draftKey = useMemo(
    () =>
      scoutDraftStorageKey({
        orgId,
        eventKey: data?.eventKey ?? "",
        entryType: type,
        matchKey,
        teamKey,
      }),
    [orgId, data?.eventKey, type, matchKey, teamKey],
  );

  useEffect(() => {
    if (!draftKey) {
      setDraftSavedAt(null);
      setDraftDirty(false);
      return;
    }
    const existing = readScoutDraft(draftKey);
    if (existing) {
      setPayload(existing.payload);
      setConfidence(existing.confidence);
      setDraftSavedAt(existing.savedAt);
      setDraftDirty(false);
      return;
    }
    setPayload({});
    setDraftSavedAt(null);
    setDraftDirty(false);
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey || !payloadHasDraftContent(payload)) return;
    setDraftDirty(true);
    const timer = window.setTimeout(() => {
      const savedAt = writeScoutDraft(draftKey, {
        payload,
        confidence,
        matchKey,
        teamKey,
      });
      if (savedAt) {
        setDraftSavedAt(savedAt);
        setDraftDirty(false);
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [draftKey, payload, confidence, matchKey, teamKey]);

  async function submit() {
    if (!data?.eventKey || !schema || !teamKey || (type === "match" && !matchKey)) {
      setMessage("Select an event assignment, team, and form");
      return;
    }
    const entry: SyncEntry = {
      clientId: entryClientId,
      orgId,
      type,
      eventKey: data.eventKey,
      matchKey: type === "match" ? matchKey : undefined,
      teamKey,
      schemaId: schema.id,
      payload,
      confidence,
      source,
      updatedAt: new Date().toISOString(),
    };
    await queueEntry(entry);
    clearScoutDraft(draftKey);
    // formResetBehavior: keep the constants a scout would only retype (station,
    // alliance), step the ones that count up, and drop everything else. The
    // match number box steps too, so the next match is one tap away.
    setPayload(applyFormResetBehavior(schema.definition, payload));
    if (type === "match") {
      const stepped = nextMatchKey(matchKey);
      if (stepped) setMatchKey(stepped);
    }
    setSource("manual");
    setEntryClientId(stableClientId());
    setDraftSavedAt(null);
    setDraftDirty(false);
    setSaveReceipt({
      teamKey,
      matchKey: type === "match" ? matchKey : undefined,
      entryType: type,
      offline: !online,
    });
    setMessage(
      online
        ? "Saved on this device — queued for org sync"
        : "Saved offline — will sync when you reconnect",
    );
    await refreshCounts();
    await sync();
  }

  async function attachMedia(file: File, options?: { fieldKey?: string; tags?: string[] }) {
    const eventKey = data?.eventKey;
    const tags = ["pit", ...(options?.tags ?? [])];
    const kind = scoutMediaKind(file);
    const gate = buildAttachMediaWire({
      eventKey,
      teamKey,
      entryClientId,
      entryId: null,
      kind,
      contentType: file.type || "image/jpeg",
      byteSize: file.size,
      tags,
      fieldKey: options?.fieldKey,
    });
    if (!gate.ok) {
      setMessage(gate.reason);
      return null;
    }

    const clientId = stableClientId();
    // Phone photos are routinely >6MB — downscale before anything is queued.
    const downscaled = await downscaleImageInBrowser(file);
    const candidate = asMediaFile(downscaled, file);

    // Final gate before IndexedDB: empty, unsupported, and still-over-cap files are PERMANENT
    // failures. They go to quarantine (which owns retry/discard) instead of the upload outbox,
    // where they would retry against a guaranteed 400 forever. Unlinked captures never persist.
    let prepared: File;
    try {
      prepared = await prepareScoutMediaFile(candidate);
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : oversizeMediaReason(candidate.size, mediaKindLabel(kind));
      const failed = buildAttachMediaWire({
        eventKey,
        teamKey,
        entryClientId,
        entryId: null,
        kind,
        contentType: candidate.type || file.type || "image/jpeg",
        byteSize: candidate.size,
        tags,
        fieldKey: options?.fieldKey,
      });
      if (failed.ok) {
        await quarantineMedia(
          { clientId, orgId, metadata: failed.metadata, blob: candidate },
          reason,
        );
      }
      setMessage(reason);
      await refreshCounts();
      return null;
    }

    const blob: Blob = prepared;
    const queued = buildAttachMediaWire({
      eventKey,
      teamKey,
      entryClientId,
      entryId: null,
      kind,
      contentType: blob.type || file.type || "image/jpeg",
      byteSize: blob.size,
      tags,
      fieldKey: options?.fieldKey,
    });
    if (!queued.ok) {
      setMessage(queued.reason);
      return null;
    }
    if (exceedsMediaCap(blob.size)) {
      // Belt-and-braces: prepare should have refused this, so quarantine rather than queue.
      const reason = oversizeMediaReason(blob.size, mediaKindLabel(kind));
      await quarantineMedia({ clientId, orgId, metadata: queued.metadata, blob }, reason);
      setMessage(reason);
      await refreshCounts();
      return null;
    }
    await queueMedia({ clientId, orgId, metadata: queued.metadata, blob });
    setMessage(
      options?.fieldKey
        ? "Robot image queued for org-isolated upload"
        : "Media queued separately for bandwidth-safe upload",
    );
    await refreshCounts();
    await sync();
    return clientId;
  }

  async function retryQuarantineItem(clientId: string) {
    await retryQuarantined(clientId);
    await refreshCounts();
    await sync();
  }

  async function discardQuarantineItem(clientId: string) {
    await discardQuarantined(clientId);
    await refreshCounts();
    setMessage("Discarded — it will not sync.");
  }

  async function loadConflicts() {
    const response = await fetch(
      `/api/scouting/disagreements?orgId=${encodeURIComponent(orgId)}&eventKey=${encodeURIComponent(data?.eventKey ?? "")}`,
    );
    if (response.ok) setConflicts(((await response.json()) as { disagreements: [] }).disagreements);
  }

  async function saveFormula() {
    const terms = Object.entries(formulaWeights)
      .filter(([, weight]) => Number.isFinite(weight) && weight !== 0)
      .map(([field, weight]) => ({
        op: "multiply" as const,
        args: [
          { op: "field" as const, field },
          { op: "constant" as const, value: weight },
        ],
      }));
    if (!formulaName.trim() || !terms.length) {
      setMessage("Name the formula and set at least one field weight");
      return;
    }
    const response = await fetch("/api/scouting/formulas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId,
        name: formulaName,
        expression: { op: "add", args: terms },
      }),
    });
    setMessage(response.ok ? "Coach value formula saved" : "Coach role is required to save formulas");
  }

  async function createStarterForms() {
    setMessage("");
    const response = await fetch("/api/scouting/schemas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action: "ensure_defaults" }),
    });
    const body = (await response.json().catch(() => ({}))) as Bootstrap & { error?: string };
    if (!response.ok) {
      setMessage(body.error ?? "Could not create starter forms.");
      return;
    }
    setData(body);
    await cacheEvent(orgId, body);
    setMessage("Starter match and pit forms are ready.");
  }

  async function reviewConflict(id: string, status: "resolved" | "dismissed") {
    if (status === "resolved" && !selectedWinners[id]) {
      setMessage("Pick which scout was right before resolving — that updates pick-desk trust.");
      return;
    }
    const response = await fetch("/api/scouting/disagreements", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId,
        id,
        status,
        winningEntryId: status === "resolved" ? selectedWinners[id] : undefined,
        resolution: { reviewedIn: "scouting-ui" },
      }),
    });
    if (response.ok) {
      setSelectedWinners((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await loadConflicts();
      setMessage(
        status === "resolved"
          ? "Resolved · pick-desk trust updated · coordinators notified"
          : "Dismissed · coordinators notified",
      );
    } else setMessage("Coach role is required to review conflicts");
  }

  function onTabChange(id: string) {
    const next = id as ScoutTab;
    setTab(next);
    if (next === "conflicts") void loadConflicts();
  }

  const shell = classifyScoutingShell({
    loading: loading && !data,
    fetchFailed: fetchFailed && !data?.eventKey,
    orgId,
    eventKey: data?.eventKey,
    hasSchema: Boolean(schema),
  });

  const reloadBootstrap = useCallback(() => {
    setLoading(true);
    setFetchFailed(false);
    setBootstrapStatus(null);
    void (async () => {
      try {
        const response = await fetch(`/api/scouting/bootstrap?orgId=${encodeURIComponent(orgId)}`);
        if (response.ok) {
          const fresh = (await response.json()) as Bootstrap;
          setData(fresh);
          setFromCache(false);
          setFetchFailed(false);
          await cacheEvent(orgId, fresh);
          await loadTrust(fresh.eventKey);
        } else {
          setFetchFailed(true);
          setBootstrapStatus(response.status);
        }
      } catch {
        setFetchFailed(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId, loadTrust]);

  const offlineDetail = scoutingOfflineBannerDetail({
    online,
    syncState,
    pendingEntries: counts.entries,
    pendingMedia: counts.media,
  });

  const formEmptyActions =
    shell === "empty"
      ? scoutingNextActions({
          orgId,
          shell: "empty",
          eventKey: data?.eventKey,
          canManageSchemas: data?.canManageSchemas,
          entryType: type,
        })
      : [];

  if (shell === "loading" || shell === "error" || shell === "setup") {
    return (
      <ScoutingShell
        orgId={orgId}
        shell={shell}
        error={message || undefined}
        errorStatus={bootstrapStatus}
        onRetry={reloadBootstrap}
        embedded={embedded}
      >
        <OfflineBanner
          feature="Scouting"
          fromCache={fromCache}
          force={online && syncState !== "idle" && counts.entries + counts.media > 0}
          variant={syncState === "degraded" ? "degraded" : syncState === "syncing" ? "syncing" : "offline"}
          detail={offlineDetail}
        />
      </ScoutingShell>
    );
  }

  return (
    <main className={`module-page scout-page${embedded ? " is-embedded" : ""}`}>
      {embedded ? (
        <div className="scout-header-meta scout-header-meta-embedded">
          <span className={`scout-sync-pill ${online ? "online" : "offline"}`}>
            {online ? "Online" : "Offline"} · {formatScoutingMetric(counts.entries, true)} queued
          </span>
          <button type="button" className="app-button secondary" onClick={() => void sync()}>
            Sync now
          </button>
        </div>
      ) : (
      <PageHeader
        breadcrumbs="Competition / Scouting"
        title="Scouting"
        description="Match and pit forms stay on this device until you sync."
      >
        <div className="scout-header-meta">
          <ScoutingRelatedStrip orgId={orgId} />
          <CopyShareLink orgId={orgId} />
          <button type="button" className="app-button secondary" onClick={() => window.print()}>
            Print
          </button>
          <span className={`scout-sync-pill ${online ? "online" : "offline"}`}>
            {online ? "Online" : "Offline"} · {formatScoutingMetric(counts.entries, true)} entries ·{" "}
            {formatScoutingMetric(counts.media, true)} media
          </span>
          <button type="button" className="app-button secondary" onClick={() => void sync()}>
            Sync now
          </button>
        </div>
      </PageHeader>
      )}
      <VenueShortcutCheatsheet open={cheatOpen} onClose={() => setCheatOpen(false)} shortcuts={shortcuts} />

      <OfflineBanner
        feature="Scouting"
        fromCache={fromCache}
        force={online && syncState !== "idle" && counts.entries + counts.media > 0}
        variant={syncState === "degraded" ? "degraded" : syncState === "syncing" ? "syncing" : "offline"}
        detail={offlineDetail}
      />

      <ScoutQuarantinePanel
        items={quarantine}
        onRetry={(clientId) => void retryQuarantineItem(clientId)}
        onDiscard={(clientId) => void discardQuarantineItem(clientId)}
      />

      {shell === "empty" && tab !== "conflicts" && tab !== "handoff" && tab !== "trust" ? (
        <>
          <EmptyState
            soft
            className="scout-shell-empty"
            badge="Forms required"
            badgeTone="setup"
            title={`No ${type} scouting form yet`}
            description={
              data?.canManageSchemas
                ? "Create starter match and pit forms for this season, or build a custom form and publish it."
                : "Ask an owner or admin to publish scouting forms for this event."
            }
          >
            {data?.canManageSchemas ? (
              <div className="scout-empty-actions">
                <button className="app-button" type="button" onClick={() => void createStarterForms()}>
                  Create starter forms
                </button>
                <a className="app-button secondary" href={hubHref("/competition", "forms", orgId)}>
                  Custom form builder
                </a>
              </div>
            ) : (
              <a className="app-button" href={hubHref("/competition", "forms", orgId)}>
                Open Form builder
              </a>
            )}
            <a className="app-button secondary" href={withOrgHref("/scouting/lineup", orgId)}>
              Open Coverage
            </a>
            <a className="app-button secondary" href={hubHref("/competition", "strategy", orgId)}>
              Open Strategy
            </a>
            <a className="app-button secondary" href={withOrgHref("/offline", orgId)}>
              Open Offline
            </a>
          </EmptyState>
          <ScoutingNextActionsPanel actions={formEmptyActions} />
        </>
      ) : null}

      {data?.eventKey ? (
        <Panel className="scout-event-strip" style={{ minHeight: "auto", marginBottom: 14 }}>
          <strong>{data.eventKey}</strong>
          <span className="app-muted">Forms and assignments are cached on this device.</span>
        </Panel>
      ) : null}

      <TabBar
        aria-label="Scouting views"
        value={tab}
        onChange={onTabChange}
        tabs={[
          { id: "match", label: "Match" },
          { id: "pit", label: "Pit" },
          { id: "handoff", label: "QR handoff" },
          { id: "conflicts", label: "Conflicts" },
          { id: "trust", label: "Trust & coverage" },
        ]}
      />

      {tab === "trust" ? (
        <ScoutingTrustPanel orgId={orgId} eventKey={data?.eventKey ?? null} />
      ) : tab === "handoff" ? (
        <ScoutHandoffPanel
          orgId={orgId}
          eventKey={data?.eventKey ?? null}
          schemaId={schema?.id ?? null}
          entryType={type === "pit" ? "pit" : "match"}
          onSynced={() => {
            void refreshCounts();
            void sync();
          }}
          onMessage={setMessage}
        />
      ) : tab === "conflicts" ? (
        <Panel className="scout-conflicts-panel">
          <header className="scout-conflicts-heading">
            <div>
              <h2>Which scout was right?</h2>
              <p className="app-muted">
                Pick the winning entry for each field conflict. Coaches resolve; every decision is audited.
              </p>
            </div>
            <button type="button" className="app-button secondary" onClick={() => void loadConflicts()}>
              Refresh
            </button>
          </header>
          {conflicts.length === 0 ? (
            <p className="app-muted">
              No disagreements for this event yet. They appear when two scouts submit overlapping fields.
            </p>
          ) : (
            <ul className="scout-conflict-list">
              {conflicts.map((conflict) => {
                const id = String(conflict.id);
                const status = String(conflict.status);
                const candidates = (Array.isArray(conflict.candidates)
                  ? conflict.candidates
                  : []) as ConflictCandidate[];
                const selected = selectedWinners[id];
                const selectedCandidate = candidates.find((c) => c.entryId === selected);
                const audit = (Array.isArray(conflict.audit) ? conflict.audit : []) as Array<{
                  id: string;
                  action: string;
                  actorName: string;
                  createdAt: string;
                }>;
                return (
                  <li key={id} className={`scout-conflict-card status-${status}`}>
                    <div className="scout-conflict-meta">
                      <strong>
                        {String(conflict.matchKey)} · {String(conflict.teamKey)}
                      </strong>
                      <span className="app-badge">{String(conflict.fieldKey)}</span>
                      <span className={`scout-conflict-status ${status}`}>{status}</span>
                    </div>
                    {status === "open" ? (
                      <>
                        <p className="scout-conflict-prompt">Who got this field right?</p>
                        <div className="scout-winner-grid" role="radiogroup" aria-label="Which scout was right">
                          {candidates.map((candidate) => {
                            const active = selected === candidate.entryId;
                            return (
                              <button
                                key={candidate.entryId}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                className={`scout-winner-option${active ? " selected" : ""}`}
                                onClick={() =>
                                  setSelectedWinners((prev) => ({ ...prev, [id]: candidate.entryId }))
                                }
                              >
                                <em>{candidate.scoutName ?? "Scout"}</em>
                                <strong>
                                  {typeof candidate.value === "string" ||
                                  typeof candidate.value === "number" ||
                                  typeof candidate.value === "boolean"
                                    ? String(candidate.value)
                                    : JSON.stringify(candidate.value)}
                                </strong>
                                <small>{active ? "Selected as right" : "Tap if this scout was right"}</small>
                              </button>
                            );
                          })}
                        </div>
                        {!candidates.length ? (
                          <p className="app-muted">Entry candidates load after refresh.</p>
                        ) : null}
                        <div className="scout-conflict-actions">
                          <button
                            type="button"
                            className="app-button"
                            disabled={!selected}
                            onClick={() => void reviewConflict(id, "resolved")}
                          >
                            {selectedCandidate
                              ? `${selectedCandidate.scoutName ?? "Scout"} was right`
                              : "Pick a scout"}
                          </button>
                          <button
                            type="button"
                            className="app-button secondary"
                            onClick={() => void reviewConflict(id, "dismissed")}
                          >
                            Dismiss
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="scout-conflict-resolved">
                        <p>
                          {conflict.winningScoutName
                            ? `${String(conflict.winningScoutName)} was right`
                            : `Marked ${status}`}
                        </p>
                        <small className="app-muted">
                          {conflict.reviewedByName
                            ? `Reviewed by ${String(conflict.reviewedByName)}`
                            : "Reviewed"}
                          {conflict.reviewedAt
                            ? ` · ${new Date(String(conflict.reviewedAt)).toLocaleString()}`
                            : ""}
                        </small>
                      </div>
                    )}
                    {audit.length ? (
                      <details className="scout-conflict-audit">
                        <summary>Audit trail ({audit.length})</summary>
                        <ol>
                          {audit.map((event) => (
                            <li key={event.id}>
                              <strong>{event.action}</strong>
                              <span>
                                {event.actorName} · {new Date(event.createdAt).toLocaleString()}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      ) : (
        <div className="scout-workbench">
          <Panel as="section" className="scout-form-panel">
            <header className="scout-form-heading">
              <div>
                <h2>{schema?.definition.title ?? `No ${type} form`}</h2>
                <p className="app-muted">Primary action: fill the form, then save.</p>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                {payloadHasDraftContent(payload) || draftSavedAt ? (
                  <span
                    className={`scout-draft-chip ${draftDirty ? "dirty" : draftSavedAt ? "saved" : ""}`}
                    role="status"
                    aria-live="polite"
                  >
                    {draftDirty ? "Unsaved changes" : formatDraftSavedAgo(draftSavedAt)}
                  </span>
                ) : null}
                <span className="app-badge">v{schema?.version ?? "—"}</span>
              </div>
            </header>

            <div className="scout-identity-lock" role="status">
              <span className="eyebrow">{SCOUT_IDENTITY_LOCK_COPY.eyebrow}</span>
              <strong>{data?.scoutIdentity?.displayName ?? "Signed-in member"}</strong>
              <small className="app-muted">
                {SCOUT_IDENTITY_LOCK_COPY.title}
                {data?.scoutIdentity?.userId ? ` · ${data.scoutIdentity.userId.slice(0, 8)}…` : ""}.{" "}
                {SCOUT_IDENTITY_LOCK_COPY.detail}
              </small>
            </div>

            {schemaBudget && schemaBudget.status !== "healthy" ? (
              <p className={`scout-budget-banner ${schemaBudget.status}`} role="status">
                {schemaBudget.message}
              </p>
            ) : null}

            {type === "match" ? (
              <FormRow
                label="Assignment"
                hint={
                  !matchOptions.length
                    ? "No assignments or synced matches yet — sync TBA after the schedule is published."
                    : undefined
                }
              >
                <select
                  value={`${matchKey}|${teamKey}`}
                  onChange={(event) => {
                    const [match, team] = event.target.value.split("|");
                    setMatchKey(match ?? "");
                    setTeamKey(team ?? "");
                  }}
                >
                  <option value="|">Select match and team</option>
                  {matchOptions.map((option) => (
                    <option key={`${option.matchKey}-${option.teamKey}`} value={`${option.matchKey}|${option.teamKey}`}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormRow>
            ) : (
              <FormRow label="Team key">
                <input
                  value={teamKey}
                  onChange={(event) => setTeamKey(event.target.value)}
                  placeholder="frc254"
                />
              </FormRow>
            )}

            {liveConflicts.length ? (
              <div className="scout-official-flags" role="status">
                <strong>Live official checks</strong>
                <ul>
                  {liveConflicts.map((flag) => (
                    <li
                      key={`${flag.fieldKey}-${flag.officialSource}-${flag.status}`}
                      data-status={flag.status}
                      data-soft={flag.soft ? "true" : "false"}
                    >
                      <b>{flag.fieldKey}</b>
                      <span>{flag.detail}</span>
                      {flag.status === "conflict" ? (
                        <small>
                          Scout {JSON.stringify(flag.scoutValue)} · Official {JSON.stringify(flag.officialValue)}
                        </small>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {formFields.map((field) => (
              <Field
                key={field.key}
                field={field}
                value={payload[field.key]}
                flags={flagsByField.get(field.key) ?? []}
                historyHint={fieldConfidenceHint(trustByField.get(field.key))}
                disagreementRate={trustByField.get(field.key)?.disagreementRate ?? null}
                orgId={orgId}
                onChange={(value) => setPayload((current) => ({ ...current, [field.key]: value }))}
                onAttachRobotImage={
                  field.type === "robot_image" || field.widget === "robot_image"
                    ? (file) => attachMedia(file, { fieldKey: field.key, tags: ["robot"] })
                    : undefined
                }
              />
            ))}

            <FormRow label="Scout confidence">
              <select
                value={confidence}
                onChange={(event) => setConfidence(event.target.value as typeof confidence)}
              >
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low — downweighted</option>
              </select>
            </FormRow>

            <ScoutVoiceNotesPanel
              orgId={orgId}
              eventKey={data?.eventKey ?? ""}
              matchKey={matchKey}
              teamKey={teamKey}
              entryType={type}
              pendingEntryClientId={entryClientId}
              formFields={formFields
                .filter(
                  (field) =>
                    field.type !== "robot_image" &&
                    field.widget !== "robot_image" &&
                    // Section headers hold no answer, so a transcript has nowhere to land.
                    !isLayoutOnlyField(field),
                )
                .map((field) => ({ key: field.key, label: field.label }))}
              onApplyToForm={(transcript, fieldKey) => {
                if (!schema) return;
                setSource("voice");
                setPayload((current) =>
                  applyVoiceTranscriptToForm(schema.definition, current, transcript, {
                    fieldKey,
                  }).payload,
                );
              }}
              onStatus={setMessage}
              onQueuedMedia={() => {
                void refreshCounts();
                void sync();
              }}
            />

            {type === "pit" ? (
              <label className="scout-media">
                Queue pit photo/video
                <input
                  type="file"
                  accept="image/*,video/*"
                  onChange={(event) => event.target.files?.[0] && void attachMedia(event.target.files[0])}
                />
              </label>
            ) : null}

            <button type="button" className="app-button" onClick={() => void submit()}>
              Save {online ? "& sync" : "offline"}
            </button>
            {message ? (
              <p className="form-message" role="status">
                {message}
              </p>
            ) : null}
            {saveReceipt ? (
              <div className="scout-save-receipt" role="status">
                <div className="scout-save-receipt-head">
                  <span className="eyebrow">Where your data went</span>
                  <strong>
                    {saveReceipt.entryType === "pit" ? "Pit" : "Match"} entry for{" "}
                    {saveReceipt.teamKey}
                    {saveReceipt.matchKey ? ` · ${saveReceipt.matchKey}` : ""}
                  </strong>
                  <small className="app-muted">
                    {saveReceipt.offline
                      ? "Stored in this device outbox (org-isolated). Identity stays locked to your membership."
                      : "Queued for sync into your org’s scouting tables. Identity stays locked to your membership."}
                  </small>
                </div>
                <ul className="scout-save-next">
                  {scoutingPostSaveNextSteps(orgId, {
                    eventKey: data?.eventKey,
                    entryType: saveReceipt.entryType,
                  }).map((step) => (
                    <li key={step.id}>
                      <a className="app-button secondary" href={step.href}>
                        {step.label}
                      </a>
                      <small className="app-muted">{step.detail}</small>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setSaveReceipt(null)}
                >
                  Dismiss
                </button>
              </div>
            ) : null}
          </Panel>

          <aside className="scout-side">
            <Panel className="scout-activity" style={{ minHeight: "auto" }}>
              <h2 style={{ marginTop: 0 }}>Accuracy leaderboard</h2>
              <p className="app-muted">
                Ranked by TBA-checked accuracy, not form volume. Full board lives under Trust &amp; coverage.
              </p>
              {trust?.leaderboard?.length ? (
                <ol className="scout-accuracy-mini">
                  {trust.leaderboard.slice(0, 5).map((scout, index) => (
                    <li key={scout.userId}>
                      <span className="scout-accuracy-rank">{index + 1}</span>
                      <div>
                        <strong>{scout.name}</strong>
                        <small className="app-muted">
                          {scout.checks} TBA checks · {scout.entries} entries
                        </small>
                      </div>
                      <b>{scout.accuracy == null ? "—" : `${Math.round(scout.accuracy * 100)}%`}</b>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="app-muted">Accuracy ranks appear after TBA score breakdowns validate entries.</p>
              )}
            </Panel>

            <Panel className="scout-activity" style={{ minHeight: "auto" }}>
              <h2 style={{ marginTop: 0 }}>Recent entries</h2>
              <p className="app-muted">
                Latest timestamp wins per entry. Scout identity, confidence, and source stay visible —
                never DEMO entries.
              </p>
              {data?.recentEntries && shouldShowScoutingRecentEntries(data.recentEntries.length) ? (
                <>
                  <ExportButton
                    rows={data.recentEntries}
                    columns={SCOUT_ENTRY_CSV_COLUMNS}
                    feature="Scouting entries"
                    orgLabel={data.eventKey}
                    orgId={orgId}
                    size="sm"
                    provenance={`${
                      data.eventKey ?? "Active event"
                    } — the 30 most recent synced entries only. Anything still queued offline, and the rest of the event, is in the full export.`}
                  />
                  <ul className="scout-entry-list">
                    {data.recentEntries.map((entry) => (
                      <li key={entry.id}>
                        <strong>
                          {entry.matchKey ?? "PIT"} · {entry.teamKey}
                        </strong>
                        <span>
                          {entry.scoutName} · {entry.source}
                        </span>
                        <small className="app-muted">
                          {entry.confidence} confidence · {new Date(entry.updatedAt).toLocaleTimeString()}
                        </small>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="app-muted">No entries yet for this event — nothing is fabricated.</p>
              )}
            </Panel>

            <Panel style={{ minHeight: "auto" }}>
              <button
                type="button"
                className="text-button"
                onClick={() => setShowFormula((open) => !open)}
              >
                {showFormula ? "Hide coach formula" : "Coach value formula"}
              </button>
              {showFormula ? (
                <div className="scout-formula">
                  <p className="app-muted">Optional weighted score from numeric fields. Coach role required to save.</p>
                  <FormRow label="Formula name">
                    <input
                      aria-label="Formula name"
                      placeholder="e.g. Pick value"
                      value={formulaName}
                      onChange={(event) => setFormulaName(event.target.value)}
                    />
                  </FormRow>
                  {schema?.definition.fields
                    .filter(
                      (field) =>
                        // Counters, ratings, and sliders store plain numbers too —
                        // a tap-tallied cycle count is exactly what a pick formula wants.
                        field.type === "number" ||
                        field.type === "counter" ||
                        field.type === "rating" ||
                        field.type === "slider",
                    )
                    .map((field) => (
                      <FormRow key={field.key} label={`${field.label} weight`}>
                        <input
                          type="number"
                          value={formulaWeights[field.key] ?? 0}
                          onChange={(event) =>
                            setFormulaWeights((current) => ({
                              ...current,
                              [field.key]: event.target.valueAsNumber,
                            }))
                          }
                        />
                      </FormRow>
                    ))}
                  <button type="button" className="app-button secondary" onClick={() => void saveFormula()}>
                    Save formula
                  </button>
                </div>
              ) : null}
            </Panel>
          </aside>
        </div>
      )}
    </main>
  );
}

/**
 * Canvas re-encode of a still image so queued photos fit the server media cap
 * (max edge / quality live in lib/scouting/media-downscale.ts with the pure
 * geometry math). Falls back to the original file on any decode failure.
 */
/**
 * The canvas re-encode hands back a bare Blob; prepareScoutMediaFile inspects name/type, so
 * re-wrap it as a File carrying the re-encoded type and a matching extension.
 */
function asMediaFile(blob: Blob, original: File): File {
  if (blob instanceof File) return blob;
  const jpeg = blob.type === "image/jpeg" && original.type !== "image/jpeg";
  const name = jpeg ? `${original.name.replace(/\.[^.]+$/, "")}.jpg` : original.name;
  return new File([blob], name, { type: blob.type || original.type });
}

async function downscaleImageInBrowser(file: File): Promise<Blob> {
  if (!isDownscalableImageType(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const { width, height, scaled } = downscaleDimensions(bitmap.width, bitmap.height);
      // Small-but-heavy files (huge PNGs) still get a JPEG re-encode.
      if (!scaled && !exceedsMediaCap(file.size)) return file;
      if (width < 1 || height < 1) return file;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return file;
      context.drawImage(bitmap, 0, 0, width, height);
      const encoded = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", DOWNSCALE_JPEG_QUALITY),
      );
      if (!encoded || encoded.size === 0) return file;
      return encoded.size < file.size ? encoded : file;
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}

/**
 * Offline-first photo preview: the queued IndexedDB blob when we have it.
 * Offline with no blob is missing — never a server URL that 404s as a broken
 * image, never a DEMO/placeholder jpeg.
 */
function RobotImagePreview({ clientId, orgId }: { clientId: string; orgId: string }) {
  const online = useOnline();
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [hasBlob, setHasBlob] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      const blob = await getQueuedMediaBlob(clientId).catch(() => null);
      if (cancelled) return;
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        setLocalUrl(objectUrl);
        setHasBlob(true);
      } else {
        setLocalUrl(null);
        setHasBlob(false);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [clientId]);
  if (!ready) return <span className="app-muted">Loading photo…</span>;
  const preview = resolveScoutMediaPreview({
    orgId,
    clientId,
    hasLocalBlob: hasBlob,
    online,
    uploaded: !hasBlob && online,
    hasRemoteThumb: false,
  });
  if (preview.status === "local" && localUrl) {
    return <img src={localUrl} alt="Robot" width={72} height={72} />;
  }
  if (preview.status === "remote" && preview.src) {
    return <img src={preview.src} alt="Robot" width={72} height={72} />;
  }
  return (
    <span className="app-muted">
      {preview.status === "missing" ? preview.reason : "This photo is not available."}
    </span>
  );
}

function quarantineItemLabel(item: QuarantinedItem): string {
  if (item.kind === "entry") {
    const entry = item.entry;
    return `${entry.type === "pit" ? "Pit" : "Match"} entry · ${entry.teamKey}${
      entry.matchKey ? ` · ${entry.matchKey}` : ""
    }`;
  }
  const teamKey = typeof item.metadata.teamKey === "string" ? item.metadata.teamKey : "";
  return `${mediaKindLabel(item.metadata.kind)}${teamKey ? ` · ${teamKey}` : ""}`;
}

/** "N entries need attention" — permanently rejected items with Retry/Discard. */
function ScoutQuarantinePanel({
  items,
  onRetry,
  onDiscard,
}: {
  items: QuarantinedItem[];
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
}) {
  if (!items.length) return null;
  return (
    <Panel
      as="section"
      className="scout-quarantine-panel"
      style={{ minHeight: "auto", marginBottom: 14 }}
      aria-label="Entries needing attention"
    >
      <header>
        <h2 style={{ marginTop: 0 }}>
          {items.length} {items.length === 1 ? "entry needs" : "entries need"} attention
        </h2>
        <p className="app-muted">
          Sync rejected these; everything else kept syncing. They stay on this device until you
          retry or discard each one.
        </p>
      </header>
      <ul className="scout-quarantine-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {items.map((item) => (
          <li
            key={item.clientId}
            style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "8px 0" }}
          >
            <div style={{ flex: "1 1 240px", display: "grid", gap: 2 }}>
              <strong>{quarantineItemLabel(item)}</strong>
              <span>{item.reason}</span>
              <small className="app-muted">{new Date(item.quarantinedAt).toLocaleString()}</small>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="app-button secondary"
                onClick={() => onRetry(item.clientId)}
              >
                Retry
              </button>
              <button type="button" className="text-button" onClick={() => onDiscard(item.clientId)}>
                Discard
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Field({
  field,
  value,
  flags,
  historyHint,
  disagreementRate,
  orgId,
  onChange,
  onAttachRobotImage,
}: {
  field: SchemaDefinition["fields"][number];
  value: unknown;
  flags: OfficialFlag[];
  historyHint: string | null;
  disagreementRate: number | null;
  orgId?: string;
  onChange(value: unknown): void;
  onAttachRobotImage?: (file: File) => Promise<string | null>;
}) {
  const conflict = flags.find((flag) => flag.status === "conflict");
  const soft = flags.find((flag) => flag.soft);
  const liveHint = conflict?.detail ?? soft?.detail;
  const historyWarn = (disagreementRate ?? 0) >= 0.18;
  const tone = conflict
    ? "conflict"
    : soft
      ? "soft"
      : flags.some((flag) => flag.status === "match")
        ? "match"
        : historyWarn
          ? "history-warn"
          : undefined;
  const label = `${field.label}${field.required ? " *" : ""}`;
  const isMc =
    field.widget === "mc" ||
    field.type === "multiple_choice";

  async function attachFiles(files: FileList | null) {
    if (!files?.length || !onAttachRobotImage) return;
    const refs = normalizeRobotImageRefs(value);
    const next = [...refs];
    for (const file of Array.from(files)) {
      const clientId = await onAttachRobotImage(file);
      if (clientId) next.push(clientId);
    }
    onChange(next);
  }

  const body = (() => {
    // Studio types first — they own their own label/readout chrome, so they must
    // not fall through into the legacy FormRow renderers below.
    if (isStudioField(field)) {
      return <StudioField field={field} value={value} onChange={onChange} label={label} />;
    }
    if (field.type === "boolean" || field.widget === "yesno") {
      return (
        <label className="soft-form-row check-field">
          <span className="app-muted">{label}</span>
          <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        </label>
      );
    }
    if (field.type === "drivetrain_type" || field.widget === "drivetrain") {
      const options =
        field.options?.length ? field.options : [...DEFAULT_DRIVETRAIN_OPTIONS];
      return (
        <FormRow label={label} hint={field.helpText ?? "Select the robot drivetrain"}>
          <select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
            <option value="">Select drivetrain…</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </FormRow>
      );
    }
    if (field.type === "robot_image" || field.widget === "robot_image") {
      const refs = normalizeRobotImageRefs(value);
      return (
        <FormRow
          label={label}
          hint={field.helpText ?? "Camera or gallery — stored only for this organization"}
        >
          <div className="scout-robot-images">
            {refs.length ? (
              <ul className="scout-robot-image-list">
                {refs.map((ref) => (
                  <li key={ref}>
                    {orgId ? (
                      <RobotImagePreview clientId={ref} orgId={orgId} />
                    ) : (
                      <span className="app-muted">{ref.slice(0, 8)}…</span>
                    )}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        onChange(refs.filter((item) => item !== ref).length ? refs.filter((item) => item !== ref) : undefined)
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="scout-robot-image-actions">
              <label className="scout-media scout-robot-capture">
                Camera
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(event) => {
                    void attachFiles(event.target.files).then(() => {
                      event.target.value = "";
                    });
                  }}
                />
              </label>
              <label className="scout-media scout-robot-capture">
                Gallery
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => {
                    void attachFiles(event.target.files).then(() => {
                      event.target.value = "";
                    });
                  }}
                />
              </label>
            </div>
            <small className="app-muted">Works offline — photos queue on this device until sync.</small>
          </div>
        </FormRow>
      );
    }
    if (isMc) {
      return (
        <FormRow label={label} hint={field.helpText}>
          <div className="scout-mc-row" role="radiogroup" aria-label={field.label}>
            {(field.options ?? []).map((option) => (
              <label key={option} className="scout-mc-option">
                <input
                  type="radio"
                  name={field.key}
                  checked={String(value ?? "") === option}
                  onChange={() => onChange(option)}
                />
                {option}
              </label>
            ))}
          </div>
        </FormRow>
      );
    }
    if (
      field.type === "select" ||
      field.type === "dropdown" ||
      field.type === "multiple_choice"
    ) {
      return (
        <FormRow label={label} hint={field.helpText}>
          <select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
            <option value="">Select…</option>
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </FormRow>
      );
    }
    if (field.widget === "free" || field.type === "long_text") {
      return (
        <FormRow label={label} hint={field.helpText ?? "Long-form notes"}>
          <textarea
            value={String(value ?? "")}
            required={field.required}
            placeholder="Notes…"
            onChange={(event) => onChange(event.target.value)}
          />
        </FormRow>
      );
    }
    if (field.widget === "short" || field.type === "short_answer" || field.type === "text") {
      return (
        <FormRow label={label} hint={field.helpText ?? "Short answer"}>
          <input
            type="text"
            value={String(value ?? "")}
            required={field.required}
            placeholder="Short answer"
            onChange={(event) => onChange(event.target.value)}
          />
        </FormRow>
      );
    }
    return (
      <FormRow label={label} hint={field.helpText}>
        <input
          type={field.type === "number" ? "number" : "text"}
          value={String(value ?? "")}
          required={field.required}
          onChange={(event) =>
            onChange(field.type === "number" ? event.target.valueAsNumber : event.target.value)
          }
        />
      </FormRow>
    );
  })();
  return (
    <div className={`scout-field-wrap${tone ? ` is-${tone}` : ""}`}>
      {body}
      {liveHint ? (
        <p className={`scout-field-flag ${tone ?? ""}`} role="status">
          {liveHint}
        </p>
      ) : null}
      {historyHint ? (
        <p className={`scout-field-trust ${historyWarn ? "warn" : "ok"}`} role="status">
          {historyHint}
        </p>
      ) : null}
    </div>
  );
}
