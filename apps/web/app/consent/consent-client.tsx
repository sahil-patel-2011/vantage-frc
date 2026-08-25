"use client";
import { useCallback, useEffect, useState } from "react";
import { FORM_TYPE_LABEL, FORM_TYPES, missingFormsFor, type FormType, type RecordStatus } from "../../lib/consent";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Form = { id: string; seasonYear: number; name: string; formType: FormType; required: boolean; documentUrl: string | null; notes: string };
type ConsentRecord = { id: string; formId: string; personName: string; guardianName: string; status: RecordStatus; signedOn: string | null; byName: string | null };
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; forms: Form[]; records: ConsentRecord[]; summary: { requiredForms: number; totalForms: number; peopleTracked: number; fullyComplete: number; outstanding: number; perForm: { formId: string; submitted: number; verified: number }[] } };

const STATUS_LABEL: Record<RecordStatus, string> = { pending: "Pending", submitted: "Submitted", verified: "Verified" };
const NEXT_STATUS: Record<RecordStatus, RecordStatus | null> = { pending: "submitted", submitted: "verified", verified: null };

export default function ConsentClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a bare error line.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [formForm, setFormForm] = useState({ name: "", formType: "medical_release", required: true, documentUrl: "" });
  const [recordForm, setRecordForm] = useState({ formId: "", personName: "", guardianName: "", status: "submitted", signedOn: "" });

  const load = useCallback(async () => {
    const response = await fetch(`/api/consent?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    setLoadError("");
    setErrorStatus(null);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) {
      setMessage(data.error ?? "Failed to load forms");
      setLoadError(data.error ?? "Failed to load forms");
      setErrorStatus(response.status);
      return;
    }
    setView(data);
    if (data.status === "ready" && !recordForm.formId && data.forms[0]) {
      setRecordForm((prev) => ({ ...prev, formId: data.forms[0]!.id }));
    }
  }, [orgId, seasonYear, recordForm.formId]);
  useEffect(() => { void load(); }, [orgId]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/consent", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addForm(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_form", seasonYear, ...formForm }, "Form added.");
    if (view?.status === "ready") setFormForm({ name: "", formType: "medical_release", required: true, documentUrl: "" });
  }

  async function addRecord(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "add_record", ...recordForm }, "Submission logged.");
    if (view?.status === "ready") setRecordForm((prev) => ({ ...prev, personName: "", guardianName: "", signedOn: "" }));
  }

  if (!view) {
    // Retry cannot fix an expired session, so the failure decides its own action.
    const failure = loadError
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError,
          },
        )
      : null;
    return (
      <main className="intel-app">
        <p className="telemetry-status">
          {failure ? (
            <>
              <strong>{failure.title}</strong> — {failure.description}
            </>
          ) : (
            message || "Loading forms…"
          )}
        </p>
        {failure?.primary ? (
          <p>
            <a className="app-button" href={failure.primary.href}>
              {failure.primary.label}
            </a>
          </p>
        ) : null}
        {failure?.showRetry ? (
          <p>
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
          </p>
        ) : null}
      </main>
    );
  }
  if (view.status === "setup_required") {
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / FORMS</span><h1>Forms &amp; consent</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  const people = [...new Set(view.records.map((r) => r.personName))].sort();
  const formName = (id: string) => view.forms.find((f) => f.id === id)?.name ?? "form";

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / FORMS</span><h1>Forms &amp; consent — {seasonYear}</h1></div>
        <nav className="intel-actions"><a href="/workspace">Workspace →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}

      <section className="metric-grid">
        <article><span>Required forms</span><strong>{view.summary.requiredForms}</strong></article>
        <article><span>People tracked</span><strong>{view.summary.peopleTracked}</strong></article>
        <article><span>Fully complete</span><strong>{view.summary.fullyComplete}</strong></article>
        <article><span>Outstanding</span><strong>{view.summary.outstanding}</strong></article>
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={addForm}>
          <span className="eyebrow">DEFINE A REQUIRED FORM</span>
          <label>Name<input required value={formForm.name} onChange={(e) => setFormForm({ ...formForm, name: e.target.value })} placeholder="2027 Medical Release" /></label>
          <label>Type<select value={formForm.formType} onChange={(e) => setFormForm({ ...formForm, formType: e.target.value })}>{FORM_TYPES.map((t) => <option key={t} value={t}>{FORM_TYPE_LABEL[t]}</option>)}</select></label>
          <label>Link to blank form (optional)<input type="url" value={formForm.documentUrl} onChange={(e) => setFormForm({ ...formForm, documentUrl: e.target.value })} /></label>
          <label className="check-field"><input type="checkbox" checked={formForm.required} onChange={(e) => setFormForm({ ...formForm, required: e.target.checked })} /> Required for every participant</label>
          <button className="primary-action">Add form</button>
        </form>

        <form className="intel-panel" onSubmit={addRecord}>
          <span className="eyebrow">LOG A SUBMISSION</span>
          <label>Form<select value={recordForm.formId} onChange={(e) => setRecordForm({ ...recordForm, formId: e.target.value })}>{view.forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label>Participant<input required value={recordForm.personName} onChange={(e) => setRecordForm({ ...recordForm, personName: e.target.value })} /></label>
          <div className="budget-fields">
            <label>Parent / guardian<input value={recordForm.guardianName} onChange={(e) => setRecordForm({ ...recordForm, guardianName: e.target.value })} /></label>
            <label>Signed on<input type="date" value={recordForm.signedOn} onChange={(e) => setRecordForm({ ...recordForm, signedOn: e.target.value })} /></label>
          </div>
          <label>Status<select value={recordForm.status} onChange={(e) => setRecordForm({ ...recordForm, status: e.target.value })}><option value="submitted">Submitted</option><option value="verified">Verified</option><option value="pending">Pending</option></select></label>
          <button className="primary-action">Log submission</button>
        </form>
      </section>

      <section className="intel-panel invite-list">
        <span className="eyebrow">FORMS</span>
        {view.forms.length === 0 && <p>No forms defined yet — add the ones your team requires.</p>}
        {view.forms.map((f) => {
          const stat = view.summary.perForm.find((p) => p.formId === f.id);
          return (
            <article key={f.id}>
              <div>
                <strong>{f.name}{f.required ? " · required" : " · optional"}</strong>
                <small>{FORM_TYPE_LABEL[f.formType]} · {stat?.submitted ?? 0}/{view.summary.peopleTracked} submitted · {stat?.verified ?? 0} verified{f.documentUrl ? "" : ""}</small>
                {f.documentUrl && <div><a href={f.documentUrl} target="_blank" rel="noreferrer">Blank form ↗</a></div>}
              </div>
              {view.context.role !== "viewer" && <button onClick={() => void post({ action: "delete_form", id: f.id }, "Form removed.")}>Delete</button>}
            </article>
          );
        })}
      </section>

      <section className="intel-panel invite-list">
        <span className="eyebrow">BY PARTICIPANT</span>
        {people.length === 0 && <p>No submissions logged yet.</p>}
        {people.map((person) => {
          const missing = missingFormsFor(person, view.forms, view.records);
          const theirRecords = view.records.filter((r) => r.personName === person);
          return (
            <article key={person}>
              <div style={{ flex: 1 }}>
                <strong>{person}{missing.length === 0 ? " ✓" : ""}</strong>
                <small>{theirRecords.map((r) => `${formName(r.formId)}: ${STATUS_LABEL[r.status]}`).join(" · ")}</small>
                {missing.length > 0 && <small>Missing: {missing.map((id) => formName(id)).join(", ")}</small>}
              </div>
              <div>
                {theirRecords.filter((r) => NEXT_STATUS[r.status]).slice(0, 1).map((r) => (
                  <button key={r.id} onClick={() => void post({ action: "set_record_status", id: r.id, status: NEXT_STATUS[r.status] }, "Updated.")}>
                    Advance {formName(r.formId)}
                  </button>
                ))}
                {missing.length > 0 && <b>{missing.length} missing</b>}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
