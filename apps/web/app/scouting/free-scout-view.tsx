"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { visibleFields } from "../../lib/scouting/context-visible";
import { matchCapture, type ScoutSchema, type SchemaDefinition } from "@vantage/scouting";
import { MatchTimer } from "./match-timer";
import { MatchActivityRecorder } from "./match-activity-recorder";
import { MatchActivityReport } from "./match-activity-report";
import { clearScoutDraft, writeScoutClock } from "../../lib/scouting/draft-autosave";
import { fieldsForMatchStage, type ScoutFormStage } from "../../lib/scouting/match-form-flow";
import { freeScoutDefinition, portableScoutDefinition, latestScoutingYear, scoutingGameLabel, parseFreeScoutReport, type SavedFreeScoutReport } from "../../lib/scouting/free-scout";
import { freeScoutDeviceKey, pendingFreeReports, queueFreeReport, removePendingFreeReport, syncFreeReports, type PendingFreeReport } from "../../lib/scouting/free-scout-device";
import { Field } from "./scouting-field";
import { useOnline } from "../../lib/offline/use-online";
import { withOrgHref } from "../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./free-scout.css";

type Draft = { type: "match" | "pit"; team: string; label: string; year: number; schemaId?: string; definition?: SchemaDefinition; payload: Record<string, unknown> };
const freshDraft = (): Draft => ({ type: "pit", team: "", label: "Practice 1", year: latestScoutingYear(), payload: {} });

