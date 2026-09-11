"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SyncEntry } from "@vantage/scouting";
import { applyFormResetBehavior } from "@vantage/scouting";
import { isScoutIdentityField } from "@vantage/scouting/identity";
import { lintSchemaBudget, type FieldTrustSummary } from "@vantage/scouting/trust";
import { OfflineBanner } from "../../components/offline-banner";
import { useVenueShortcuts } from "../../hooks/use-venue-shortcuts";
import { useOnline } from "../../lib/offline/use-online";
import {
  clearScoutDraft,
  payloadHasDraftContent,
  readScoutDraft,
  scoutDraftStorageKey,
  writeScoutDraft,
} from "../../lib/scouting/draft-autosave";
import {
  cacheEvent,
  discardQuarantined,
  getCachedEvent,
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
  exceedsMediaCap,
  mediaKindLabel,
  oversizeMediaReason,
} from "../../lib/scouting/media-downscale";
import { buildAttachMediaWire } from "../../lib/scouting/attach-media-wire";
import { prepareScoutMediaFile, scoutMediaKind } from "../../lib/scouting/prepare-scout-media";
import { nextMatchKey } from "../../lib/scouting/form-builder";
import {
  classifyScoutingShell,
  scoutingOfflineBannerDetail,
} from "../../lib/scouting/scouting-related";
import { asMediaFile, downscaleImageInBrowser } from "./scouting-media-browser";
import {
  type Bootstrap,
  type OfficialFlag,
  type ScoutTab,
  type TrustSnapshot,
} from "./scouting-model";
import { ScoutingReadyView } from "./scouting-ready-view";
import { ScoutingShell } from "./scouting-chrome";
import "./scouting-qr.css";



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
      setMessage("Choose the event assignment, team, and form");
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
    <ScoutingReadyView
      orgId={orgId}
      embedded={embedded}
      online={online}
      fromCache={fromCache}
      syncState={syncState}
      counts={counts}
      offlineDetail={offlineDetail}
      quarantine={quarantine}
      shell={shell}
      tab={tab}
      type={type}
      data={data}
      schema={schema}
      formFields={formFields}
      schemaBudget={schemaBudget}
      matchOptions={matchOptions}
      matchKey={matchKey}
      teamKey={teamKey}
      payload={payload}
      confidence={confidence}
      entryClientId={entryClientId}
      draftSavedAt={draftSavedAt}
      draftDirty={draftDirty}
      flagsByField={flagsByField}
      trustByField={trustByField}
      liveConflicts={liveConflicts}
      conflicts={conflicts}
      selectedWinners={selectedWinners}
      message={message}
      saveReceipt={saveReceipt}
      showFormula={showFormula}
      formulaName={formulaName}
      formulaWeights={formulaWeights}
      trust={trust}
      cheatOpen={cheatOpen}
      shortcuts={shortcuts}
      setCheatOpen={setCheatOpen}
      setMatchKey={setMatchKey}
      setTeamKey={setTeamKey}
      setPayload={setPayload}
      setConfidence={setConfidence}
      setSource={setSource}
      setSelectedWinners={setSelectedWinners}
      setSaveReceipt={setSaveReceipt}
      setShowFormula={setShowFormula}
      setFormulaName={setFormulaName}
      setFormulaWeights={setFormulaWeights}
      onTabChange={onTabChange}
      sync={sync}
      retryQuarantineItem={retryQuarantineItem}
      discardQuarantineItem={discardQuarantineItem}
      createStarterForms={createStarterForms}
      refreshCounts={refreshCounts}
      loadConflicts={loadConflicts}
      reviewConflict={reviewConflict}
      attachMedia={attachMedia}
      submit={submit}
      saveFormula={saveFormula}
      setMessage={setMessage}
    />
  );
}
