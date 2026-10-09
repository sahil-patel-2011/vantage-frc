"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfirmProvider, useConfirm } from "../../components/ui";
import { visibleFields } from "../../lib/scouting/context-visible";
import { matchCapture, validatePayload, type ScoutSchema } from "@vantage/scouting";
import { MatchTimer } from "./match-timer";
import { MatchActivityRecorder } from "./match-activity-recorder";
import { MatchActivityReport } from "./match-activity-report";
import { writeScoutClock } from "../../lib/scouting/draft-autosave";
import { fieldsForMatchStage, type ScoutFormStage } from "../../lib/scouting/match-form-flow";
import { freeScoutDefinition, portableScoutDefinition, latestScoutingYear, scoutingGameLabel, parseFreeScoutReport, type SavedFreeScoutReport } from "../../lib/scouting/free-scout";
import { freeScoutDeviceKey, pendingFreeReports, queueFreeReport, removePendingFreeReport, syncFreeReports, type PendingFreeReport } from "../../lib/scouting/free-scout-device";
import { ScoutingAnswerField } from "./scouting-answer-field";
import { answersToSave } from "../../lib/scouting/entry-answers";
import { focusInvalidScoutField } from "./scouting-form-focus";
import { freshFreeScoutDraft, parseFreeScoutDraft, type FreeScoutDraft as Draft } from "../../lib/scouting/free-scout-draft";
import type { OfficialFlag } from "./scouting-model";
import { useOnline } from "../../lib/offline/use-online";
import { withOrgHref } from "../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./free-scout.css";

const NO_FLAGS: OfficialFlag[] = [];

export function FreeScoutView({ orgId, userId }: { orgId: string; userId: string }) {
  return <ConfirmProvider key={`${orgId}:${userId}`}><PracticeScout orgId={orgId} userId={userId} /></ConfirmProvider>;
}