export function FreeScoutView({ orgId, userId }: { orgId: string; userId: string }) {
  const search = useSearchParams();
  const online = useOnline();
  const [schemas, setSchemas] = useState<ScoutSchema[]>([]);
  const [draft, setDraft] = useState<Draft>(() => ({ ...freshDraft(), type: search.get("scoutTab") === "match" ? "match" : "pit" }));
  const [hydrated, setHydrated] = useState(false);
  const [started, setStarted] = useState(false);
  const [stage, setStage] = useState<ScoutFormStage>("all");
  const [reports, setReports] = useState<SavedFreeScoutReport[]>([]);
  const [pending, setPending] = useState<PendingFreeReport[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [message, setMessage] = useState("");
  const [storageError, setStorageError] = useState("");
  const [busy, setBusy] = useState(false);
  const syncing = useRef(false);
  const draftKey = `${freeScoutDeviceKey(orgId, userId)}:draft`;
  const definition = draft.definition ?? freeScoutDefinition(draft.year, draft.type);
  const fields = visibleFields(draft.type === "match" ? fieldsForMatchStage(definition.fields, stage) : definition.fields, draft.payload);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/scouting/schemas?orgId=${encodeURIComponent(orgId)}&year=${draft.year}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) return; const data = await response.json(); if (!controller.signal.aborted) setSchemas(data.schemas ?? []); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [orgId, draft.year]);

  const refresh = useCallback(async () => {
    setPending(await pendingFreeReports(orgId, userId));
    if (!navigator.onLine) return;
    const response = await fetch(`/api/scouting/free-reports?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load saved reports.");
    if (data.userId !== userId) throw new Error("Your account changed. Reload scouting before continuing.");
    setReports(data.reports);
    setHasMore(data.hasMore);
    await putFeatureSnapshot("scouting", orgId, data.reports, `free:${userId}`).catch(() => setStorageError("Offline history could not be saved."));
  }, [orgId, userId]);

  const sync = useCallback(async () => {
    if (syncing.current || !navigator.onLine) return;
    syncing.current = true;
    try {
      const queued = await pendingFreeReports(orgId, userId);
      await syncFreeReports(orgId, userId);
      await refresh();
      if (queued.length && !(await pendingFreeReports(orgId, userId)).length) setMessage("Uploaded");
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed. Your reports are still on this device."); }
    finally { syncing.current = false; }
  }, [orgId, userId, refresh]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const recovered = JSON.parse(saved) as Draft;
        if (!["match", "pit"].includes(recovered.type) || typeof recovered.team !== "string" || typeof recovered.label !== "string" ||
          !Number.isInteger(recovered.year) || recovered.year < 1992 || recovered.year > 2100 || !recovered.payload || typeof recovered.payload !== "object" || Array.isArray(recovered.payload)) throw new Error("Invalid draft");
        setDraft(recovered); setStarted(true);
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
    try { localStorage.setItem(draftKey, JSON.stringify(draft)); setStorageError(""); }
    catch { setStorageError("Draft not saved. Device storage is full or unavailable."); }
  }, [draft, draftKey, hydrated, started]);

  useEffect(() => {
    if (!online) return;
    void sync();
    const timer = setInterval(() => void sync(), 30_000);
    return () => clearInterval(timer);
  }, [online, sync]);

  function change(patch: Partial<Draft>) {
    if (patch.payload && !Object.keys(patch.payload).length) writeScoutClock(draftKey, null);
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const payload = { ...draft.payload };
      const report = parseFreeScoutReport({ id: crypto.randomUUID(), year: draft.year, type: draft.type, teamNumber: Number(draft.team), label: draft.type === "pit" ? "Pit scouting" : draft.label, schemaId: draft.schemaId, payload, observedAt: new Date().toISOString() }, definition);
      await queueFreeReport(orgId, userId, report);
      clearScoutDraft(draftKey);
      setStarted(false);
      change({ payload: {} });
      setPending(await pendingFreeReports(orgId, userId));
      setMessage("Saved on this device.");
      await sync();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save. Your answers are still here."); }
    finally { setBusy(false); }
  }

  const pendingIds = new Set(pending.map((row) => row.report.id));
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
        {online ? "Online" : "Offline"} · {pending.length} waiting to upload
        {pending.length > 0 && online ? <Button type="button" variant="secondary" onClick={() => void sync()}>Retry upload</Button> : null}
      </div> : null}
      <div className="free-scout-card">
        {!started ? <>
          <div className="free-scout-inputs">
            <label>Team number<input inputMode="numeric" value={draft.team} onChange={(event) => change({ team: event.target.value.replace(/\D/g, "").slice(0, 5) })} placeholder="6925" /></label>
            {draft.type === "match" ? <label>Match name<input value={draft.label} maxLength={100} placeholder="e.g. Practice 1 or Qual 12" onChange={(event) => change({ label: event.target.value })} /></label> : null}
            <fieldset className="free-scout-kind"><legend>Scout</legend>{(["pit", "match"] as const).map(kind => <label key={kind}><input type="radio" name="practice-kind" checked={draft.type === kind} onChange={() => change({ type: kind, schemaId: undefined, definition: undefined, payload: {} })} /><span>{kind === "pit" ? "Pit" : "Match"}</span></label>)}</fieldset>
            <label>Game<select value={draft.year} onChange={event => change({ year: Number(event.target.value), schemaId: undefined, definition: undefined, payload: {} })}>{Array.from(new Set([latestScoutingYear(), draft.year, 2025, 2024])).sort((a,b) => b-a).map(year => <option key={year} value={year}>{scoutingGameLabel(year)}</option>)}</select></label>
            {schemas.some(schema => schema.type === draft.type) ? <label>Questions<select value={draft.schemaId ?? ""} onChange={event => { const schema = schemas.find(row => row.id === event.target.value); change({ schemaId: schema?.id, definition: schema ? portableScoutDefinition(schema.definition) : undefined, payload: {} }); }}><option value="">Game starter form</option>{schemas.filter(schema => schema.type === draft.type).map(schema => <option value={schema.id} key={schema.id}>{schema.definition.title}</option>)}</select></label> : null}
          </div>
          <Button type="button" variant="primary" disabled={!Number(draft.team) || (draft.type === "match" && !draft.label.trim()) || draft.year < 1992 || draft.year > 2100} onClick={() => setStarted(true)}>Start scouting</Button>
        </> : <>
          <div className="free-scout-heading"><h3>Team {draft.team} · {draft.type === "pit" ? "Pit scouting" : draft.label}</h3><Button type="button" variant="secondary" onClick={() => setStarted(false)}>Change details</Button></div>
          <p className="app-muted">{scoutingGameLabel(draft.year)}</p>{storageError ? <p role="alert">{storageError}</p> : null}
          {draft.type === "match" ? <MatchTimer fields={definition.fields} resetKey={draftKey} storageKey={draftKey} seasonYear={draft.year} resetDisabled={Boolean(matchCapture(draft.payload))} stage={stage} onStageChange={setStage} onPhaseChange={phase => setStage(phase === "done" ? "review" : phase === "pre" ? "all" : phase === "transition" ? "auto" : phase)} /> : null}
          {draft.type === "match" && draft.year === 2026 ? <MatchActivityRecorder payload={draft.payload} setPayload={next => setDraft(current => ({ ...current, payload: typeof next === "function" ? next(current.payload) : next }))} storageKey={draftKey} /> : null}
          <div className="scout-form-grid">{fields.map((field) => <Field key={field.key} field={field} value={draft.payload[field.key]} flags={[]} historyHint={null} disagreementRate={null} orgId={orgId} onChange={(value) => change({ payload: { ...draft.payload, [field.key]: value } })} />)}</div>
          <div className="scout-report-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => { if (Object.keys(draft.payload).length && !window.confirm("Discard this report? Your saved reports will stay.")) return; clearScoutDraft(draftKey); setStarted(false); change({ payload: {} }); setMessage(""); }}>Cancel report</Button><Button className="scout-save-button" type="button" variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save report"}</Button></div>
        </>}
        {message ? <p role="status">{message}</p> : null}
      </div>
      <section className="free-scout-card" aria-label="Practice reports">
        <div className="free-scout-heading"><h3>Reports</h3>{history.length > 0 ? <Button type="button" variant="secondary" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(history, null, 2)], { type: "application/json" }));
          const link = document.createElement("a"); link.href = url; link.download = "vantage-practice-reports.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Export reports</Button> : null}</div>
        {!history.length ? <p className="app-muted">Saved reports appear here.</p> : null}
        {hasMore ? <p className="app-muted">Showing the latest 200 uploaded reports.</p> : null}
        {history.map((report) => <details className="free-scout-report" key={report.id}>
          <summary data-disclosure><span><strong>Team {report.teamNumber}</strong> · {report.label}</span><span>{report.state}</span></summary>
          {report.error ? <p role="alert">{report.error}</p> : null}
          {report.error ? <Button type="button" variant="secondary" onClick={async () => {
            if (started && Object.keys(draft.payload).length && !window.confirm("Replace the open draft with this saved report?")) return;
            try {
              const recovered: Draft = { type: report.type, team: String(report.teamNumber), year: report.year, label: report.label, schemaId: report.schemaId, definition: report.definition, payload: report.payload };
              localStorage.setItem(draftKey, JSON.stringify(recovered));
              writeScoutClock(draftKey, matchCapture(recovered.payload)?.clockStartedAt ?? null);
              await removePendingFreeReport(orgId, userId, report.id);
              setDraft(recovered); setStarted(true); setPending(await pendingFreeReports(orgId, userId));
            } catch { setMessage("Could not reopen this report. The original is still on this device."); }
          }}>Edit local report</Button> : null}
          <p className="app-muted">{report.year} · {report.type} · {new Date(report.observedAt).toLocaleString()}</p>
          <dl>{report.definition.fields.filter((field) => field.key in report.payload).map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{typeof report.payload[field.key] === "object" ? JSON.stringify(report.payload[field.key]) : String(report.payload[field.key])}</dd></div>)}</dl>
          <MatchActivityReport payload={report.payload} />
          {report.state === "Uploaded" && report.scoutUserId === userId ? <Button type="button" variant="secondary" onClick={async () => {
            if (!window.confirm(`Delete the report for team ${report.teamNumber}, ${report.label}?`)) return;
            try {
              const response = await fetch("/api/scouting/free-reports", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, id: report.id }) });
              if (!response.ok) throw new Error((await response.json()).error ?? "Could not delete this report.");
              await refresh();
            } catch (error) { setMessage(error instanceof Error ? error.message : "Reconnect to delete this report."); }
          }}>Delete report</Button> : null}
        </details>)}
      </section>
    </section>
  );
}
