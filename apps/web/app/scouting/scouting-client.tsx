"use client";

import { useRef, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  readScoutDraft,
  readActiveScoutDraft,
  rememberActiveScoutDraft,
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
import { useScoutTask } from "./use-scout-task";
import { focusInvalidScoutField } from "./scouting-form-focus";
import { ConfirmProvider, useConfirm } from "../../components/ui";
import "./scouting-qr.css";

export default function ScoutingClient({ orgId, embedded = false }: { orgId: string; embedded?: boolean }) {
  return <ConfirmProvider key={orgId}><ScopedScoutingClient orgId={orgId} embedded={embedded} /></ConfirmProvider>;
}

function ScopedScoutingClient({ orgId, embedded }: { orgId: string; embedded: boolean }) {
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [matchKey, setMatchKey] = useState("");
  const [teamKey, setTeamKey] = useState("");
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [validationIssues, setValidationIssues] = useState<string[]>([]);
  const [pinnedForm, setPinnedForm] = useState<{ key: string; id: string; schema?: ScoutSchema; error?: string; status?: number } | null>(null);
  const [formRecoveryAttempt, setFormRecoveryAttempt] = useState(0);
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  // Autosave only after an edit; restored and carried answers are not new drafts.
  const [userEdited, setUserEdited] = useState(false);
  const editPayload = useCallback((next: Record<string, unknown> | ((current: Record<string, unknown>) => Record<string, unknown>)) => {
    setUserEdited(true);
    setValidationIssues([]);
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
    schemaId?: string;
    schema?: ScoutSchema;
    payload: Record<string, unknown>;
    confidence: "high" | "normal" | "low";
    message?: string;
  } | null>(null);
  // Editing a pit report switches to the Pit form without dropping its team.
  const keepTeamOnSwitchRef = useRef(false);
  const [confidence, setConfidence] = useState<"high" | "normal" | "low">("normal");
  const [source, setSource] = useState<"manual" | "voice">("manual");
  const [entryClientId, setEntryClientId] = useState(() => stableClientId());
  // Corrections reuse the saved report's id; switching robots clears it.
  const editingRef = useRef<{ clientId: string; key: string | null } | null>(null);
  const online = useOnline();
  const [fromCache, setFromCache] = useState(false);
  const [counts, setCounts] = useState({ entries: 0, media: 0, quarantined: 0 });
  const [quarantine, setQuarantine] = useState<QuarantinedItem[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [bootstrapStatus, setBootstrapStatus] = useState<number | null>(null);
  const [saveReceipt, setSaveReceipt] = useState<SaveReceipt | null>(null);
  // The entry just saved, so "Fix it" can put it back in the form. Saving again with the
  // same client id replaces it: the server lets the author update their own entry.
  const [lastSaved, setLastSaved] = useState<{
    clientId: string;
    schemaId: string;
    schema: ScoutSchema;
    type: "match" | "pit";
    eventKey: string;
    userId?: string;
    matchKey: string;
    teamKey: string;
    payload: Record<string, unknown>;
    confidence: "high" | "normal" | "low";
  } | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "degraded">("idle");
  const [conflicts, setConflicts] = useState<Array<Record<string, unknown>>>([]);
  const [selectedWinners, setSelectedWinners] = useState<Record<string, string>>({});
  const [officialFlags, setOfficialFlags] = useState<OfficialFlag[]>([]);
  const [trust, setTrust] = useState<TrustSnapshot | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const { cheatOpen, setCheatOpen, shortcuts } = useVenueShortcuts(orgId);

  const type = tab === "pit" ? "pit" : "match";
  // Saved confirmations, local coverage and score checks belong to one event/account.
  useLayoutEffect(() => {
    setLastSaved(null); setSavedHere([]); setSaveReceipt(null); setOfficialFlags([]);
  }, [data?.eventKey, data?.scoutIdentity?.userId]);
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
    setCounts(await pendingCounts(orgId));
    setQuarantine(await listQuarantine(orgId));
  }, [orgId]);
  useScoutQueueRefresh(refreshCounts);
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
  // After an upload, the team's data again, quietly, so the "Done" ticks and your reports include
  // what was just sent. The list used to refresh only on reload.
  const refreshLive = useCallback(async () => {
    if (!orgId || !navigator.onLine) return;
    try {
      const response = await fetch(`/api/scouting/bootstrap?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      if (!response.ok) return;
      const fresh = (await response.json()) as Bootstrap;
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
    setSyncState("syncing");
    try {
      const entries = await syncOutbox(orgId, {
        onRetry: (n, delayMs) => {
          setSyncState("degraded");
          setMessage(`Couldn't reach the team yet. Trying again in ${Math.round(delayMs / 1000)}s; your entries are safe on this phone.`);
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
        setMessage((current) => (current.startsWith("Couldn't reach the team yet") ? "" : current));
      }
      setSyncState("idle");
      await refreshCounts();
      if (entries.count > 0) void refreshLive();
    } catch (error) {
      setSyncState(navigator.onLine ? "degraded" : "idle");
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "Not sent yet. Your entries are saved on this phone and send when the signal is better.",
      );
    }
  }, [orgId, refreshCounts, refreshLive]);

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
          const cacheNotice = await cacheLiveScouting(orgId, fresh);
          if (cacheNotice) setMessage(cacheNotice);
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
        setSettled(true);
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

  // Fetch disagreements for both task switches and notification deep links.
  const conflictsEventKey = data?.eventKey ?? "";
  useEffect(() => {
    if (tab !== "conflicts" || !orgId || !conflictsEventKey) return;
    let cancelled = false;
    void fetch(
      `/api/scouting/disagreements?orgId=${encodeURIComponent(orgId)}&eventKey=${encodeURIComponent(conflictsEventKey)}`,
    )
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { disagreements: [] };
        if (!cancelled) setConflicts(body.disagreements);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tab, orgId, conflictsEventKey]);

  // The robot picked for you: only once the live team data has arrived (or could not), so it is
  // never chosen from an old copy on the phone that forgot what you already scouted.
  useEffect(() => {
    if (!settled || holdAutoPick || !data || matchKey || searchParams.get("matchKey")) return;
    if (data.scoutIdentity?.userId && data.eventKey && !searchParams.get("teamKey") && !searchParams.get("scoutTab")) {
      const active = readActiveScoutDraft({ userId: data.scoutIdentity.userId, orgId, eventKey: data.eventKey });
      if (active && (active.type === "pit" || data.matches.some(match => match.matchKey === active.matchKey))) {
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

  const draftKey = useMemo(() => scoutDraftStorageKey({
    userId: data?.scoutIdentity?.userId, orgId, eventKey: data?.eventKey ?? "", entryType: type, matchKey, teamKey,
  }), [orgId, data?.eventKey, data?.scoutIdentity?.userId, type, matchKey, teamKey]);
  const latestSchema = useMemo(
    () => data?.schemas.find((candidate) => candidate.type === type),
    [data, type],
  );
  const schema = pinnedForm?.key === draftKey
    ? pinnedForm.schema ?? data?.schemas.find(candidate => candidate.id === pinnedForm.id && candidate.type === type)
    : latestSchema;
  useEffect(() => {
    if (!draftKey || pinnedForm?.key !== draftKey || schema) return;
    const controller = new AbortController();
    const { key, id } = pinnedForm;
    void fetch(`/api/scouting/schemas?${new URLSearchParams({ orgId, schemaId: id })}`, {
      cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]),
    }).then(async response => {
      if (!response.ok) throw Object.assign(new Error((await apiErrorMessage(response)) ?? "The original form could not be loaded."), { status: response.status });
      const body = await response.json() as { schemas?: ScoutSchema[] };
      const original = body.schemas?.find(candidate => candidate.id === id && candidate.orgId === orgId && candidate.type === type);
      if (!original) throw new Error("The original form is unavailable. Your answers are still saved on this device.");
      if (!controller.signal.aborted) setPinnedForm(current => current?.key === key && current.id === id ? { key, id, schema: original } : current);
    }).catch(error => {
      if (!controller.signal.aborted) setPinnedForm(current => current?.key === key && current.id === id
        ? { key, id, error: error instanceof Error ? error.message : "Could not load the original form.", status: error?.status } : current);
    });
    return () => controller.abort();
  }, [draftKey, pinnedForm?.key, pinnedForm?.id, schema, orgId, type, formRecoveryAttempt]);

  const configuredFields = useMemo(() => withInferredPhaseRules(
    schema?.definition.fields.filter(field => !isScoutIdentityField(field)) ?? [],
  ), [schema]);
  const formFields = useMemo(() => visibleFields(configuredFields, payload), [configuredFields, payload]);
  useEffect(() => { setValidationIssues([]); }, [schema?.id, type, matchKey, teamKey]);

  const schemaBudget = useMemo(
    () => (schema ? lintSchemaBudget(schema.definition) : null),
    [schema],
  );

  const trustByField = useMemo(() => {
    const map = new Map<string, FieldTrustSummary>();
    for (const row of trust?.fieldTrust ?? []) map.set(row.fieldKey, row);
    return map;
  }, [trust]);

  // A new robot: its draft if there is one, a report asked for by "Fix it" or Edit, or a fresh
  // form with the answers the form keeps from the last robot (formResetBehavior). Those used to
  // be wiped here, one render after Save set them.
  useLayoutEffect(() => {
    // Restore before the new robot's controls can receive a tap. A passive reset
    // could replace an answer entered immediately after choosing the robot.
    setLoadedDraftKey(draftKey);
    setUserEdited(false);
    // A note about the robot that was on screen does not carry over to the next one.
    setMessage((current) =>
      current.startsWith("You already scouted") || current.startsWith("Editing your report") ? "" : current,
    );
    if (!draftKey) {
      setPinnedForm(null);
      setDraftSavedAt(null);
      setDraftDirty(false);
      return;
    }
    const carry = carryOverRef.current;
    carryOverRef.current = null;
    const pending = pendingLoadRef.current;
    if (pending && pending.key === draftKey) {
      pendingLoadRef.current = null;
      const original = pending.schema?.orgId === orgId && pending.schema.type === type ? pending.schema : undefined;
      setPinnedForm(pending.schemaId ? { key: draftKey, id: pending.schemaId, schema: original } : latestSchema ? { key: draftKey, id: latestSchema.id, schema: latestSchema } : null);
      setPayload(pending.payload);
      setConfidence(pending.confidence);
      if (pending.message) setMessage(pending.message);
      setDraftSavedAt(null);
      setDraftDirty(false);
      return;
    }
    const existing = readScoutDraft(draftKey);
    const original = existing?.schema?.orgId === orgId && existing.schema.type === type ? existing.schema : undefined;
    setPinnedForm(existing?.schemaId ? { key: draftKey, id: existing.schemaId, schema: original } : latestSchema ? { key: draftKey, id: latestSchema.id, schema: latestSchema } : null);
    if (existing) {
      if (existing.clientId) { editingRef.current = { clientId: existing.clientId, key: draftKey }; setEntryClientId(existing.clientId); }
      if (existing.source) setSource(existing.source);
      setPayload(existing.payload);
      setConfidence(existing.confidence);
      setDraftSavedAt(existing.savedAt);
      setDraftDirty(false);
      return;
    }
    editingRef.current = null;
    setEntryClientId(stableClientId());
    setPayload(carry ?? {});
    setConfidence("normal");
    setSource("manual");
    setDraftSavedAt(null);
    setDraftDirty(false);
  }, [draftKey]);
  useEffect(() => {
    if (draftKey && loadedDraftKey === draftKey && latestSchema && pinnedForm?.key !== draftKey) setPinnedForm({ key: draftKey, id: latestSchema.id, schema: latestSchema });
  }, [draftKey, loadedDraftKey, latestSchema, pinnedForm?.key]);

  // Picking a robot you already scouted in this match loads your report instead of a blank form;
  // tapping a "Done" robot used to start over, and saving made a second report. Your reports are
  // all of them (not the team's latest 30), and the check runs again when fresh data arrives for
  // the robot on screen, as long as nothing has been typed yet.
  const mine = useMemo(() => myReports(data), [data]);
  useEffect(() => {
    if (editingRef.current && editingRef.current.key !== draftKey) {
      editingRef.current = null;
      setEntryClientId(stableClientId());
    }
    // Refresh before restoring cached answers so newer corrections can arrive.
    if (!settled || loadedDraftKey !== draftKey || editingRef.current || userEdited || type !== "match" || !draftKey) return;
    const storedTeam = normalizeTeamKey(teamKey);
    const report = mine.find(
      (entry) => entry.type === "match" && entry.matchKey === matchKey && entry.teamKey === storedTeam && entry.clientId,
    );
    // Saved on this phone but not synced yet (offline), or not in the list yet.
    const local = report
      ? null
      : [...savedHere].reverse().find((entry) => entry.matchKey === matchKey && entry.teamKey === storedTeam) ?? null;
    const found = report?.clientId
      ? { clientId: report.clientId, schemaId: report.schemaId, payload: report.payload ?? {}, confidence: report.confidence }
      : local;
    if (!found || readScoutDraft(draftKey)) return;
    editingRef.current = { clientId: found.clientId, key: draftKey };
    setEntryClientId(found.clientId);
    if (found.schemaId) setPinnedForm({ key: draftKey, id: found.schemaId, schema: data?.schemas.find(candidate => candidate.id === found.schemaId) });
    setPayload(found.payload);
    if (found.confidence === "high" || found.confidence === "normal" || found.confidence === "low") setConfidence(found.confidence);
    setMessage(
      `You already scouted ${teamNumberOf(storedTeam ?? teamKey)} in this match. Change what's wrong, then Save; it replaces your report.`,
    );
  }, [draftKey, loadedDraftKey, mine, savedHere, userEdited, type, matchKey, teamKey, settled]);
  // A draft is only what the scout typed: never a report loaded to be corrected.
  useEffect(() => {
    // A commit that changed the robot still contains the previous form's state.
    // It must never write those answers under the newly selected robot's key.
    // Clearing the last observation is also an edit. Persist it so an older
    // answer cannot return on reload, even when the payload is now empty.
    if (!draftKey || loadedDraftKey !== draftKey || !userEdited) return;
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
    setValidationIssues(problems);
    if (problems.length) {
      setMessage(`Not saved yet. ${problems.slice(0, 3).join(". ")}.`);
      focusInvalidScoutField(schema.definition.fields, problems);
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
    setLastSaved({ clientId: entryClientId, schemaId: schema.id, schema, type, eventKey: data.eventKey, userId: data.scoutIdentity?.userId, matchKey, teamKey, payload: answers, confidence });
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
    let note: string | null = null;
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
        note = lastMatchNote(data.matches ?? [], matchKey);
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
    if (!draftCleared) note = [note, "Saved on this device, but the old draft could not be removed."].filter(Boolean).join(" ");
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
    if (key === draftKey && editingRef.current?.clientId === report.clientId && userEdited) {
      setMessage("Your current corrections are already open. Save them when ready; the saved report has not replaced your draft.");
      return;
    }
    const existing = readScoutDraft(key);
    if (existing) {
      report = { ...report, clientId: existing.clientId ?? report.clientId, schemaId: existing.schemaId ?? report.schemaId,
        schema: existing.schema ?? report.schema, payload: existing.payload, confidence: existing.confidence,
        message: "Your unfinished draft was restored. Review and save when ready." };
    }
    editingRef.current = { clientId: report.clientId, key };
    pendingLoadRef.current = { key, schemaId: report.schemaId, schema: report.schema, payload: report.payload, confidence: report.confidence, message: report.message };
    if (report.type !== type) {
      keepTeamOnSwitchRef.current = true;
      setTab(report.type);
    }
    if (report.type === "match") setMatchKey(report.matchKey ?? "");
    setTeamKey(report.teamKey);
    // The same robot already on screen: its load effect will not run again, so load it here.
    if (key === draftKey) {
      pendingLoadRef.current = null;
      if (report.schemaId) setPinnedForm({ key, id: report.schemaId, schema: report.schema });
      setPayload(report.payload);
      setUserEdited(false);
      setMessage(report.message);
    }
    setConfidence(report.confidence);
    setEntryClientId(report.clientId);
    setSaveReceipt(null);
  }

  /** "Fix it" on the Saved note: the same robot and match, the answers as saved. */
  function fixLastSave() {
    if (!lastSaved || lastSaved.eventKey !== data?.eventKey || lastSaved.userId !== data?.scoutIdentity?.userId || lastSaved.schema.orgId !== orgId) return;
    openSavedReport({
      clientId: lastSaved.clientId,
      schemaId: lastSaved.schemaId,
      schema: lastSaved.schema,
      type: lastSaved.type,
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
      schemaId: report.schemaId,
      type: report.type,
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
    if (!data?.eventKey) return;
    const response = await fetch(
      `/api/scouting/disagreements?orgId=${encodeURIComponent(orgId)}&eventKey=${encodeURIComponent(data?.eventKey ?? "")}`,
    );
    if (response.ok) setConflicts(((await response.json()) as { disagreements: [] }).disagreements);
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
    try {
      await cacheEvent(orgId, body);
      setMessage("Starter match and pit forms are ready.");
    } catch (error) {
      setMessage(`Starter forms are ready online. ${error instanceof Error ? error.message : "Could not update the offline copy."}`);
    }
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
  if (draftKey && pinnedForm?.key === draftKey && !schema && data?.eventKey) {
    return <ScoutingShell orgId={orgId} embedded={embedded} shell={pinnedForm.error ? "error" : "loading"}
      error={pinnedForm.error} errorStatus={pinnedForm.status} onRetry={() => { setPinnedForm(current => current ? { ...current, error: undefined, status: undefined } : null); setFormRecoveryAttempt(current => current + 1); }} />;
  }

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
      validationIssues={validationIssues}
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
      saving={saving}
      syncNote={syncNote}
      saveReceipt={saveReceipt}
      trust={trust}
      cheatOpen={cheatOpen}
      shortcuts={shortcuts}
      setCheatOpen={setCheatOpen}
      setMatchKey={setMatchKey}
      setTeamKey={setTeamKey}
      setPayload={editPayload}
      onUndo={() => {
        const identity = { id: crypto.randomUUID(), at: new Date().toISOString() };
        setUserEdited(true);
        setPayload(current => undoScoutAction(current, identity));
      }}
      setConfidence={setConfidence}
      setSource={setSource}
      setSelectedWinners={setSelectedWinners}
      setSaveReceipt={setSaveReceipt}
      fixLastSave={lastSaved ? fixLastSave : undefined}
      editMyReport={editMyReport}
      autoPickEnabled={settled && !holdAutoPick}
      userEdited={userEdited}
      onTabChange={onTabChange}
      sync={sync}
      retryQuarantineItem={retryQuarantineItem}
      discardQuarantineItem={discardQuarantineItem}
      createStarterForms={createStarterForms}
      refreshCounts={refreshCounts}
      loadConflicts={loadConflicts}
      reviewConflict={reviewConflict}
      attachMedia={attachMedia}
      cancelReport={async () => {
        if (userEdited && Object.keys(payload).length && !(await confirm({ title: "Discard this report?", body: `This clears the open draft for team ${teamNumberOf(teamKey)}. Saved reports stay available.`, confirmLabel: "Discard draft", tone: "destructive" }))) return;
        if (!clearScoutDraft(draftKey)) { setMessage("Could not discard the saved draft. Your answers are still here."); return; }
        setUserEdited(false); setPayload({}); setTeamKey(""); setHoldAutoPick(true);
        setSaveReceipt(null); setMessage("");
      }}
      submit={submit}
      setMessage={setMessage}
    />
  );
}