function PracticeScout({ orgId, userId }: { orgId: string; userId: string }) {
  const confirm = useConfirm();
  const search = useSearchParams();
  const online = useOnline();
  const [schemas, setSchemas] = useState<ScoutSchema[]>([]);
  const [draft, setDraft] = useState<Draft>(() => freshFreeScoutDraft(search.get("scoutTab") === "match" ? "match" : "pit"));
  const [hydrated, setHydrated] = useState(false);
  const [started, setStarted] = useState(false);
  const [stage, setStage] = useState<ScoutFormStage>("pre");
  const [reports, setReports] = useState<SavedFreeScoutReport[]>([]);
  const [pending, setPending] = useState<PendingFreeReport[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [message, setMessage] = useState("");
  const [storageError, setStorageError] = useState("");
  const [busy, setBusy] = useState(false);
  const saveInFlight = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const formRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const requestedSync = useRef<boolean | null>(null);
  const draftKey = `${freeScoutDeviceKey(orgId, userId)}:draft`;
  const definition = useMemo(() => draft.definition ?? freeScoutDefinition(draft.year, draft.type), [draft.definition, draft.year, draft.type]);
  const reachable = visibleFields(definition.fields, draft.payload);
  const fields = draft.type === "match" ? fieldsForMatchStage(reachable, stage) : reachable;
  const updateAnswers = useCallback((next: Record<string, unknown> | ((current: Record<string, unknown>) => Record<string, unknown>)) => {
    setDraft(current => ({ ...current, payload: typeof next === "function" ? next(current.payload) : next }));
    setProblems([]);
  }, []);

  useEffect(() => {
    if (!problems.length) return;
    focusInvalidScoutField(reachable, problems);
  }, [problems]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/scouting/schemas?orgId=${encodeURIComponent(orgId)}&year=${draft.year}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async response => { if (!response.ok) return; const data = await response.json(); if (!controller.signal.aborted) setSchemas(data.schemas ?? []); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [orgId, draft.year]);

  const refresh = useCallback(async () => {
    setPending(await pendingFreeReports(orgId, userId));
    if (!navigator.onLine) return;
    const response = await fetch(`/api/scouting/free-reports?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load saved reports.");
    if (data.userId !== userId) throw new Error("Your account changed. Reload scouting before continuing.");
    setReports(data.reports);
    setHasMore(data.hasMore);
    await putFeatureSnapshot("scouting", orgId, data.reports, `free:${userId}`).catch(() => setStorageError("Offline history could not be saved."));
  }, [orgId, userId]);

  const sync = useCallback(async (retryRejected = false) => {
    if (!navigator.onLine) return;
    requestedSync.current = Boolean(requestedSync.current || retryRejected);
    if (syncing.current) return;
    syncing.current = true;
    setUploading(true);
    try {
      // A save during an upload requests one follow-up pass; no recurring polling.
      while (requestedSync.current !== null && navigator.onLine) {
        const retry = requestedSync.current;
        requestedSync.current = null;
        const queued = await pendingFreeReports(orgId, userId);
        await syncFreeReports(orgId, userId, fetch, { retryRejected: retry });
        const remaining = await pendingFreeReports(orgId, userId);
        setPending(remaining);
        const uploaded = queued.filter(row => !remaining.some(left => left.report.id === row.report.id)).length;
        if (uploaded) {
          setMessage(`Uploaded ${uploaded} ${uploaded === 1 ? "report" : "reports"}.`);
          await refresh();
        }
      }
    }
    catch (error) {
      requestedSync.current = null;
      setMessage(error instanceof Error ? error.message : "Upload failed. Your reports are still on this device.");
      try { setPending(await pendingFreeReports(orgId, userId)); } catch { setStorageError("Device report storage is unavailable. Keep this page open."); }
    }
    finally {
      requestedSync.current = null;
      syncing.current = false; setUploading(false);
    }
  }, [orgId, userId, refresh]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const recovered = parseFreeScoutDraft(saved);
        setDraft(recovered); setStarted(Boolean(recovered.reportId || Object.keys(recovered.payload).length));
      }
    } catch { setStorageError("Draft recovery is unavailable on this device."); }
    setHydrated(true);
    void getFeatureSnapshot<SavedFreeScoutReport[]>("scouting", orgId, `free:${userId}`).then((saved) => {
      if (saved && !navigator.onLine) setReports(saved.data);
    }).catch(() => setStorageError("Saved report history is unavailable offline."));
    void refresh().catch((error) => setMessage(error.message));
  }, [draftKey, refresh, orgId, userId]);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(draftKey, JSON.stringify(draft)); setStorageError(""); }
    catch { setStorageError("Draft not saved. Device storage is full or unavailable."); }
  }, [draft, draftKey, hydrated]);

  useEffect(() => {
    if (online) void sync();
  }, [online, sync]);

  function change(patch: Partial<Draft>) {
    if (patch.payload && !Object.keys(patch.payload).length) writeScoutClock(draftKey, null);
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function changeForm(patch: Partial<Draft>) {
    if (Object.keys(draft.payload).length && !(await confirm({ title: "Change the questions?", body: "This clears the answers in the open practice draft. Saved reports stay available.", confirmLabel: "Change questions", tone: "destructive" }))) return;
    setStage("pre"); setProblems([]); setMessage("");
    change({ ...patch, payload: {}, reportId: undefined, observedAt: undefined });
  }

  function start() {
    setProblems([]); setMessage(""); setStage("pre");
    // Pin the exact form and submission identity before the first answer.
    setDraft(current => ({ ...current, definition, reportId: current.reportId ?? crypto.randomUUID(), observedAt: current.observedAt ?? new Date().toISOString() }));
    setStarted(true);
  }

  async function save() {
    if (saveInFlight.current) return;
    const answers = answersToSave(reachable, draft.payload);
    const errors = validatePayload({ ...definition, fields: reachable }, answers);
    if (errors.length) { setStage("review"); setProblems(errors); setMessage(""); return; }
    saveInFlight.current = true;
    setBusy(true);
    let saved = false;
    try {
      const payload = { ...draft.payload };
      const reportId = draft.reportId ?? crypto.randomUUID();
      const observedAt = draft.observedAt ?? new Date().toISOString();
      setDraft(current => ({ ...current, reportId, observedAt }));
      const report = parseFreeScoutReport({ id: reportId, year: draft.year, type: draft.type, teamNumber: Number(draft.team), label: draft.type === "pit" ? "Pit scouting" : draft.label, schemaId: draft.schemaId, payload, observedAt }, definition);
      await queueFreeReport(orgId, userId, report);
      saved = true;
      setStarted(false);
      change({ payload: {}, reportId: undefined, observedAt: undefined });
      setStage("pre"); setProblems([]);
      setMessage("Saved on this device.");
      try { localStorage.removeItem(draftKey); writeScoutClock(draftKey, null); } catch { setStorageError("Report saved, but its old draft could not be removed."); }
      setPending(await pendingFreeReports(orgId, userId));
      formRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
      // Uploading must not hold the next robot's form behind slow venue Wi-Fi.
      void sync();
    } catch (error) { setMessage(saved ? "Saved on this device. Could not refresh report history; retry when connected." : error instanceof Error ? error.message : "Could not save. Your answers are still here."); }
    finally { saveInFlight.current = false; setBusy(false); }
  }

  const pendingIds = new Set(pending.map((row) => row.report.id));
  const history = [
    ...pending.map((row) => ({ ...row.report, scoutUserId: userId, definition: row.report.definition ?? freeScoutDefinition(row.report.year, row.report.type), state: row.error ? "Needs attention" : "Waiting to upload", error: row.error })),
    ...reports.filter((row) => !pendingIds.has(row.id)).map((row) => ({ ...row, state: "Uploaded", error: undefined })),
  ];
  const needsAttention = pending.filter(row => row.error).length;
  const waiting = pending.length - needsAttention;
  return (
    <section className="free-scout" aria-label="Practice scouting">
      <header className="free-scout-heading">
        <div><h2>Practice scouting</h2><p>Choose a robot. Record what you learn.</p></div>
        <Button as="a" variant="secondary" href={withOrgHref("/competition?tab=command", orgId)}>Set event</Button>
      </header>
      {!online || pending.length > 0 || uploading ? <div className="free-scout-status" role="status">
        <span>{online ? "Online" : "Offline"} · {waiting} waiting to upload{needsAttention ? ` · ${needsAttention} need attention` : ""}</span>
        {pending.length > 0 && online ? <Button type="button" variant="secondary" disabled={uploading || busy} onClick={() => void sync(true)}>{uploading ? "Uploading…" : "Retry upload"}</Button> : null}
      </div> : null}
      <div className="free-scout-card" ref={formRef} aria-busy={busy}>
        {storageError ? <p role="alert">{storageError}</p> : null}
        {!started ? <>
          <div className="free-scout-inputs">
            <label>Team number<input inputMode="numeric" value={draft.team} onChange={(event) => change({ team: event.target.value.replace(/\D/g, "").slice(0, 5) })} placeholder="6925" /></label>
            {draft.type === "match" ? <label>Match name<input value={draft.label} maxLength={100} placeholder="e.g. Practice 1 or Qual 12" onChange={(event) => change({ label: event.target.value })} /></label> : null}
            <fieldset className="free-scout-kind"><legend>Scout</legend>{(["pit", "match"] as const).map(kind => <label key={kind}><input type="radio" name="practice-kind" checked={draft.type === kind} onChange={() => void changeForm({ type: kind, schemaId: undefined, definition: undefined })} /><span>{kind === "pit" ? "Pit" : "Match"}</span></label>)}</fieldset>
            <label>Game<select value={draft.year} onChange={event => void changeForm({ year: Number(event.target.value), schemaId: undefined, definition: undefined })}>{Array.from(new Set([latestScoutingYear(), draft.year, 2025, 2024])).sort((a,b) => b-a).map(year => <option key={year} value={year}>{scoutingGameLabel(year)}</option>)}</select></label>
            {draft.schemaId || schemas.some(schema => schema.type === draft.type) ? <label>Questions<select value={draft.schemaId ?? ""} onChange={event => { const schema = schemas.find(row => row.id === event.target.value); void changeForm({ schemaId: schema?.id, definition: schema ? portableScoutDefinition(schema.definition) : undefined }); }}><option value="">Game starter form</option>{draft.schemaId && !schemas.some(schema => schema.id === draft.schemaId) ? <option value={draft.schemaId}>{draft.definition?.title ?? "Saved form version"}</option> : null}{schemas.filter(schema => schema.type === draft.type && schema.year === draft.year).map(schema => <option value={schema.id} key={schema.id}>{schema.definition.title}</option>)}</select></label> : null}
          </div>
          <Button type="button" variant="primary" disabled={busy || !hydrated || !Number(draft.team) || (draft.type === "match" && !draft.label.trim()) || draft.year < 1992 || draft.year > 2100} onClick={start}>{Object.keys(draft.payload).length ? "Resume scouting" : "Start scouting"}</Button>
        </> : <>
          <div className="free-scout-heading"><h3>Team {draft.team} · {draft.type === "pit" ? "Pit scouting" : draft.label}</h3><Button type="button" variant="secondary" disabled={busy} onClick={() => setStarted(false)}>Change details</Button></div>
          <p className="app-muted">{scoutingGameLabel(draft.year)} · {definition.title}</p>
          {problems.length ? <div className="free-scout-errors" role="alert"><strong>Review these answers before saving</strong><ul>{problems.map((problem, index) => <li key={`${index}:${problem}`}>{problem}</li>)}</ul></div> : null}
          <fieldset className="free-scout-fields" disabled={busy}>
          {draft.type === "match" ? <MatchTimer fields={definition.fields} resetKey={draftKey} storageKey={draftKey} seasonYear={draft.year} resetDisabled={Boolean(matchCapture(draft.payload))} stage={stage} onStageChange={setStage} onPhaseChange={phase => {
            if (phase === "pre") return;
            setStage(current => current === "review" ? current : phase === "done" ? "review" : phase === "transition" ? "auto" : phase);
          }} /> : null}
          {draft.type === "match" && draft.year === 2026 ? <MatchActivityRecorder payload={draft.payload} setPayload={updateAnswers} storageKey={draftKey} /> : null}
          <div className="scout-form-grid">{fields.map((field) => <ScoutingAnswerField key={field.key} anchorId={`scout-field-${encodeURIComponent(field.key)}`} field={field} value={draft.payload[field.key]} error={problems.find(problem => problem.startsWith(`${field.label} `))} flags={NO_FLAGS} historyHint={null} disagreementRate={null} orgId={orgId} setPayload={updateAnswers} />)}</div>
          </fieldset>
          {fields.length === 0 ? <p className="app-muted">No questions in this phase. Continue with the phase controls above.</p> : null}
          <div className="scout-report-actions"><Button type="button" variant="secondary" disabled={busy} onClick={async () => {
            if (Object.keys(draft.payload).length && !(await confirm({ title: "Discard this practice draft?", body: `This clears the open answers for team ${draft.team}. Saved reports stay available.`, confirmLabel: "Discard draft", tone: "destructive" }))) return;
            try { localStorage.removeItem(draftKey); }
            catch { setStorageError("Could not discard the saved draft. Your answers are still here."); return; }
            setStarted(false); change({ payload: {}, reportId: undefined, observedAt: undefined }); setProblems([]); setMessage("");
          }}>Discard draft</Button><Button className={draft.type === "pit" || stage === "review" ? "scout-save-button" : undefined} type="button" variant="primary" disabled={busy} onClick={() => { if (draft.type === "match" && stage !== "review") setStage("review"); else void save(); }}>{busy ? "Saving…" : draft.type === "match" && stage !== "review" ? "Review answers" : "Save report"}</Button></div>
        </>}
        {message ? <p role="status">{message}</p> : null}
      </div>
      <section className="free-scout-card" aria-label="Practice reports">
        <div className="free-scout-heading"><h3>Reports</h3><div className="free-scout-history-actions">
          {online ? <Button type="button" variant="secondary" disabled={loadingReports || uploading || busy} onClick={async () => {
            setLoadingReports(true);
            try { await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not refresh reports."); }
            finally { setLoadingReports(false); }
          }}>{loadingReports ? "Refreshing…" : "Refresh reports"}</Button> : null}
          {history.length > 0 ? <Button type="button" variant="secondary" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(history, null, 2)], { type: "application/json" }));
          const link = document.createElement("a"); link.href = url; link.download = "vantage-practice-reports.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Export reports</Button> : null}</div></div>
        {!history.length ? <p className="app-muted">Saved reports appear here.</p> : null}
        {hasMore ? <p className="app-muted">Showing the latest 200 uploaded reports.</p> : null}
        {history.map((report) => <details className="free-scout-report" key={report.id}>
          <summary data-disclosure><span><strong>Team {report.teamNumber}</strong> · {report.label}</span><span>{report.state}</span></summary>
          {report.error ? <p role="alert">{report.error}</p> : null}
          {report.error ? <Button type="button" variant="secondary" disabled={busy || uploading} onClick={async () => {
            if (Object.keys(draft.payload).length && !(await confirm({ title: "Open this saved report?", body: `This replaces the open draft with the saved report for team ${report.teamNumber}. The rejected report stays recoverable until the draft is saved on this device.`, confirmLabel: "Open saved report", tone: "destructive" }))) return;
            try {
              const recovered: Draft = { type: report.type, team: String(report.teamNumber), year: report.year, label: report.label, schemaId: report.schemaId, definition: report.definition, payload: report.payload, reportId: crypto.randomUUID(), observedAt: report.observedAt };
              localStorage.setItem(draftKey, JSON.stringify(recovered));
              writeScoutClock(draftKey, matchCapture(recovered.payload)?.clockStartedAt ?? null);
              await removePendingFreeReport(orgId, userId, report.id);
              setDraft(recovered); setStarted(true); setStage("review"); setProblems([]); setMessage("Saved report reopened. Review and save to upload a corrected report."); setPending(await pendingFreeReports(orgId, userId));
              formRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
            } catch { setMessage("Could not reopen this report. The original is still on this device."); }
          }}>Edit local report</Button> : null}
          <p className="app-muted">{report.year} · {report.type} · {new Date(report.observedAt).toLocaleString()}</p>
          <dl>{report.definition.fields.filter((field) => field.key in report.payload).map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{typeof report.payload[field.key] === "object" ? JSON.stringify(report.payload[field.key]) : String(report.payload[field.key])}</dd></div>)}</dl>
          <MatchActivityReport payload={report.payload} />
          {report.state === "Uploaded" && report.scoutUserId === userId ? <Button type="button" variant="danger" disabled={busy || !online || uploading} onClick={async () => {
            if (!(await confirm({ title: "Delete this report?", body: `This permanently deletes the uploaded ${report.label} report for team ${report.teamNumber}. Other reports stay available.`, confirmLabel: "Delete report", tone: "destructive" }))) return;
            setBusy(true);
            try {
              const response = await fetch("/api/scouting/free-reports", { method: "DELETE", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, id: report.id }) });
              if (!response.ok) throw new Error((await response.json()).error ?? "Could not delete this report.");
              setReports(current => current.filter(row => row.id !== report.id));
              setMessage("Report deleted.");
              await refresh();
            } catch (error) { setMessage(error instanceof Error ? error.message : "Reconnect to delete this report."); }
            finally { setBusy(false); }
          }}>Delete report</Button> : null}
        </details>)}
      </section>
    </section>
  );
}
