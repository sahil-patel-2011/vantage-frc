"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MEDIA_ENABLED, MEDIA_PAUSED_MESSAGE } from "../../lib/media-availability";
import { useSearchParams } from "next/navigation";
import type { SyncEntry } from "@vantage/scouting";
import { applyFormResetBehavior } from "@vantage/scouting";
import { isScoutIdentityField } from "@vantage/scouting/identity";
import { lintSchemaBudget, type FieldTrustSummary } from "@vantage/scouting/trust";
import { stripHiddenAnswers, visibleFields, withInferredPhaseRules } from "../../lib/scouting/context-visible";
import { buildScoutTargets, normalizeTeamKey } from "../../lib/scouting/scout-target";
import { apiErrorMessage } from "../../lib/ui/load-failure";
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
import { nextScoutTarget, scoutContext, syncSummary, teamNumberOf } from "../../lib/scouting/scout-context";
import {
  classifyScoutingShell,
  scoutingOfflineBannerDetail,
} from "../../lib/scouting/scouting-related";
import { asMediaFile, downscaleImageInBrowser } from "./scouting-media-browser";
import {
  type Bootstrap,
  type OfficialFlag,
  type SaveReceipt,
  type ScoutTab,
  type TrustSnapshot,
} from "./scouting-model";
import { ScoutingReadyView } from "./scouting-ready-view";
import { ScoutingShell } from "./scouting-chrome";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { clearFeatureSnapshot, getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./scouting-qr.css";


async function persistScoutingSnapshot(orgId: string, data: Bootstrap): Promise<void> {
  if (!orgId) return;
  try {
    await putFeatureSnapshot("scouting", orgId, data);
    await putFeatureSnapshot("scouting", "_", data);
  } catch {
    // Live Scouting already painted; IndexedDB is best-effort.
  }
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
  const [savedHere, setSavedHere] = useState<Array<{ matchKey: string; teamKey: string }>>([]);
  const [confidence, setConfidence] = useState<"high" | "normal" | "low">("normal");
  const [source, setSource] = useState<"manual" | "voice">("manual");
  const [entryClientId, setEntryClientId] = useState(() => stableClientId());
  const online = useOnline();
  const [fromCache, setFromCache] = useState(false);
  const [counts, setCounts] = useState({ entries: 0, media: 0, quarantined: 0 });
  const [quarantine, setQuarantine] = useState<QuarantinedItem[]>([]);
  const [message, setMessage] = useState("");
  const [syncNote, setSyncNote] = useState<string | null>(null);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [bootstrapStatus, setBootstrapStatus] = useState<number | null>(null);
  const [saveReceipt, setSaveReceipt] = useState<SaveReceipt | null>(null);
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
      const uploaded = syncSummary({ entries: entries.count, media: media.synced });
      const conflictCount = entries.validations.filter((flag) => flag.status === "conflict").length;
      const problems = [
        conflictCount
          ? `${conflictCount} official-score disagreement${conflictCount === 1 ? "" : "s"} flagged`
          : null,
        quarantinedNow ? `${quarantinedNow} need${quarantinedNow === 1 ? "s" : ""} attention below` : null,
      ].filter(Boolean);
      if (problems.length) {
        // Something to act on: this stays in the message line by the form.
        setMessage([uploaded, ...problems].filter(Boolean).join(" · "));
      } else if (uploaded) {
        // Plain good news goes beside the queue count, not under Save in the
        // colour the form uses for problems.
        setSyncNote(uploaded);
        // A retry notice from earlier in this sync is no longer true.
        setMessage((current) => (current.startsWith("Sync retry") ? "" : current));
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
      const cachedEvent = await getCachedEvent<Bootstrap>(orgId);
      const cachedSnap = await getFeatureSnapshot<Bootstrap>("scouting", orgId);
      const cached = cachedEvent ?? cachedSnap?.data ?? null;
      if (cached) {
        setData(cached);
        setFromCache(true);
      }
      try {
        const response = await fetch(`/api/scouting/bootstrap?orgId=${encodeURIComponent(orgId)}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        if (response.status === 401 || response.status === 403) {
          setData(null);
          setFromCache(false);
          setFetchFailed(true);
          setBootstrapStatus(response.status);
          // The route says which sign-in method this team allows, or which
          // role is missing. Overwriting that with "Could not load scouting"
          // left the screen with nothing but a 403 to reason from, and a 403
          // alone reads as a role problem — which is what an owner who simply
          // signed in the wrong way was told.
          setMessage((await apiErrorMessage(response)) ?? "Could not load scouting");
          void clearFeatureSnapshot("scouting", orgId);
          void clearFeatureSnapshot("scouting", "_");
        } else if (response.ok) {
          const fresh = (await response.json()) as Bootstrap;
          setData(fresh);
          setFromCache(false);
          setFetchFailed(false);
          await cacheEvent(orgId, fresh);
          await persistScoutingSnapshot(orgId, fresh);
          await loadTrust(fresh.eventKey);
        } else if (cached) {
          setMessage("Using the last copy on this phone — could not refresh.");
        } else {
          setFetchFailed(true);
          setBootstrapStatus(response.status);
          setMessage("Could not load scouting");
        }
      } catch {
        if (cached) {
          setMessage("Using the last copy on this phone");
        } else {
          setFetchFailed(true);
          setMessage("Could not load scouting");
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

  // Assignments are a suggestion, not a fence. They sort first and are marked,
  // and the rest of the schedule stays reachable: a scout given three matches
  // can still record the fourth one they happened to watch.
  const matchOptions = useMemo(
    () =>
      data
        ? buildScoutTargets({ assignments: data.assignments, matches: data.matches })
        : [],
    [data],
  );

  const schema = useMemo(
    () => data?.schemas.find((candidate) => candidate.type === type),
    [data, type],
  );

  const formFields = useMemo(
    () =>
      visibleFields(
        withInferredPhaseRules(
          schema?.definition.fields.filter((field) => !isScoutIdentityField(field)) ?? [],
        ),
        payload,
      ),
    [schema, payload],
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
    const storedTeam = normalizeTeamKey(teamKey);
    if (!data?.eventKey || !schema || !storedTeam || (type === "match" && !matchKey)) {
      setMessage(
        teamKey.trim() && !storedTeam
          ? "That is not a team number."
          : "Choose the event assignment, team, and form",
      );
      return;
    }
    const entry: SyncEntry = {
      clientId: entryClientId,
      orgId,
      type,
      eventKey: data.eventKey,
      matchKey: type === "match" ? matchKey : undefined,
      teamKey: storedTeam,
      schemaId: schema.id,
      payload: stripHiddenAnswers(withInferredPhaseRules(schema.definition.fields), payload),
      confidence,
      source,
      updatedAt: new Date().toISOString(),
    };
    await queueEntry(entry);
    if (type === "match") setSavedHere((current) => [...current, { matchKey, teamKey: storedTeam }]);
    clearScoutDraft(draftKey);
    // formResetBehavior: keep the constants a scout would only retype (station,
    // alliance), step the ones that count up, and drop everything else. The
    // match number box steps too, so the next match is one tap away.
    setPayload(applyFormResetBehavior(schema.definition, payload));
    const savedContext =
      type === "match" ? scoutContext({ matches: data.matches ?? [], matchKey, teamKey: storedTeam }) : null;
    // Your next assignment (match AND robot) when you have one; else the same
    // station in the next scheduled match. A match typed by hand is not on the
    // schedule, so it keeps the old step: the number goes up, the team stays.
    const next =
      type === "match"
        ? nextScoutTarget({
            matches: data.matches ?? [],
            assignments: data.assignments ?? [],
            savedMatchKey: matchKey,
            savedTeamKey: storedTeam,
          })
        : null;
    if (next) {
      setMatchKey(next.matchKey);
      setTeamKey(next.teamKey);
    } else if (type === "match") {
      const stepped = nextMatchKey(matchKey);
      if (stepped) setMatchKey(stepped);
    }
    setSource("manual");
    setEntryClientId(stableClientId());
    setDraftSavedAt(null);
    setDraftDirty(false);
    setSaveReceipt({
      teamKey: storedTeam,
      matchKey: type === "match" ? matchKey : undefined,
      matchLabel: savedContext?.matchLabel ?? null,
      entryType: type,
      offline: !online,
      savedAt: Date.now(),
      next: next
        ? {
            matchLabel: next.matchLabel,
            teamNumber: next.teamKey ? teamNumberOf(next.teamKey) : null,
            stationLabel: next.stationLabel,
          }
        : null,
    });
    // The confirmation says it; a second copy under Save only repeated it.
    setMessage("");
    setSyncNote(null);
    await refreshCounts();
    await sync();
  }

  async function attachMedia(file: File, options?: { fieldKey?: string; tags?: string[] }) {
    if (!MEDIA_ENABLED) { setMessage(MEDIA_PAUSED_MESSAGE); return null; }
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
        ? "Robot photo queued to upload"
        : "Photo queued to upload",
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
        const response = await fetch(`/api/scouting/bootstrap?orgId=${encodeURIComponent(orgId)}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        if (response.status === 401 || response.status === 403) {
          setData(null);
          setFromCache(false);
          setFetchFailed(true);
          setBootstrapStatus(response.status);
          setMessage((await apiErrorMessage(response)) ?? "Could not load scouting");
          void clearFeatureSnapshot("scouting", orgId);
          void clearFeatureSnapshot("scouting", "_");
        } else if (response.ok) {
          const fresh = (await response.json()) as Bootstrap;
          setData(fresh);
          setFromCache(false);
          setFetchFailed(false);
          await cacheEvent(orgId, fresh);
          await persistScoutingSnapshot(orgId, fresh);
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
      savedHere={savedHere}
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
      syncNote={syncNote}
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
