"use client";

import { useRef, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ConfirmProvider, useConfirm } from "../../components/ui";
import type { ScoutSchema, SyncEntry } from "@vantage/scouting";
import { applyFormResetBehavior, recordScoutAction, undoScoutAction, validatePayload } from "@vantage/scouting";
import { answersToSave } from "../../lib/scouting/entry-answers";
import { FreeScoutView } from "./free-scout-view";
import { isScoutIdentityField } from "@vantage/scouting/identity";
import { lintSchemaBudget, type FieldTrustSummary } from "@vantage/scouting/trust";
import { visibleFields, withInferredPhaseRules } from "../../lib/scouting/context-visible";
import { buildScoutTargets, normalizeTeamKey } from "../../lib/scouting/scout-target";
import { apiErrorMessage } from "../../lib/ui/load-failure";
import { OfflineBanner } from "../../components/offline-banner";
import { useVenueShortcuts } from "../../hooks/use-venue-shortcuts";
import { useOnline } from "../../lib/offline/use-online";
import { useScoutQueueRefresh } from "../../lib/scouting/use-queue-refresh";
import {
  clearScoutDraft,
  payloadHasDraftContent,
  readScoutDraft,
  readActiveScoutDraft,
  rememberActiveScoutDraft,
  scoutDraftStorageKey,
  writeScoutDraft,
} from "../../lib/scouting/draft-autosave";
import {
  cacheEvent,
  clearCachedEvent,
  discardQuarantined,
  getCachedEvent,
  listQuarantine,
  listPendingEntries,
  pendingCounts,
  queueEntry,
  retryQuarantined,
  stableClientId,
  syncMediaOutbox,
  syncOutbox,
  type QuarantinedItem,
} from "../../lib/scout-offline";
import { nextMatchKey } from "../../lib/scouting/form-builder";
import { nextScoutTarget, scoutContext, syncSummary, teamNumberOf } from "../../lib/scouting/scout-context";
import {
  classifyScoutingShell,
  scoutingOfflineBannerDetail,
} from "../../lib/scouting/scouting-related";
import { attachScoutingMedia } from "./scouting-media-actions";
import {
  lastMatchNote,
  myReports,
  officialFlagsForReport,
  openAssignment,
  type Bootstrap,
  type MyEntry,
  type OfficialFlag,
  type SaveReceipt,
  type SavedScoutReport,
  type ScoutTab,
  type TrustSnapshot,
} from "./scouting-model";
import { ScoutingReadyView } from "./scouting-ready-view";
import { ScoutingShell } from "./scouting-chrome";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { clearFeatureSnapshot, getFeatureSnapshot } from "../../lib/offline/feature-cache";
import { persistScoutingSnapshot } from "../../lib/scouting/snapshot";
import { cacheLiveScouting } from "../../lib/scouting/live-cache";
import { weightedFormula } from "../../lib/scouting/weighted-formula";
import { useScoutTask } from "./use-scout-task";
import "./scouting-qr.css";

export default function ScoutingClient({ orgId, embedded = false }: { orgId: string; embedded?: boolean }) {
  return <ConfirmProvider key={orgId}><ScoutingWorkspace orgId={orgId} embedded={embedded} /></ConfirmProvider>;
}

