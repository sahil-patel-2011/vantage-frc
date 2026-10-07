"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ConfirmProvider, useConfirm } from "../../components/ui";
import { visibleFields } from "../../lib/scouting/context-visible";
import { matchCapture, type ScoutSchema } from "@vantage/scouting";
import { MatchTimer } from "./match-timer";
import { MatchActivityRecorder } from "./match-activity-recorder";
import { MatchActivityReport } from "./match-activity-report";
import { clearScoutDraft, payloadHasDraftContent, writeScoutClock } from "../../lib/scouting/draft-autosave";
import { parsePracticeDraft, samePracticeTarget, type PracticeDraft } from "../../lib/scouting/practice-draft";
import { fieldsForMatchStage, type ScoutFormStage } from "../../lib/scouting/match-form-flow";
import { freeScoutDefinition, portableScoutDefinition, latestScoutingYear, scoutingGameLabel, parseFreeScoutReport, type SavedFreeScoutReport } from "../../lib/scouting/free-scout";
import { freeScoutDeviceKey, pendingFreeReports, queueFreeReport, syncFreeReports, type PendingFreeReport } from "../../lib/scouting/free-scout-device";
import { Field } from "./scouting-field";
import { useOnline } from "../../lib/offline/use-online";
import { withOrgHref } from "../../lib/nav/product-nav";
import { clearFeatureSnapshot, getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./free-scout.css";

type Draft = PracticeDraft;
const freshDraft = (): Draft => ({ clientId: crypto.randomUUID(), type: "pit", team: "", label: "Practice 1", year: latestScoutingYear(), payload: {} });

export function FreeScoutView({ orgId, userId }: { orgId: string; userId: string }) {
  return <ConfirmProvider key={freeScoutDeviceKey(orgId, userId)}><PracticeScouting orgId={orgId} userId={userId} /></ConfirmProvider>;
}

function PracticeScouting({ orgId, userId }: { orgId: string; userId: string }) {
  const confirm = useConfirm();
  const search = useSearchParams();
  const online = useOnline();
  const [schemas, setSchemas] = useState<ScoutSchema[]>([]);
  const [draft, setDraft] = useState<Draft>(() => ({ ...freshDraft(), type: search.get("scoutTab") === "match" ? "match" : "pit" }));
  const [selection, setSelection] = useState<Draft>(() => draft);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [hydrated, setHydrated] = useState(false);
  const [started, setStarted] = useState(false);
  const [stage, setStage] = useState<ScoutFormStage>("all");
  const [reports, setReports] = useState<SavedFreeScoutReport[]>([]);
  const [pending, setPending] = useState<PendingFreeReport[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [message, setMessage] = useState("");
  const [storageError, setStorageError] = useState("");
  const [draftUnsaved, setDraftUnsaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const saving = useRef(false);
  const syncing = useRef(false);
  const historyVersion = useRef(0);
  const historyRequest = useRef<AbortController | null>(null);
  const draftKey = `${freeScoutDeviceKey(orgId, userId)}:draft`;
  const definition = draft.definition ?? freeScoutDefinition(draft.year, draft.type);
  const selectedYear = started ? draft.year : selection.year;
  const fields = visibleFields(draft.type === "match" ? fieldsForMatchStage(definition.fields, stage) : definition.fields, draft.payload);

  useEffect(() => {
    const controller = new AbortController();
    setSchemas([]);
    void fetch(`/api/scouting/schemas?orgId=${encodeURIComponent(orgId)}&year=${selectedYear}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then(async response => { if (!response.ok) return; const data = await response.json(); if (!controller.signal.aborted) setSchemas(data.schemas ?? []); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [orgId, selectedYear]);

  const refresh = useCallback(async () => {
    const version = ++historyVersion.current;
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    try { const queued = await pendingFreeReports(orgId, userId); if (version === historyVersion.current) setPending(queued); }
    catch { if (!controller.signal.aborted) setStorageError("Device storage is unavailable. Online report history is still available."); }
    if (controller.signal.aborted) return;
    if (!navigator.onLine) { setRefreshing(false); return; }
    setRefreshing(true);
    try {
      const response = await fetch(`/api/scouting/free-reports?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
      const data = await response.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setReports([]); setHasMore(false);
          await clearFeatureSnapshot("scouting", orgId, `free:${userId}`).catch(() => undefined);
        }
        throw new Error(data.error ?? "Could not load saved reports.");
      }
      if (data.userId !== userId) {
        setReports([]); setHasMore(false);
        throw new Error("Your account changed. Reload scouting before continuing.");
      }
      if (!Array.isArray(data.reports)) throw new Error("Could not confirm saved report history. Try refreshing again.");
      setReports(data.reports);
      setHasMore(Boolean(data.hasMore));
      await putFeatureSnapshot("scouting", orgId, data.reports, `free:${userId}`).catch(() => setStorageError("Offline history could not be saved."));
    } catch (error) { if (!controller.signal.aborted) throw error; }
    finally { if (version === historyVersion.current) setRefreshing(false); }
  }, [orgId, userId]);

  useEffect(() => () => { historyVersion.current += 1; historyRequest.current?.abort(); }, []);

  const sync = useCallback(async (retryRejected = false) => {
    if (syncing.current || !navigator.onLine) return;
    syncing.current = true;
    try {
      const queued = await pendingFreeReports(orgId, userId);
      if (!queued.some(row => retryRejected || row.retryable !== false)) { setPending(queued); return; }
      setUploading(true);
      await syncFreeReports(orgId, userId, fetch, { retryRejected });
      await refresh();
      if (queued.length && !(await pendingFreeReports(orgId, userId)).length) setMessage("Uploaded");
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed. Your reports are still on this device.");
      try { setPending(await pendingFreeReports(orgId, userId)); }
      catch { setStorageError("Could not read the upload queue. Keep scouting open to protect your unsaved answers."); }
    }
    finally { syncing.current = false; setUploading(false); }
  }, [orgId, userId, refresh]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const recovered = parsePracticeDraft(JSON.parse(saved), crypto.randomUUID());
        setDraft(recovered); setSelection(recovered); setStarted(true);
      }
    } catch { setStorageError("Draft recovery is unavailable on this device."); }
    setHydrated(true);
    void getFeatureSnapshot<SavedFreeScoutReport[]>("scouting", orgId, `free:${userId}`).then((saved) => {
      if (saved && !navigator.onLine) setReports(saved.data);
    }).catch(() => setStorageError("Saved report history is unavailable offline."));
    void refresh().catch((error) => setMessage(error.message));
  }, [draftKey, refresh, orgId, userId]);

  useEffect(() => {
    if (!hydrated || !started) return;
    try { localStorage.setItem(draftKey, JSON.stringify(draft)); setDraftUnsaved(false); }
    catch { setDraftUnsaved(true); }
  }, [draft, draftKey, hydrated, started]);

  useEffect(() => {
    if (!draftUnsaved) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [draftUnsaved]);

  useEffect(() => {
    if (!online) return;
    void sync();
    const retry = () => { if (!document.hidden) void sync(); };
    document.addEventListener("visibilitychange", retry);
    return () => document.removeEventListener("visibilitychange", retry);
  }, [online, sync]);

  function change(patch: Partial<Draft>) {
    if (patch.payload && !Object.keys(patch.payload).length) writeScoutClock(draftKey, null);
    setDraft((current) => ({ ...current, ...patch }));
  }

  function choose(patch: Partial<Draft>) { setSelection(current => ({ ...current, ...patch })); }

  async function startScouting() {
    const captured = draft;
    const sameTarget = samePracticeTarget(draft, selection);
    if (!sameTarget && payloadHasDraftContent(draft.payload) && !(await confirm({
      title: `Start a new report for team ${selection.team}?`,
      body: `The unsaved answers for team ${draft.team} will be discarded. Reports already saved or queued will stay.`,
      confirmLabel: "Start new report", cancelLabel: "Keep current report", tone: "destructive",
    }))) return;
    if (draftRef.current !== captured || saving.current) return;
    if (!sameTarget) writeScoutClock(draftKey, null);
    setDraft({ ...selection, clientId: sameTarget ? draft.clientId : crypto.randomUUID(), payload: sameTarget ? draft.payload : {} });
    setStage("all");
    setStarted(true);
  }

  async function save() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const payload = { ...draft.payload };
      const report = parseFreeScoutReport({ id: draft.clientId, year: draft.year, type: draft.type, teamNumber: Number(draft.team), label: draft.type === "pit" ? "Pit scouting" : draft.label, schemaId: draft.schemaId, payload, observedAt: new Date().toISOString() }, definition);
      await queueFreeReport(orgId, userId, report);
      if (draftRef.current === draft) {
        const cleared = clearScoutDraft(draftKey);
        const next = { ...draft, clientId: crypto.randomUUID(), team: "", payload: {} };
        setStarted(false); setDraft(next); setSelection(next); setDraftUnsaved(false);
        setMessage(cleared ? "Saved on this device." : "Saved on this device. Its draft copy could not be cleared.");
      } else setMessage("Saved on this device. Your newer answers stayed open; save again to include them.");
      // Device persistence completes the save. Network upload must not block the next robot.
      if (navigator.onLine) void sync();
      else void refresh().catch(() => setMessage("The report is saved on this device. Report history could not be refreshed."));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save. Your answers are still here."); }
    finally { saving.current = false; setBusy(false); }
  }

  async function discardDraft() {
    if (saving.current) return;
    const captured = draft;
    if (payloadHasDraftContent(draft.payload) && !(await confirm({ title: `Discard this draft for team ${draft.team}?`,
      body: "These unsaved answers will be removed from this device. Saved and queued reports will stay.",
      confirmLabel: "Discard draft", cancelLabel: "Keep scouting", tone: "destructive" }))) return;
    if (draftRef.current !== captured) return;
    if (!clearScoutDraft(draftKey)) { setStorageError("This draft could not be removed. Your answers are still open."); return; }
    const next = { ...draft, clientId: crypto.randomUUID(), payload: {} };
    setDraft(next); setSelection(next); setStarted(false); setDraftUnsaved(false); setMessage("");
  }

  const pendingIds = new Set(pending.map((row) => row.report.id));
  const rejectedCount = pending.filter(row => row.retryable === false).length;
  const history = [
    ...pending.map((row) => ({ ...row.report, scoutUserId: userId, definition: row.report.definition ?? freeScoutDefinition(row.report.year, row.report.type), state: row.error ? "Needs attention" : "Waiting to upload", error: row.error })),
    ...reports.filter((row) => !pendingIds.has(row.id)).map((row) => ({ ...row, state: "Uploaded", error: undefined })),
  ];
  return (
    <section className="free-scout" aria-label="Practice scouting">
      <header className="free-scout-heading">
        <div><h2>Practice scouting</h2><p>Choose a robot. Record what you learn.</p></div>
        <Button as="a" variant="secondary" href={withOrgHref("/competition?tab=command", orgId)}>Set event</Button>
      </header>
      {!online || pending.length > 0 ? <div className="free-scout-status" role="status">
        {online ? "Online" : "Offline"} · {pending.length - rejectedCount} waiting to upload{rejectedCount > 0 ? ` · ${rejectedCount} need attention` : ""}
        {pending.length > 0 && online ? <Button type="button" variant="secondary" disabled={uploading} onClick={() => void sync(true)}>{uploading ? "Uploading…" : "Retry upload"}</Button> : null}
      </div> : null}
      {storageError ? <p role="alert">{storageError}</p> : null}
      {draftUnsaved ? <p role="alert">These changes could not be saved as a draft. Keep scouting open and save the report before leaving.</p> : null}
      <div className="free-scout-card">
        {!started ? <>
          <div className="free-scout-inputs">
            <label>Team number<input inputMode="numeric" value={selection.team} onChange={(event) => choose({ team: event.target.value.replace(/\D/g, "").slice(0, 5) })} placeholder="6925" /></label>
            {selection.type === "match" ? <label>Match name<input value={selection.label} maxLength={100} placeholder="e.g. Practice 1 or Qual 12" onChange={(event) => choose({ label: event.target.value })} /></label> : null}
            <fieldset className="free-scout-kind"><legend>Scout</legend>{(["pit", "match"] as const).map(kind => <label key={kind}><input type="radio" name="practice-kind" checked={selection.type === kind} onChange={() => choose({ type: kind, schemaId: undefined, definition: undefined })} /><span>{kind === "pit" ? "Pit" : "Match"}</span></label>)}</fieldset>
            <label>Game<select value={selection.year} onChange={event => choose({ year: Number(event.target.value), schemaId: undefined, definition: undefined })}>{Array.from(new Set([latestScoutingYear(), selection.year, 2025, 2024])).sort((a,b) => b-a).map(year => <option key={year} value={year}>{scoutingGameLabel(year)}</option>)}</select></label>
            {schemas.some(schema => schema.type === selection.type) || selection.schemaId ? <label>Questions<select value={selection.schemaId ?? ""} onChange={event => { const schema = schemas.find(row => row.id === event.target.value); choose({ schemaId: schema?.id, definition: schema ? portableScoutDefinition(schema.definition) : undefined }); }}><option value="">Game starter form</option>{selection.schemaId && !schemas.some(schema => schema.id === selection.schemaId) ? <option value={selection.schemaId}>{selection.definition?.title ?? "Original form"}</option> : null}{schemas.filter(schema => schema.type === selection.type).map(schema => <option value={schema.id} key={schema.id}>{schema.definition.title}</option>)}</select></label> : null}
          </div>
          <div className="scout-report-actions">{payloadHasDraftContent(draft.payload) ? <Button type="button" variant="secondary" onClick={() => { setSelection(draft); setStarted(true); }}>Return to current report</Button> : null}<Button type="button" variant="primary" disabled={busy || !Number(selection.team) || (selection.type === "match" && !selection.label.trim()) || selection.year < 1992 || selection.year > 2100} onClick={() => void startScouting()}>Start scouting</Button></div>
        </> : <>
          <div className="free-scout-heading"><h3>Team {draft.team} · {draft.type === "pit" ? "Pit scouting" : draft.label}</h3><Button type="button" variant="secondary" disabled={busy} onClick={() => { setSelection(draft); setStarted(false); }}>Change details</Button></div>
          <p className="app-muted">{scoutingGameLabel(draft.year)}</p>
          {draft.type === "match" ? <MatchTimer fields={definition.fields} resetKey={`${draftKey}:${draft.clientId}`} storageKey={draftKey} seasonYear={draft.year} resetDisabled={Boolean(matchCapture(draft.payload))} stage={stage} onStageChange={setStage} onPhaseChange={phase => setStage(phase === "done" ? "review" : phase === "pre" ? "all" : phase === "transition" ? "auto" : phase)} /> : null}
          {draft.type === "match" && draft.year === 2026 ? <MatchActivityRecorder key={draft.clientId} payload={draft.payload} setPayload={next => setDraft(current => ({ ...current, payload: typeof next === "function" ? next(current.payload) : next }))} storageKey={draftKey} /> : null}
          <div className="scout-form-grid">{fields.map((field) => <Field key={`${draft.clientId}:${field.key}`} field={field} value={draft.payload[field.key]} flags={[]} historyHint={null} disagreementRate={null} orgId={orgId} onChange={(value) => change({ payload: { ...draft.payload, [field.key]: value } })} />)}</div>
          <div className="scout-report-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => void discardDraft()}>{payloadHasDraftContent(draft.payload) ? "Discard draft" : "Close form"}</Button><Button className="scout-save-button" type="button" variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save report"}</Button></div>
        </>}
        {message ? <p role="status">{message}</p> : null}
      </div>
      <section className="free-scout-card" aria-label="Practice reports">
        <div className="free-scout-heading"><h3>Reports</h3><div className="free-scout-history-actions"><Button type="button" variant="secondary" disabled={!online || refreshing} onClick={() => void refresh().catch(error => setMessage(error instanceof Error ? error.message : "Could not refresh reports."))}>{refreshing ? "Refreshing…" : "Refresh reports"}</Button>{history.length > 0 ? <Button type="button" variant="secondary" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(history, null, 2)], { type: "application/json" }));
          const link = document.createElement("a"); link.href = url; link.download = "vantage-practice-reports.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Export reports</Button> : null}</div></div>
        {!history.length ? <p className="app-muted" role="status">{refreshing ? "Loading saved reports…" : "Saved reports appear here."}</p> : null}
        {hasMore ? <p className="app-muted">Showing the latest 200 uploaded reports.</p> : null}
        {history.map((report) => <details className="free-scout-report" key={report.id}>
          <summary data-disclosure><span><strong>Team {report.teamNumber}</strong> · {report.label}</span><span>{report.state}</span></summary>
          {report.error ? <p role="alert">{report.error}</p> : null}
          {report.error ? <Button type="button" variant="secondary" disabled={uploading} onClick={async () => {
            const captured = draft;
            if (payloadHasDraftContent(draft.payload) && !(await confirm({ title: `Open the local report for team ${report.teamNumber}?`,
              body: `This replaces the unsaved answers for team ${draft.team}. Saved and queued reports will stay.`,
              confirmLabel: "Open local report", cancelLabel: "Keep current draft", tone: "destructive" }))) return;
            if (draftRef.current !== captured || saving.current) return;
            try {
              const recovered = parsePracticeDraft({ clientId: report.id, type: report.type, team: String(report.teamNumber), year: report.year, label: report.label, schemaId: report.schemaId, definition: report.definition, payload: report.payload }, report.id);
              localStorage.setItem(draftKey, JSON.stringify(recovered));
              writeScoutClock(draftKey, matchCapture(recovered.payload)?.clockStartedAt ?? null);
              // Keep the rejected row until a corrected version is actually saved.
              setDraft(recovered); setSelection(recovered); setStarted(true); setDraftUnsaved(false);
              setMessage("Your local report is open. Correct the answers and save; its queued copy stays safe until then.");
            } catch { setMessage("Could not reopen this report. The original is still on this device."); }
          }}>Edit local report</Button> : null}
          <p className="app-muted">{report.year} · {report.type} · {new Date(report.observedAt).toLocaleString()}</p>
          <dl>{report.definition.fields.filter((field) => field.key in report.payload).map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{typeof report.payload[field.key] === "object" ? JSON.stringify(report.payload[field.key]) : String(report.payload[field.key])}</dd></div>)}</dl>
          <MatchActivityReport payload={report.payload} />
          {report.state === "Uploaded" && report.scoutUserId === userId ? <Button type="button" variant="secondary" disabled={deletingId !== null} onClick={async () => {
            if (!(await confirm({ title: `Delete the report for team ${report.teamNumber}?`, body: `${report.label} and its answers will be removed from your team's practice history.`, confirmLabel: "Delete report", cancelLabel: "Keep report", tone: "destructive" }))) return;
            try {
              setDeletingId(report.id);
              const response = await fetch("/api/scouting/free-reports", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, id: report.id }), signal: AbortSignal.timeout(10_000) });
              if (!response.ok) throw new Error((await response.json()).error ?? "Could not delete this report.");
              const result = await response.json();
              if (result.deleted !== true) throw new Error("Deletion was not confirmed. Refresh reports before trying again.");
              await refresh();
            } catch (error) { setMessage(error instanceof Error ? error.message : "Reconnect to delete this report."); }
            finally { setDeletingId(null); }
          }}>{deletingId === report.id ? "Deleting…" : "Delete report"}</Button> : null}
        </details>)}
      </section>
    </section>
  );
}
