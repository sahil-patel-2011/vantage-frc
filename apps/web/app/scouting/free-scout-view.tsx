"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { visibleFields } from "../../lib/scouting/context-visible";
import { freeScoutDefinition, parseFreeScoutReport, type SavedFreeScoutReport } from "../../lib/scouting/free-scout";
import { freeScoutDeviceKey, pendingFreeReports, queueFreeReport, removePendingFreeReport, syncFreeReports, type PendingFreeReport } from "../../lib/scouting/free-scout-device";
import { Field, isTapCounterField } from "./scouting-field";
import { useOnline } from "../../lib/offline/use-online";
import { withOrgHref } from "../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./free-scout.css";

type Draft = { type: "match" | "pit"; team: string; label: string; year: number; payload: Record<string, unknown> };
const freshDraft = (): Draft => ({ type: "match", team: "", label: "Practice 1", year: new Date().getFullYear(), payload: {} });

export function FreeScoutView({ orgId, userId }: { orgId: string; userId: string }) {
  const online = useOnline();
  const [draft, setDraft] = useState<Draft>(freshDraft);
  const [hydrated, setHydrated] = useState(false);
  const [started, setStarted] = useState(false);
  const [reports, setReports] = useState<SavedFreeScoutReport[]>([]);
  const [pending, setPending] = useState<PendingFreeReport[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [message, setMessage] = useState("");
  const [storageError, setStorageError] = useState("");
  const [busy, setBusy] = useState(false);
  const syncing = useRef(false);
  const draftKey = `${freeScoutDeviceKey(orgId, userId)}:draft`;
  const definition = freeScoutDefinition(draft.year, draft.type);
  const fields = visibleFields(definition.fields, draft.payload);

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

  function change(patch: Partial<Draft>) { setDraft((current) => ({ ...current, ...patch })); }

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const payload = { ...draft.payload };
      for (const field of fields) {
        if (field.required && payload[field.key] === undefined && isTapCounterField(field)) payload[field.key] = 0;
      }
      const report = parseFreeScoutReport({ id: crypto.randomUUID(), year: draft.year, type: draft.type, teamNumber: Number(draft.team), label: draft.label, payload, observedAt: new Date().toISOString() });
      await queueFreeReport(orgId, userId, report);
      localStorage.removeItem(draftKey);
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
    ...pending.map((row) => ({ ...row.report, scoutUserId: userId, definition: freeScoutDefinition(row.report.year, row.report.type), state: row.error ? "Needs attention" : "Waiting to upload", error: row.error })),
    ...reports.filter((row) => !pendingIds.has(row.id)).map((row) => ({ ...row, state: "Uploaded", error: undefined })),
  ];
  return (
    <section className="free-scout" aria-label="Scout without an event">
      <header className="free-scout-heading">
        <div><h2>Scout without an event</h2><p>Practice or video review. Separate from event results.</p></div>
        <Button as="a" variant="secondary" href={withOrgHref("/competition?tab=scouting", orgId)}>Event scouting</Button>
      </header>
      <div className="free-scout-status" role="status">
        {online ? "Online" : "Offline"} · {pending.length} waiting to upload
        {pending.length > 0 && online ? <Button type="button" variant="secondary" onClick={() => void sync()}>Retry upload</Button> : null}
      </div>
      <div className="free-scout-card">
        {!started ? <>
          <div className="free-scout-inputs">
            <label>Team number<input inputMode="numeric" value={draft.team} onChange={(event) => change({ team: event.target.value.replace(/\D/g, "").slice(0, 5) })} placeholder="6925" /></label>
            <label>Session or match<input value={draft.label} maxLength={100} onChange={(event) => change({ label: event.target.value })} /></label>
            <label>Form<select value={draft.type} onChange={(event) => change({ type: event.target.value as Draft["type"], payload: {} })}><option value="match">Match</option><option value="pit">Pit</option></select></label>
            <label>Season<input type="number" min={1992} max={2100} value={draft.year} onChange={(event) => change({ year: Number(event.target.value), payload: {} })} /></label>
          </div>
          <Button type="button" variant="primary" disabled={!Number(draft.team) || !draft.label.trim() || draft.year < 1992 || draft.year > 2100} onClick={() => setStarted(true)}>Start scouting</Button>
        </> : <>
          <div className="free-scout-heading"><h3>Team {draft.team} · {draft.label}</h3><Button type="button" variant="secondary" onClick={() => setStarted(false)}>Change details</Button></div>
          <p className="app-muted">{storageError || "Draft saved on this device"}</p>
          <div className="scout-form-grid">{fields.map((field) => <Field key={field.key} field={field} value={draft.payload[field.key]} flags={[]} historyHint={null} disagreementRate={null} orgId={orgId} onChange={(value) => change({ payload: { ...draft.payload, [field.key]: value } })} />)}</div>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save report"}</Button>
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
          <summary><span><strong>Team {report.teamNumber}</strong> · {report.label}</span><span>{report.state}</span></summary>
          {report.error ? <p role="alert">{report.error}</p> : null}
          {report.error ? <Button type="button" variant="secondary" onClick={async () => {
            if (started && Object.keys(draft.payload).length && !window.confirm("Replace the open draft with this saved report?")) return;
            try {
              const recovered: Draft = { type: report.type, team: String(report.teamNumber), year: report.year, label: report.label, payload: report.payload };
              localStorage.setItem(draftKey, JSON.stringify(recovered));
              await removePendingFreeReport(orgId, userId, report.id);
              setDraft(recovered); setStarted(true); setPending(await pendingFreeReports(orgId, userId));
            } catch { setMessage("Could not reopen this report. The original is still on this device."); }
          }}>Edit local report</Button> : null}
          <p className="app-muted">{report.year} · {report.type} · {new Date(report.observedAt).toLocaleString()}</p>
          <dl>{report.definition.fields.filter((field) => field.key in report.payload).map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{typeof report.payload[field.key] === "object" ? JSON.stringify(report.payload[field.key]) : String(report.payload[field.key])}</dd></div>)}</dl>
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