function ScoutingWorkspace({ orgId, embedded }: { orgId: string; embedded: boolean }) {
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [matchKey, setMatchKey] = useState("");
  const [teamKey, setTeamKey] = useState("");
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  // Autosave only after an edit; restored and carried answers are not new drafts.
  const [userEdited, setUserEdited] = useState(false);
  const editPayload = useCallback((next: Record<string, unknown> | ((current: Record<string, unknown>) => Record<string, unknown>)) => {
    setUserEdited(true);
    const identity = { id: crypto.randomUUID(), at: new Date().toISOString() };
    setPayload((current) => recordScoutAction(current, typeof next === "function" ? next(current) : next, identity));
  }, []);
  // Local reports can reopen before the server's list catches up.
  const [savedHere, setSavedHere] = useState<SavedScoutReport[]>([]);
  // Wait for live data before choosing a robot; cached assignments may already be covered.
  const [settled, setSettled] = useState(false);
  // After a save with nothing next (the last qual), no robot is picked until the scout taps one.
  const [holdAutoPick, setHoldAutoPick] = useState(false);
  const { tab, setTab, onTabChange } = useScoutTask(() => {
    setTeamKey("");
    setMatchKey("");
    setHoldAutoPick(false);
  });
  // Answers the form keeps for the next robot (formResetBehavior), applied when it opens.
  const carryOverRef = useRef<Record<string, unknown> | null>(null);
  // A saved report to open in the form ("Fix it", or Edit on one of your reports).
  const pendingLoadRef = useRef<{
    key: string;
    clientId: string;
    schemaId?: string;
    schema?: ScoutSchema;
    source?: "manual" | "voice";
    savedAt?: string;
    payload: Record<string, unknown>;
    confidence: "high" | "normal" | "low";
    message?: string;
  } | null>(null);
  // Editing a pit report switches to the Pit form without dropping its team.
  const keepTeamOnSwitchRef = useRef(false);
  const [confidence, setConfidence] = useState<"high" | "normal" | "low">("normal");
  const [source, setSource] = useState<"manual" | "voice">("manual");
  const [entryClientId, setEntryClientId] = useState(() => stableClientId());
  const [pinnedForm, setPinnedForm] = useState<{ key: string; id: string } | null>(null);
  const [recoveredForm, setRecoveredForm] = useState<{ key: string; schema: ScoutSchema } | null>(null);
  const [formRecovery, setFormRecovery] = useState<{ key: string; id: string; error: boolean } | null>(null);
  const [formRecoveryAttempt, setFormRecoveryAttempt] = useState(0);
  // Corrections reuse the saved report's id; switching robots clears it.
  const editingRef = useRef<{ clientId: string; key: string | null } | null>(null);
  const online = useOnline();
  const [fromCache, setFromCache] = useState(false);
  const [counts, setCounts] = useState({ entries: 0, media: 0, quarantined: 0 });
  const [quarantine, setQuarantine] = useState<QuarantinedItem[]>([]);
  const [message, setMessage] = useState("");
  const [validationScope, setValidationScope] = useState<string | null>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const leadActionInFlight = useRef(false);
  const [leadAction, setLeadAction] = useState<string | null>(null);
  const workspaceAlive = useRef(true);
  useEffect(() => { workspaceAlive.current = true; return () => { workspaceAlive.current = false; }; }, []);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [bootstrapStatus, setBootstrapStatus] = useState<number | null>(null);
  const [saveReceipt, setSaveReceipt] = useState<SaveReceipt | null>(null);
  // The entry just saved, so "Fix it" can put it back in the form. Saving again with the
  // same client id replaces it: the server lets the author update their own entry.
  const [lastSaved, setLastSaved] = useState<{
    clientId: string;
    type: "match" | "pit";
    eventKey: string;
    userId?: string;
    schemaId: string;
    schema: ScoutSchema;
    matchKey: string;
    teamKey: string;
    payload: Record<string, unknown>;
    confidence: "high" | "normal" | "low";
  } | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "degraded">("idle");
  const [conflicts, setConflicts] = useState<Array<Record<string, unknown>>>([]);
  const [queuedReports, setQueuedReports] = useState<SyncEntry[]>([]);
  const [conflictsStatus, setConflictsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const conflictRequestVersion = useRef(0);
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
  const reportScope = data?.scoutIdentity?.userId && data.eventKey ? `${data.scoutIdentity.userId}:${data.eventKey}` : null;
  const previousReportScope = useRef(reportScope);
  const reportScopeRef = useRef(reportScope);
  reportScopeRef.current = reportScope;
  useLayoutEffect(() => {
    if (previousReportScope.current === reportScope) return;
    const hadScope = previousReportScope.current !== null;
    previousReportScope.current = reportScope;
    setSavedHere([]);
    setLastSaved(null);
    setSaveReceipt(null);
    conflictRequestVersion.current += 1;
    setConflicts([]);
    setQueuedReports([]);
    setConflictsStatus("idle");
    setSelectedWinners({});
    setTrust(null);
    setOfficialFlags([]);
    setSyncState("idle");
    setSyncNote(null);
    if (hadScope) {
      pendingLoadRef.current = null;
      carryOverRef.current = null;
      setMatchKey("");
      setTeamKey("");
      setMessage("");
    }
  }, [reportScope]);
  // Preserve a linked pit team or report; ordinary task changes start fresh.
  const previousType = useRef(type);
  useEffect(() => {
    if (previousType.current === type) return;
    previousType.current = type;
    if (keepTeamOnSwitchRef.current) {
      keepTeamOnSwitchRef.current = false;
      return;
    }
    if (type === "pit" && !searchParams.get("teamKey")) setTeamKey("");
  }, [type, searchParams]);

  // Going offline: "Uploaded 1 entry" from the last save read as if the next save would upload.
  useEffect(() => {
    if (!online) setSyncNote(null);
  }, [online]);

  const refreshCounts = useCallback(async () => {
    const scope = reportScopeRef.current;
    try {
      const [nextCounts, nextQuarantine, nextQueued] = await Promise.all([pendingCounts(orgId), listQuarantine(orgId), listPendingEntries(orgId)]);
      if (!workspaceAlive.current || reportScopeRef.current !== scope) return;
      setCounts(nextCounts);
      setQuarantine(nextQuarantine);
      setQueuedReports(nextQueued);
    } catch {
      if (workspaceAlive.current && reportScopeRef.current === scope) setMessage("Could not read this device’s saved reports. Keep unsaved answers open and check device storage before saving.");
    }
  }, [orgId]);
  useScoutQueueRefresh(refreshCounts);
  useEffect(() => { if (reportScope) void refreshCounts(); }, [reportScope, refreshCounts]);
  const loadTrust = useCallback(async (eventKey: string | null | undefined, signal?: AbortSignal) => {
    if (!orgId || !eventKey || !navigator.onLine) return;
    const scope = reportScopeRef.current;
    try {
      const params = new URLSearchParams({ orgId, eventKey });
      const response = await fetch(`/api/scouting/trust?${params}`, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]) : AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      if (!response.ok || signal?.aborted) return;
      const body = (await response.json()) as TrustSnapshot;
      if (signal?.aborted || !workspaceAlive.current || reportScopeRef.current !== scope) return;
      setTrust({ fieldTrust: body.fieldTrust ?? [], leaderboard: body.leaderboard ?? [] });
    } catch {
      /* keep last-good field confidence */
    }
  }, [orgId]);
  // After an upload, the team's data again, quietly, so the "Done" ticks and your reports include
  // what was just sent. The list used to refresh only on reload.
  const refreshLive = useCallback(async () => {
    if (!orgId || !navigator.onLine) return;
    const scope = reportScopeRef.current;
    try {
      const response = await fetch(`/api/scouting/bootstrap?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      if (!response.ok) return;
      const fresh = (await response.json()) as Bootstrap;
      if (!workspaceAlive.current || reportScopeRef.current !== scope) return;
      setData(fresh);
      setFromCache(false);
      await cacheEvent(orgId, fresh);
      await persistScoutingSnapshot(orgId, fresh);
    } catch {
      // Keep what is on screen; the next save or reload tries again.
    }
  }, [orgId]);
  const sync = useCallback(async () => {
    if (!orgId || !navigator.onLine) return;
    const scope = reportScopeRef.current;
    const isCurrent = () => workspaceAlive.current && reportScopeRef.current === scope;
    setSyncState("syncing");
    try {
      const entries = await syncOutbox(orgId, {
        onRetry: (n, delayMs) => {
          if (!isCurrent()) return;
          setSyncState("degraded");
          setMessage(`Couldn't reach the team yet. Trying again in ${Math.round(delayMs / 1000)}s; your entries are safe on this phone.`);
        },
      });
      const media = await syncMediaOutbox(orgId);
      if (!isCurrent()) return;
      setOfficialFlags(entries.validations);
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
        setMessage((current) => (current.startsWith("Couldn't reach the team yet") ? "" : current));
      }
      setSyncState("idle");
      await refreshCounts();
      if (entries.count > 0) void refreshLive();
    } catch (error) {
      if (!isCurrent()) return;
      setSyncState(navigator.onLine ? "degraded" : "idle");
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "Not sent yet. Your entries are saved on this phone and send when the signal is better.",
      );
    }
  }, [orgId, refreshCounts, refreshLive]);

  useEffect(() => {
    const lifecycle = new AbortController();
    let accessDenied = false;
    void (async () => {
      setLoading(true);
      setFetchFailed(false);
      setBootstrapStatus(null);
      // Optional read caches must not stop online scouting when device storage fails.
      const [eventResult, snapshotResult] = await Promise.allSettled([
        getCachedEvent<Bootstrap>(orgId), getFeatureSnapshot<Bootstrap>("scouting", orgId),
      ]);
      if (lifecycle.signal.aborted) return;
      const cachedEvent = eventResult.status === "fulfilled" ? eventResult.value : null;
      const cachedSnap = snapshotResult.status === "fulfilled" ? snapshotResult.value : null;
      const cached = cachedEvent ?? cachedSnap?.data ?? null;
      if (cached) {
        setData(cached);
        setFromCache(true);
      }
      try {
        const response = await fetch(`/api/scouting/bootstrap?orgId=${encodeURIComponent(orgId)}`, {
          cache: "no-store",
          signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]),
        });
        if (lifecycle.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          accessDenied = true;
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
          await Promise.allSettled([
            clearCachedEvent(orgId), clearFeatureSnapshot("scouting", orgId), clearFeatureSnapshot("scouting", "_"),
          ]);
        } else if (response.ok) {
          const fresh = (await response.json()) as Bootstrap;
          if (lifecycle.signal.aborted) return;
          setData(fresh);
          setFromCache(false);
          setFetchFailed(false);
          const cacheNotice = await cacheLiveScouting(orgId, fresh);
          if (cacheNotice) setMessage(cacheNotice);
          await loadTrust(fresh.eventKey, lifecycle.signal);
        } else if (cached) {
          setMessage("Using the last copy on this phone — could not refresh.");
        } else {
          setFetchFailed(true);
          setBootstrapStatus(response.status);
          setMessage("Could not load scouting");
        }
      } catch {
        if (lifecycle.signal.aborted) return;
        if (cached) {
          setMessage("Using the last copy on this phone");
        } else {
          setFetchFailed(true);
          setMessage("Could not load scouting");
        }
      } finally {
        if (!lifecycle.signal.aborted) { setLoading(false); setSettled(true); }
      }
      if (lifecycle.signal.aborted) return;
      await refreshCounts();
      if (lifecycle.signal.aborted || accessDenied) return;
      await sync();
    })();
    const handleOnline = () => {
      if (!accessDenied) void sync();
    };
    window.addEventListener("online", handleOnline);
    return () => {
      lifecycle.abort();
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

  // Fetch disagreements for both task switches and notification deep links.
  const conflictsEventKey = data?.eventKey ?? "";
  useEffect(() => {
    if (tab !== "conflicts" || !orgId || !conflictsEventKey) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), FEATURE_API_TIMEOUT_MS);
    const version = ++conflictRequestVersion.current;
    let cancelled = false;
    setConflictsStatus("loading");
    void (async () => {
      try {
        const response = await fetch(`/api/scouting/disagreements?${new URLSearchParams({ orgId, eventKey: conflictsEventKey })}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !Array.isArray(body?.disagreements)) throw new Error("Conflict history unavailable");
        if (!cancelled && conflictRequestVersion.current === version) {
          setConflicts(body.disagreements);
          setConflictsStatus("ready");
        }
      } catch {
        if (!cancelled && conflictRequestVersion.current === version) setConflictsStatus("error");
      } finally { window.clearTimeout(timeout); }
    })();
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout); };
  }, [tab, orgId, conflictsEventKey, reportScope]);

  // The robot picked for you: only once the live team data has arrived (or could not), so it is
  // never chosen from an old copy on the phone that forgot what you already scouted.
  useEffect(() => {
    if (!settled || holdAutoPick || !data || matchKey || searchParams.get("matchKey")) return;
    if (data.scoutIdentity?.userId && data.eventKey && !searchParams.get("teamKey") && !searchParams.get("scoutTab")) {
      const active = readActiveScoutDraft({ userId: data.scoutIdentity.userId, orgId, eventKey: data.eventKey });
      const manualSuffix = active?.matchKey.slice(data.eventKey.length);
      const validManual = active?.matchKey.startsWith(`${data.eventKey}_`) && /^_(qm|qf|sf|f)[1-9]\d{0,2}$/.test(manualSuffix ?? "");
      if (active && normalizeTeamKey(active.teamKey) && (active.type === "pit" || validManual || data.matches.some(match => match.matchKey === active.matchKey))) {
        if (active.type !== type) keepTeamOnSwitchRef.current = true;
        setTab(active.type);
        setMatchKey(active.matchKey);
        setTeamKey(active.teamKey);
        return;
      }
    }
    if (type !== "match") return;
    const assignment = openAssignment(data, Date.now());
    if (assignment) {
      setMatchKey(assignment.matchKey);
      setTeamKey(assignment.teamKey);
    }
  }, [settled, holdAutoPick, data, matchKey, searchParams, orgId, type]);

  // A robot picked by hand (or by the app) lets the picker choose again after the next save.
  useEffect(() => {
    if (matchKey) setHoldAutoPick(false);
  }, [matchKey]);

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

  const latestSchema = useMemo(
    () => data?.schemas.find((candidate) => candidate.type === type),
    [data, type],
  );
  const draftKey = useMemo(() => scoutDraftStorageKey({
    userId: data?.scoutIdentity?.userId, orgId, eventKey: data?.eventKey ?? "", entryType: type, matchKey, teamKey,
  }), [orgId, data?.eventKey, data?.scoutIdentity?.userId, type, matchKey, teamKey]);
  const schema = pinnedForm?.key === draftKey
    ? data?.schemas.find(candidate => candidate.id === pinnedForm.id && candidate.type === type)
      ?? (recoveredForm?.key === draftKey && recoveredForm.schema.id === pinnedForm.id && recoveredForm.schema.type === type ? recoveredForm.schema : undefined)
    : latestSchema;

  const currentOfficialFlags = useMemo(() => officialFlagsForReport(officialFlags, {
    clientId: entryClientId, orgId, eventKey: data?.eventKey, type, matchKey,
    teamKey: normalizeTeamKey(teamKey), schemaId: schema?.id,
  }), [officialFlags, entryClientId, orgId, data?.eventKey, type, matchKey, teamKey, schema?.id]);
  const flagsByField = useMemo(() => {
    const map = new Map<string, OfficialFlag[]>();
    for (const flag of currentOfficialFlags) {
      const list = map.get(flag.fieldKey) ?? [];
      list.push(flag);
      map.set(flag.fieldKey, list);
    }
    return map;
  }, [currentOfficialFlags]);
  const liveConflicts = useMemo(
    () => currentOfficialFlags.filter((flag) => flag.status === "conflict" || (flag.soft && flag.detail)),
    [currentOfficialFlags],
  );

  // A published update must not reinterpret an open draft or a correction. Resolve
  // an older form once per target/version, with cancellation and a bounded wait.
  useEffect(() => {
    if (!draftKey || pinnedForm?.key !== draftKey || schema) return;
    const lifecycle = new AbortController();
    const timer = window.setTimeout(() => lifecycle.abort(), FEATURE_API_TIMEOUT_MS);
    let cancelled = false;
    const { id } = pinnedForm;
    setFormRecovery({ key: draftKey, id, error: false });
    void (async () => {
      try {
        const response = await fetch(`/api/scouting/schemas?${new URLSearchParams({ orgId, schemaId: id })}`, { signal: lifecycle.signal, cache: "no-store" });
        if (!response.ok) throw new Error("The original form could not be loaded.");
        const result = await response.json() as { schemas?: ScoutSchema[] };
        const original = result.schemas?.find(candidate => candidate.id === id && candidate.orgId === orgId && candidate.type === type && Array.isArray(candidate.definition?.fields));
        if (!original) throw new Error("The original form is unavailable.");
        if (!cancelled) {
          setRecoveredForm({ key: draftKey, schema: original });
          setFormRecovery(null);
        }
      } catch {
        if (!cancelled) setFormRecovery({ key: draftKey, id, error: true });
      } finally { window.clearTimeout(timer); }
    })();
    return () => { cancelled = true; window.clearTimeout(timer); lifecycle.abort(); };
  }, [draftKey, pinnedForm, schema, orgId, type, data?.schemas, formRecoveryAttempt]);
  const formRecoveryStatus = pinnedForm?.key === draftKey && !schema
    ? formRecovery?.key === draftKey && formRecovery.id === pinnedForm.id && formRecovery.error ? "error" : "loading"
    : null;

  const phaseFields = useMemo(() => withInferredPhaseRules(
    schema?.definition.fields.filter(field => !isScoutIdentityField(field)) ?? [],
  ), [schema]);
  const formFields = useMemo(() => visibleFields(phaseFields, payload), [phaseFields, payload]);

  const schemaBudget = useMemo(
    () => (schema ? lintSchemaBudget(schema.definition) : null),
    [schema],
  );

  const trustByField = useMemo(() => {
    const map = new Map<string, FieldTrustSummary>();
    for (const row of trust?.fieldTrust ?? []) map.set(row.fieldKey, row);
    return map;
  }, [trust]);

  const validationProblems = useMemo(() => validationScope !== null && validationScope === draftKey && schema
    ? validatePayload(schema.definition, answersToSave(schema.definition.fields, payload)) : [], [validationScope, draftKey, schema, payload]);
  const saveContext = useMemo(() => ({ draftKey, schemaId: schema?.id, userId: data?.scoutIdentity?.userId, eventKey: data?.eventKey, payload, confidence, source, entryClientId }),
    [draftKey, schema?.id, data?.scoutIdentity?.userId, data?.eventKey, payload, confidence, source, entryClientId]);
  const saveContextRef = useRef(saveContext);
  saveContextRef.current = saveContext;

  // Restore the selected draft, requested correction or carried answers.
  useLayoutEffect(() => {
    // Restore before the new robot's controls can receive a tap. A passive reset
    // could replace an answer entered immediately after choosing the robot.
    setLoadedDraftKey(draftKey);
    setValidationScope(null);
    setUserEdited(false);
    // A note about the robot that was on screen does not carry over to the next one.
    setMessage((current) =>
      current.startsWith("You already scouted") || current.startsWith("Editing your report") ? "" : current,
    );
    if (!draftKey) {
      editingRef.current = null;
      setEntryClientId(stableClientId());
      setPinnedForm(null);
      setPayload({});
      setConfidence("normal");
      setSource("manual");
      setDraftSavedAt(null);
      setDraftDirty(false);
      return;
    }
    const carry = carryOverRef.current;
    carryOverRef.current = null;
    const pending = pendingLoadRef.current;
    if (pending && pending.key === draftKey) {
      pendingLoadRef.current = null;
      editingRef.current = { clientId: pending.clientId, key: draftKey };
      setEntryClientId(pending.clientId);
      setPinnedForm(pending.schemaId ? { key: draftKey, id: pending.schemaId } : latestSchema ? { key: draftKey, id: latestSchema.id } : null);
      setRecoveredForm(pending.schema ? { key: draftKey, schema: pending.schema } : null);
      setSource(pending.source ?? "manual");
      setPayload(pending.payload);
      setConfidence(pending.confidence);
      if (pending.message) setMessage(pending.message);
      setDraftSavedAt(pending.savedAt ?? null);
      setDraftDirty(false);
      return;
    }
    const storedDraft = readScoutDraft(draftKey);
    const existing = storedDraft && normalizeTeamKey(storedDraft.teamKey) === normalizeTeamKey(teamKey)
      && (type === "pit" || storedDraft.matchKey === matchKey) ? storedDraft : null;
    editingRef.current = null;
    setEntryClientId(existing?.clientId ?? stableClientId());
    setPinnedForm(existing?.schemaId ? { key: draftKey, id: existing.schemaId } : latestSchema ? { key: draftKey, id: latestSchema.id } : null);
    setRecoveredForm(existing?.schema?.orgId === orgId && existing.schema.type === type ? { key: draftKey, schema: existing.schema } : null);
    if (existing) {
      setPayload(existing.payload);
      setConfidence(existing.confidence);
      setSource(existing.source ?? "manual");
      setDraftSavedAt(existing.savedAt);
      setDraftDirty(false);
      return;
    }
    setPayload(carry ?? {});
    setConfidence("normal");
    setSource("manual");
    setDraftSavedAt(null);
    setDraftDirty(false);
  }, [draftKey]);

  useLayoutEffect(() => {
    if (draftKey && loadedDraftKey === draftKey && latestSchema && pinnedForm?.key !== draftKey) setPinnedForm({ key: draftKey, id: latestSchema.id });
  }, [draftKey, loadedDraftKey, latestSchema, pinnedForm]);

  // Picking a robot already scouted loads the author's report instead of a blank form;
  // tapping a "Done" robot used to start over, and saving made a second report. Your reports are
  // all of them (not the team's latest 30), and the check runs again when fresh data arrives for
  // the robot on screen, as long as nothing has been typed yet.
  const mine = useMemo(() => myReports(data, queuedReports), [data, queuedReports]);
  useEffect(() => {
    // Refresh before restoring cached answers so newer corrections can arrive.
    if (!settled || loadedDraftKey !== draftKey || editingRef.current || !draftKey) return;
    const storedTeam = normalizeTeamKey(teamKey);
    const report = mine.find(
      (entry) => entry.type === type && (type === "pit" || entry.matchKey === matchKey) && entry.teamKey === storedTeam && entry.clientId,
    );
    // Saved on this phone but not synced yet (offline), or not in the list yet.
    const local = report || type !== "match"
      ? null
      : [...savedHere].reverse().find((entry) => entry.matchKey === matchKey && entry.teamKey === storedTeam) ?? null;
    const found = report?.clientId
      ? { clientId: report.clientId, schemaId: report.schemaId, payload: report.payload ?? {}, confidence: report.confidence }
      : local;
    if (!found) return;
    const draft = readScoutDraft(draftKey);
    // A newer local draft wins over the server's answers, but a legacy draft
    // still needs the saved report ID to avoid duplicating its correction.
    if (draft?.clientId && draft.clientId !== found.clientId) return;
    if (userEdited && entryClientId !== found.clientId) return;
    editingRef.current = { clientId: found.clientId, key: draftKey };
    setEntryClientId(found.clientId);
    if (draft?.schemaId || found.schemaId) setPinnedForm({ key: draftKey, id: draft?.schemaId ?? found.schemaId! });
    if (draft || userEdited) return;
    setPayload(found.payload);
    if (found.confidence === "high" || found.confidence === "normal" || found.confidence === "low") setConfidence(found.confidence);
    setMessage(
      `You already scouted ${teamNumberOf(storedTeam ?? teamKey)}${type === "match" ? " in this match" : " in the pit"}. Change what's wrong, then Save; it replaces your report.`,
    );
  }, [draftKey, loadedDraftKey, mine, savedHere, userEdited, entryClientId, type, matchKey, teamKey, settled]);
  // A draft is only what the scout typed: never a report loaded to be corrected.
  useEffect(() => {
    // A commit that changed the robot still contains the previous form's state.
    // It must never write those answers under the newly selected robot's key.
    if (!draftKey || loadedDraftKey !== draftKey || !userEdited || !payloadHasDraftContent(payload)) return;
    setDraftDirty(true);
    {
      const savedAt = writeScoutDraft(draftKey, {
        payload,
        confidence,
        matchKey,
        teamKey,
        clientId: entryClientId,
        schemaId: schema?.id ?? (pinnedForm?.key === draftKey ? pinnedForm.id : undefined),
        schema,
        source,
      });
      if (savedAt && data?.scoutIdentity?.userId && data.eventKey) {
        rememberActiveScoutDraft({ userId: data.scoutIdentity.userId, orgId, eventKey: data.eventKey },
          { key: draftKey, type, matchKey, teamKey });
      }
      if (savedAt) {
        setDraftSavedAt(savedAt);
        setDraftDirty(false);
      }
    }
  }, [draftKey, loadedDraftKey, userEdited, payload, confidence, matchKey, teamKey, entryClientId, schema, pinnedForm, source, data?.scoutIdentity?.userId, data?.eventKey, orgId, type]);

  useEffect(() => {
    if (!draftDirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [draftDirty]);

  // Verify the last edit is recoverable before switching targets. A full or
  // disabled storage area must leave the unsaved form open, never silently drop it.
  function preserveCurrentDraft(): boolean {
    if (!userEdited || !payloadHasDraftContent(payload)) return true;
    if (!draftKey || loadedDraftKey !== draftKey) {
      setMessage("Choose the robot before recording answers.");
      return false;
    }
    const savedAt = writeScoutDraft(draftKey, { payload, confidence, matchKey, teamKey, clientId: entryClientId,
      schemaId: schema?.id ?? (pinnedForm?.key === draftKey ? pinnedForm.id : undefined), schema, source });
    if (!savedAt) {
      setDraftDirty(true);
      setMessage("Keep this report open. Device storage is unavailable; save the report or restore storage before choosing another robot.");
      return false;
    }
    setDraftSavedAt(savedAt);
    setDraftDirty(false);
    return true;
  }

  function pickTarget(nextMatch: string, nextTeam: string): boolean {
    if (nextMatch === matchKey && nextTeam === teamKey) return true;
    if (!preserveCurrentDraft()) return false;
    setMessage("");
    setMatchKey(nextMatch);
    setTeamKey(nextTeam);
    return true;
  }

  async function submit() {
    if (saveInFlight.current) return;
    const storedTeam = normalizeTeamKey(teamKey);
    if (!data?.eventKey || !schema || !storedTeam || (type === "match" && !matchKey)) {
      setMessage(
        teamKey.trim() && !storedTeam
          ? "That is not a team number."
          : "Choose the event assignment, team, and form",
      );
      return;
    }
    const answers = answersToSave(schema.definition.fields, payload);
    // The same checks the team's server runs, before anything is queued: an entry it would refuse
    // used to be saved here, then set aside with "Entry rejected" once it reached the team.
    const problems = validatePayload(schema.definition, answers);
    if (problems.length) {
      setValidationScope(draftKey);
      setValidationAttempt(current => current + 1);
      setMessage("");
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
      payload: answers,
      confidence,
      source,
      updatedAt: new Date().toISOString(),
    };
    saveInFlight.current = true;
    setSaving(true);
    try {
      await queueEntry(entry);
    } catch (error) {
      setMessage(error instanceof Error ? `Not saved yet. ${error.message}` : "Not saved yet. Device storage is unavailable; keep this form open and retry.");
      saveInFlight.current = false;
      setSaving(false);
      return;
    }
    if (saveContextRef.current !== saveContext) {
      // The captured report was persisted, but a later target/answer owns the
      // visible form. Never clear its draft or advance it using the older save.
      if (saveContextRef.current.userId !== saveContext.userId || !saveContextRef.current.eventKey) {
        saveInFlight.current = false;
        setSaving(false);
        return;
      }
      if (type === "match" && saveContextRef.current.eventKey === entry.eventKey) {
        setSavedHere(current => [
          ...current.filter(row => !(row.matchKey === entry.matchKey && row.teamKey === storedTeam)),
          { matchKey, teamKey: storedTeam, clientId: entry.clientId, schemaId: schema.id, payload: answers, confidence },
        ]);
      }
      setMessage(`Saved team ${teamNumberOf(storedTeam)} on this device. Your current answers stayed open; save again to include any newer edits.`);
      saveInFlight.current = false;
      setSaving(false);
      void refreshCounts();
      void sync();
      return;
    }
    setLastSaved({ clientId: entryClientId, type, eventKey: data.eventKey, userId: data.scoutIdentity?.userId, schemaId: schema.id, schema, matchKey, teamKey, payload: answers, confidence });
    setValidationScope(null);
    if (type === "match") {
      setSavedHere((current) => [
        ...current.filter((row) => !(row.matchKey === matchKey && row.teamKey === storedTeam)),
        { matchKey, teamKey: storedTeam, clientId: entryClientId, schemaId: schema.id, payload: answers, confidence },
      ]);
    }
    const draftCleared = clearScoutDraft(draftKey);
    // Apply the form's carry/reset rules when the next robot opens.
    const kept = applyFormResetBehavior(schema.definition, payload);
    carryOverRef.current = kept;
    setPayload(kept);
    setUserEdited(false);
    const savedContext =
      type === "match" ? scoutContext({ matches: data.matches ?? [], matchKey, teamKey: storedTeam }) : null;
    // Your next assignment (match AND robot) you have not scouted; else the same
    // station in the next scheduled match. A match typed by hand is not on the
    // schedule, so it keeps the old step: the number goes up, the team stays.
    const next =
      type === "match"
        ? nextScoutTarget({
            matches: data.matches ?? [],
            assignments: data.assignments ?? [],
            savedMatchKey: matchKey,
            savedTeamKey: storedTeam,
            done: (nextMatch, nextTeam) =>
              (nextMatch === matchKey && nextTeam === storedTeam) ||
              savedHere.some((entry) => entry.matchKey === nextMatch && entry.teamKey === nextTeam) ||
              mine.some((entry) => entry.type === "match" && entry.matchKey === nextMatch && entry.teamKey === nextTeam),
          })
        : null;
    let note: string | null = draftCleared ? null : "The report is saved. Its draft copy could not be cleared on this device.";
    if (next) {
      setMatchKey(next.matchKey);
      setTeamKey(next.teamKey);
    } else if (type === "match") {
      // Only onto a match the schedule has: after the last qual this stepped to "Qual 37", which
      // does not exist, with the same robot ready to be scouted again.
      const stepped = nextMatchKey(matchKey);
      const scheduled = (data.matches ?? []).length === 0 || (data.matches ?? []).some((match) => match.matchKey === stepped);
      if (stepped && scheduled) setMatchKey(stepped);
      else {
        // Nothing comes next: say so, and leave the robot for the scout to pick. It used to jump
        // back to a robot in an earlier match, "Save this match" ready.
        setHoldAutoPick(true);
        setMatchKey("");
        setTeamKey("");
        note = [note, lastMatchNote(data.matches ?? [], matchKey)].filter(Boolean).join(" ") || null;
      }
    } else if (type === "pit") {
      // A pit report is one team: the next one starts blank (a chip above fills the next team in),
      // so the next pit's answers cannot land under the team just saved.
      setTeamKey("");
    }
    setSource("manual");
    editingRef.current = null;
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
      note,
    });
    // The confirmation says it; a second copy under Save only repeated it.
    setMessage("");
    setSyncNote(null);
    // Finish the local save before syncing so slow Wi-Fi never blocks the next robot.
    saveInFlight.current = false;
    setSaving(false);
    void refreshCounts();
    void sync();
  }

  /** Open a saved report in the form; saving replaces it. */
  function openSavedReport(report: {
    clientId: string;
    schemaId?: string;
    schema?: ScoutSchema;
    type: "match" | "pit";
    matchKey: string | null;
    teamKey: string;
    payload: Record<string, unknown>;
    confidence: "high" | "normal" | "low";
    message: string;
  }) {
    const key = scoutDraftStorageKey({
      userId: data?.scoutIdentity?.userId,
      orgId,
      eventKey: data?.eventKey ?? "",
      entryType: report.type,
      matchKey: report.matchKey ?? undefined,
      teamKey: report.teamKey,
    });
    if (!key) return;
    if (key === draftKey && (userEdited || draftSavedAt)) {
      setMessage("Your current corrections are already open. Save them when they are ready; the saved report has not replaced your draft.");
      return;
    }
    if (!preserveCurrentDraft()) return;
    const stored = readScoutDraft(key);
    const draft = stored && normalizeTeamKey(stored.teamKey) === normalizeTeamKey(report.teamKey)
      && (report.type === "pit" || stored.matchKey === report.matchKey) ? stored : null;
    const clientId = draft?.clientId ?? report.clientId;
    const schemaId = draft?.schemaId ?? report.schemaId;
    const originalForm = draft?.schema ?? report.schema;
    const answers = draft?.payload ?? report.payload;
    const certainty = draft?.confidence ?? report.confidence;
    const note = draft ? "Your newer draft is restored. Review it, then Save to update your report." : report.message;
    editingRef.current = { clientId, key };
    pendingLoadRef.current = { key, clientId, schemaId, schema: originalForm, source: draft?.source, savedAt: draft?.savedAt, payload: answers, confidence: certainty, message: note };
    if (report.type !== type) {
      keepTeamOnSwitchRef.current = true;
      setTab(report.type);
    }
    setMatchKey(report.type === "match" ? report.matchKey ?? "" : "");
    setTeamKey(report.teamKey);
    // The same robot already on screen: its load effect will not run again, so load it here.
    if (key === draftKey) {
      pendingLoadRef.current = null;
      setPinnedForm(schemaId ? { key, id: schemaId } : null);
      setRecoveredForm(originalForm ? { key, schema: originalForm } : null);
      setPayload(answers);
      setSource(draft?.source ?? "manual");
      setDraftSavedAt(draft?.savedAt ?? null);
      setUserEdited(false);
      setMessage(note);
    }
    setConfidence(certainty);
    setEntryClientId(clientId);
    setSaveReceipt(null);
  }

  /** "Fix it" on the Saved note: the same robot and match, the answers as saved. */
  function fixLastSave() {
    if (!lastSaved || lastSaved.eventKey !== data?.eventKey || lastSaved.userId !== data?.scoutIdentity?.userId) return;
    openSavedReport({
      clientId: lastSaved.clientId,
      type: lastSaved.type,
      schemaId: lastSaved.schemaId,
      schema: lastSaved.schema,
      matchKey: lastSaved.type === "match" ? lastSaved.matchKey : null,
      teamKey: normalizeTeamKey(lastSaved.teamKey) ?? lastSaved.teamKey,
      payload: lastSaved.payload,
      confidence: lastSaved.confidence,
      message: "Change what was wrong, then Save. It replaces the entry you just saved.",
    });
  }

  /** Edit on one of your reports in "Your reports". */
  function editMyReport(report: MyEntry) {
    if (!report.clientId) return;
    const confidence =
      report.confidence === "high" || report.confidence === "low" ? report.confidence : "normal";
    openSavedReport({
      clientId: report.clientId,
      type: report.type,
      schemaId: report.schemaId,
      matchKey: report.matchKey,
      teamKey: report.teamKey,
      payload: report.payload ?? {},
      confidence,
      message: `Editing your report for ${teamNumberOf(report.teamKey)}. Change what's wrong, then Save; it replaces the report.`,
    });
    window.requestAnimationFrame(() =>
      document.getElementById("scout-form-start")?.scrollIntoView({ block: "start" }),
    );
  }

  const attachMedia = (file: File, options?: { fieldKey?: string; tags?: string[] }) =>
    attachScoutingMedia(file, options, { orgId, eventKey: data?.eventKey, teamKey, entryClientId, setMessage, refreshCounts, sync });

  async function retryQuarantineItem(clientId: string) {
    await scoutingAction(`retry:${clientId}`, async () => {
      if (!(await retryQuarantined(clientId))) return "This report is no longer waiting for retry. Refresh scouting to see its current state.";
      await refreshCounts();
      await sync();
      return null;
    });
  }

  async function discardQuarantineItem(clientId: string) {
    const item = quarantine.find(entry => entry.clientId === clientId);
    if (!item) return;
    const scope = reportScope;
    if (!(await confirm({ title: "Discard this rejected report?", body: "Its unsent answers will be removed from this device and will never upload to the team. Saved team reports stay intact.", confirmLabel: "Discard report", tone: "destructive" }))) return;
    if (!workspaceAlive.current || reportScopeRef.current !== scope) return;
    await scoutingAction(`discard:${clientId}`, async () => {
      if (!(await discardQuarantined(clientId, item.quarantinedAt))) return "The local report changed or was already handled. Refresh scouting before making another decision.";
      await refreshCounts();
      return "Discarded. This local report will not upload.";
    });
  }

  function editQuarantineItem(clientId: string) {
    const item = quarantine.find(row => row.clientId === clientId);
    if (!item || item.kind !== "entry" || item.entry.eventKey !== data?.eventKey || item.entry.orgId !== orgId) return;
    openSavedReport({ ...item.entry, matchKey: item.entry.matchKey ?? null,
      message: "This rejected report is open. Review the answers and Save; its original copy stays on this device until the correction is queued." });
  }

  async function scoutingAction(kind: string, work: (isCurrent: () => boolean) => Promise<string | null>) {
    if (leadActionInFlight.current) return;
    leadActionInFlight.current = true;
    setLeadAction(kind);
    const scope = reportScope;
    const isCurrent = () => workspaceAlive.current && reportScopeRef.current === scope;
    try {
      const note = await work(isCurrent);
      if (isCurrent() && note) setMessage(note);
    } catch (error) {
      if (isCurrent()) setMessage(error instanceof Error && error.name !== "TimeoutError" && error.name !== "AbortError" && error.name !== "TypeError"
        ? error.message : "The result could not be confirmed. Refresh scouting before trying again.");
    } finally {
      leadActionInFlight.current = false;
      if (workspaceAlive.current) setLeadAction(null);
    }
  }

  async function actionJson(path: string, options?: RequestInit): Promise<Record<string, unknown>> {
    const response = await fetch(path, { ...options, cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "The request did not complete. Refresh scouting and try again.");
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("The result could not be confirmed. Refresh scouting before trying again.");
    return result;
  }

  async function loadConflicts() {
    if (!data?.eventKey) return;
    await scoutingAction("conflicts", async isCurrent => {
      const version = ++conflictRequestVersion.current;
      setConflictsStatus("loading");
      try {
        const result = await actionJson(`/api/scouting/disagreements?${new URLSearchParams({ orgId, eventKey: data.eventKey! })}`);
        if (!Array.isArray(result.disagreements)) throw new Error("Conflict history could not be confirmed. Refresh scouting and try again.");
        if (isCurrent() && conflictRequestVersion.current === version) {
          setConflicts(result.disagreements);
          setConflictsStatus("ready");
        }
      } catch (error) {
        if (isCurrent() && conflictRequestVersion.current === version) setConflictsStatus("error");
        throw error;
      }
      return null;
    });
  }

  async function saveFormula() {
    const numericKeys = new Set(data?.schemas.find(form => form.type === "match")?.definition.fields
      .filter(field => ["number", "counter", "rating", "slider"].includes(field.type)).map(field => field.key) ?? []);
    const expression = weightedFormula(Object.fromEntries(Object.entries(formulaWeights).filter(([key]) => numericKeys.has(key))));
    if (!formulaName.trim() || !expression) {
      setMessage("Name the formula and set at least one field weight");
      return;
    }
    await scoutingAction("formula", async () => {
      const result = await actionJson("/api/scouting/formulas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, name: formulaName.trim(), expression }),
      });
      if (typeof result.id !== "string" || result.name !== formulaName.trim()) throw new Error("Formula saving was not confirmed. Refresh scouting before trying again.");
      return "Team value formula saved.";
    });
  }

  async function createStarterForms() {
    await scoutingAction("forms", async isCurrent => {
      const result = await actionJson("/api/scouting/schemas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "ensure_defaults" }),
      });
      if (!Array.isArray(result.schemas) || !result.schemas.some(form => form.type === "match") || !result.schemas.some(form => form.type === "pit")) {
        throw new Error("Starter forms were not confirmed. Refresh scouting before trying again.");
      }
      if (!isCurrent()) return null;
      // Reload the complete bootstrap: schema creation's repository answer does
      // not include the personal report history or match status extras.
      const body = await actionJson(`/api/scouting/bootstrap?${new URLSearchParams({ orgId })}`) as unknown as Bootstrap;
      if (!isCurrent()) return null;
      if (!Array.isArray(body.schemas) || !Array.isArray(body.matches)) throw new Error("Forms were created, but scouting could not be refreshed. Refresh scouting before continuing.");
      setData(body);
      try {
        await cacheEvent(orgId, body);
        return "Starter match and pit forms are ready.";
      } catch (error) {
        return `Starter forms are ready online. ${error instanceof Error ? error.message : "Could not update the offline copy."}`;
      }
    });
  }

  async function reviewConflict(id: string, status: "resolved" | "dismissed") {
    if (status === "resolved" && !selectedWinners[id]) {
      setMessage("Pick which scout was right before resolving — that updates pick-desk trust.");
      return;
    }
    await scoutingAction(`review:${id}`, async isCurrent => {
      const result = await actionJson("/api/scouting/disagreements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, id, status,
          winningEntryId: status === "resolved" ? selectedWinners[id] : undefined,
          resolution: { reviewedIn: "scouting-ui" } }),
      });
      if (result.ok !== true || result.disagreementId !== id || result.status !== status) throw new Error("Review saving was not confirmed. Refresh conflicts before trying again.");
      if (!isCurrent()) return null;
      setSelectedWinners((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      const version = ++conflictRequestVersion.current;
      setConflictsStatus("loading");
      try {
        const refreshed = await actionJson(`/api/scouting/disagreements?${new URLSearchParams({ orgId, eventKey: data?.eventKey ?? "" })}`);
        if (!Array.isArray(refreshed.disagreements)) throw new Error("Unconfirmed conflict history");
        if (isCurrent() && conflictRequestVersion.current === version) {
          setConflicts(refreshed.disagreements);
          setConflictsStatus("ready");
        }
      } catch {
        if (isCurrent() && conflictRequestVersion.current === version) setConflictsStatus("error");
        return "Review saved. Conflict history could not be refreshed; refresh it before making another decision.";
      }
      return status === "resolved" ? "Conflict resolved. The review is saved." : "Conflict dismissed. The review is saved.";
    });
  }

  const shell = classifyScoutingShell({
    loading: loading && !data,
    fetchFailed: fetchFailed && !data?.eventKey,
    orgId,
    eventKey: data?.eventKey,
    hasSchema: Boolean(schema || (draftKey && pinnedForm?.key === draftKey)),
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
          const cacheNotice = await cacheLiveScouting(orgId, fresh);
          if (cacheNotice) setMessage(cacheNotice);
          await loadTrust(fresh.eventKey);
        } else {
          setFetchFailed(true);
          setBootstrapStatus(response.status);
        }
      } catch {
        setFetchFailed(true);
      } finally {
        setLoading(false);
        setSettled(true);
      }
    })();
  }, [orgId, loadTrust]);

  const offlineDetail = scoutingOfflineBannerDetail({
    online,
    syncState,
    pendingEntries: counts.entries,
    pendingMedia: counts.media,
  });

  const freeUserId = searchParams.get("mode") === "free" ? data?.scoutIdentity?.userId : undefined;
  if (freeUserId) return <FreeScoutView key={`${orgId}:${freeUserId}`} orgId={orgId} userId={freeUserId} />;

  if (shell === "loading" || shell === "error" || shell === "setup") {
    return (
      <ScoutingShell
        orgId={orgId}
        shell={shell}
        error={message || undefined}
        errorStatus={bootstrapStatus}
        onRetry={reloadBootstrap}
        canManageSchemas={Boolean(data?.canManageSchemas)}
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
      formRecoveryStatus={formRecoveryStatus}
      retryOriginalForm={() => setFormRecoveryAttempt(attempt => attempt + 1)}
      formFields={formFields}
      schemaBudget={schemaBudget}
      matchOptions={matchOptions}
      matchKey={matchKey}
      teamKey={teamKey}
      payload={payload}
      validationProblems={validationProblems}
      validationAttempt={validationAttempt}
      savedHere={savedHere}
      confidence={confidence}
      entryClientId={entryClientId}
      draftSavedAt={draftSavedAt}
      draftDirty={draftDirty}
      flagsByField={flagsByField}
      trustByField={trustByField}
      liveConflicts={liveConflicts}
      conflicts={conflicts}
      conflictsStatus={conflictsStatus}
      selectedWinners={selectedWinners}
      message={message}
      leadAction={leadAction}
      editQuarantineItem={editQuarantineItem}
      saving={saving}
      syncNote={syncNote}
      saveReceipt={saveReceipt}
      showFormula={showFormula}
      formulaName={formulaName}
      formulaWeights={formulaWeights}
      trust={trust}
      cheatOpen={cheatOpen}
      shortcuts={shortcuts}
      setCheatOpen={setCheatOpen}
      pickTarget={pickTarget}
      pickPitTeam={nextTeam => pickTarget("", nextTeam)}
      setPayload={editPayload}
      onUndo={() => {
        const identity = { id: crypto.randomUUID(), at: new Date().toISOString() };
        setUserEdited(true);
        setPayload(current => undoScoutAction(current, identity));
      }}
      setConfidence={value => { setUserEdited(true); setConfidence(value); }}
      setSource={setSource}
      setSelectedWinners={setSelectedWinners}
      setSaveReceipt={setSaveReceipt}
      fixLastSave={lastSaved ? fixLastSave : undefined}
      editMyReport={editMyReport}
      autoPickEnabled={settled && !holdAutoPick}
      userEdited={userEdited}
      setShowFormula={setShowFormula}
      setFormulaName={setFormulaName}
      setFormulaWeights={setFormulaWeights}
      onTabChange={nextTab => { if (preserveCurrentDraft()) onTabChange(nextTab); }}
      sync={sync}
      retryQuarantineItem={retryQuarantineItem}
      discardQuarantineItem={discardQuarantineItem}
      createStarterForms={createStarterForms}
      refreshCounts={refreshCounts}
      loadConflicts={loadConflicts}
      reviewConflict={reviewConflict}
      attachMedia={attachMedia}
      cancelReport={async () => {
        if (saveInFlight.current) return;
        const capturedContext = saveContext;
        if ((userEdited || draftSavedAt) && payloadHasDraftContent(payload) && !(await confirm({ title: `Discard this draft for team ${teamNumberOf(teamKey)}?`,
          body: "These unsaved answers will be removed from this device. Reports already saved or queued will stay.",
          confirmLabel: "Discard draft", cancelLabel: "Keep scouting", tone: "destructive" }))) return;
        if (saveContextRef.current !== capturedContext) return;
        if (!clearScoutDraft(draftKey)) { setMessage("This draft could not be removed from device storage. Your answers are still open; restore storage and try again."); return; }
        setUserEdited(false); setPayload({}); setTeamKey(""); setHoldAutoPick(true);
        setSaveReceipt(null); setMessage("");
      }}
      submit={submit}
      saveFormula={saveFormula}
      setMessage={setMessage}
    />
  );
}
