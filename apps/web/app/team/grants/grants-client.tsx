"use client";

import { useEffect, useState } from "react";
import { GRANT_ITEM_KINDS, GRANT_STATUSES, grantStatusLabel } from "../../../lib/grants";

type Opportunity = {
  id: string;
  name: string;
  funder: string | null;
  amountMinUsd: string | null;
  amountMaxUsd: string | null;
  deadline: string | null;
  applicationUrl: string | null;
};

type Application = {
  id: string;
  opportunityName: string | null;
  seasonYear: number;
  status: string;
  amountRequestedUsd: string | null;
  amountAwardedUsd: string | null;
};

type Item = {
  id: string;
  kind: string;
  prompt: string | null;
  content: string | null;
  charLimit: number | null;
  done: boolean;
};

type Draft = { subject: string; body: string };

function money(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return "—";
  return `$${amount.toLocaleString()}`;
}

function statusLabel(status: string) {
  return GRANT_STATUSES.includes(status as (typeof GRANT_STATUSES)[number])
    ? grantStatusLabel(status as (typeof GRANT_STATUSES)[number])
    : status;
}

export default function GrantsClient({ orgId }: { orgId: string }) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "error">("ok");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [oppForm, setOppForm] = useState({
    name: "",
    funder: "",
    description: "",
    amountMinUsd: "",
    amountMaxUsd: "",
    deadline: "",
    applicationUrl: "",
  });
  const [appForm, setAppForm] = useState({ grantOpportunityId: "", amountRequestedUsd: "" });
  const [itemForm, setItemForm] = useState({ kind: "essay", prompt: "", charLimit: "" });
  const [awardedAmount, setAwardedAmount] = useState("");

  async function load() {
    setLoading(true);
    const [oppRes, appRes] = await Promise.all([
      fetch(`/api/grants/opportunities?orgId=${encodeURIComponent(orgId)}`),
      fetch(`/api/grants/applications?orgId=${encodeURIComponent(orgId)}`),
    ]);
    const oppData = await oppRes.json();
    const appData = await appRes.json();
    setOpportunities(oppData.opportunities ?? []);
    setApplications(appData.applications ?? []);
    if (!oppRes.ok) {
      setMessageTone("error");
      setMessage(oppData.error ?? "Unable to load grant opportunities");
    } else if (!appRes.ok) {
      setMessageTone("error");
      setMessage(appData.error ?? "Unable to load grant applications");
    } else {
      setMessage("");
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function loadItems(applicationId: string) {
    setSelectedId(applicationId);
    setDraft(null);
    setAwardedAmount("");
    const response = await fetch(
      `/api/grants/items?orgId=${encodeURIComponent(orgId)}&applicationId=${encodeURIComponent(applicationId)}`,
    );
    const data = await response.json();
    setItems(data.items ?? []);
    if (!response.ok) {
      setMessageTone("error");
      setMessage(data.error ?? "Unable to load application items");
    }
  }

  function flash(ok: boolean, text: string) {
    setMessageTone(ok ? "ok" : "error");
    setMessage(text);
  }

  async function addOpportunity(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/grants/opportunities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, ...oppForm }),
    });
    const data = await response.json();
    flash(response.ok, response.ok ? "Grant opportunity saved." : (data.error ?? "Could not save opportunity"));
    if (response.ok) {
      setOppForm({
        name: "",
        funder: "",
        description: "",
        amountMinUsd: "",
        amountMaxUsd: "",
        deadline: "",
        applicationUrl: "",
      });
      await load();
    }
  }

  async function startApplication(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/grants/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        seasonYear: new Date().getFullYear(),
        grantOpportunityId: appForm.grantOpportunityId || null,
        amountRequestedUsd: appForm.amountRequestedUsd || null,
      }),
    });
    const data = await response.json();
    flash(response.ok, response.ok ? "Application started." : (data.error ?? "Could not start application"));
    if (response.ok) {
      setAppForm({ grantOpportunityId: "", amountRequestedUsd: "" });
      await load();
      if (data.application?.id) await loadItems(data.application.id as string);
    }
  }

  async function updateStatus(id: string, status: string, amountAwardedUsd?: string) {
    const response = await fetch("/api/grants/applications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        id,
        status,
        amountAwardedUsd: status === "awarded" && amountAwardedUsd ? amountAwardedUsd : undefined,
      }),
    });
    const data = await response.json();
    flash(response.ok, response.ok ? "Status updated." : (data.error ?? "Could not update status"));
    if (response.ok) await load();
  }

  async function addItem(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    const response = await fetch("/api/grants/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        applicationId: selectedId,
        kind: itemForm.kind,
        prompt: itemForm.prompt,
        charLimit: itemForm.charLimit || null,
      }),
    });
    const data = await response.json();
    flash(response.ok, response.ok ? "Item added." : (data.error ?? "Could not add item"));
    if (response.ok) {
      setItemForm({ kind: "essay", prompt: "", charLimit: "" });
      await loadItems(selectedId);
    }
  }

  async function saveItem(id: string, content: string) {
    const response = await fetch("/api/grants/items", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, id, content }),
    });
    if (!response.ok) {
      const data = await response.json();
      flash(false, data.error ?? "Could not save item");
      return;
    }
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, content } : item)));
  }

  async function toggleDone(id: string, done: boolean) {
    const response = await fetch("/api/grants/items", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, id, done }),
    });
    if (!response.ok) {
      const data = await response.json();
      flash(false, data.error ?? "Could not update item");
      return;
    }
    if (selectedId) await loadItems(selectedId);
  }

  async function draftFollowup() {
    if (!selectedId) return;
    const response = await fetch("/api/outreach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, kind: "grant_followup", grantApplicationId: selectedId }),
    });
    const data = await response.json();
    if (response.ok) {
      setDraft(data.message);
      flash(true, "Follow-up draft ready.");
    } else {
      flash(false, data.error ?? "Could not draft follow-up");
    }
  }

  const selectedApp = applications.find((a) => a.id === selectedId) ?? null;
  const openApps = applications.filter((a) => !["awarded", "declined"].includes(a.status)).length;
  const awardedApps = applications.filter((a) => a.status === "awarded");
  const totalAwarded = awardedApps.reduce((sum, a) => sum + Number(a.amountAwardedUsd ?? 0), 0);
  const doneItems = items.filter((item) => item.done).length;

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / GRANTS</span>
          <h1>Grant tracker &amp; writing workspace</h1>
          <p className="app-muted">
            Track funders, draft prompt-by-prompt essays with character limits, and keep the Business portal
            pipeline in sync. Empty lists are real — nothing is invented until you add it.
          </p>
        </div>
        <nav className="intel-actions" aria-label="Grants workbench links">
          <a href={`/business?orgId=${encodeURIComponent(orgId)}&tab=grants`}>Business · Grants</a>
          <a href={`/team/awards?orgId=${encodeURIComponent(orgId)}`}>Awards workbench</a>
          <a href={`/team/sponsors?orgId=${encodeURIComponent(orgId)}`}>Sponsors</a>
          <a href={`/team?orgId=${encodeURIComponent(orgId)}`}>Team admin</a>
        </nav>
      </header>

      {message ? (
        <p role="status" className={`telemetry-status${messageTone === "ok" ? " success" : ""}`}>
          {message}
        </p>
      ) : null}
      {loading ? <p className="app-muted">Loading grants…</p> : null}

      {!loading ? (
        <section className="metric-grid">
          <article>
            <span>Open applications</span>
            <strong>{openApps}</strong>
          </article>
          <article>
            <span>Awarded</span>
            <strong>{awardedApps.length}</strong>
          </article>
          <article>
            <span>Total awarded</span>
            <strong>{money(totalAwarded)}</strong>
          </article>
          <article>
            <span>Grant sources</span>
            <strong>{opportunities.length}</strong>
          </article>
        </section>
      ) : null}

      {!loading && opportunities.length === 0 && applications.length === 0 ? (
        <section className="app-empty">
          <span className="eyebrow">EMPTY PIPELINE</span>
          <h2>No grant work tracked yet</h2>
          <p>
            Start by saving a funder opportunity, then open an application. You can also add quick pipeline rows from{" "}
            <a href={`/business?orgId=${encodeURIComponent(orgId)}&tab=grants`}>Business · Grants</a> and finish
            essays here.
          </p>
        </section>
      ) : null}

      {!loading ? (
        <section className="admin-grid">
          <form className="intel-panel" onSubmit={addOpportunity}>
            <span className="eyebrow">TRACK A GRANT OPPORTUNITY</span>
            <label>
              Name
              <input
                required
                value={oppForm.name}
                onChange={(e) => setOppForm({ ...oppForm, name: e.target.value })}
                placeholder="NASA HUNCH robotics grant"
              />
            </label>
            <label>
              Funder
              <input
                value={oppForm.funder}
                onChange={(e) => setOppForm({ ...oppForm, funder: e.target.value })}
                placeholder="Community Foundation"
              />
            </label>
            <div className="budget-fields">
              <label>
                Min amount ($)
                <input
                  type="number"
                  min="0"
                  value={oppForm.amountMinUsd}
                  onChange={(e) => setOppForm({ ...oppForm, amountMinUsd: e.target.value })}
                />
              </label>
              <label>
                Max amount ($)
                <input
                  type="number"
                  min="0"
                  value={oppForm.amountMaxUsd}
                  onChange={(e) => setOppForm({ ...oppForm, amountMaxUsd: e.target.value })}
                />
              </label>
            </div>
            <label>
              Deadline
              <input
                type="date"
                value={oppForm.deadline}
                onChange={(e) => setOppForm({ ...oppForm, deadline: e.target.value })}
              />
            </label>
            <label>
              Application URL
              <input
                type="url"
                value={oppForm.applicationUrl}
                onChange={(e) => setOppForm({ ...oppForm, applicationUrl: e.target.value })}
                placeholder="https://…"
              />
            </label>
            <label>
              Notes
              <input
                value={oppForm.description}
                onChange={(e) => setOppForm({ ...oppForm, description: e.target.value })}
                placeholder="Eligibility, reporting, attachments…"
              />
            </label>
            <button className="primary-action" type="submit">
              Save opportunity
            </button>
          </form>

          <section className="intel-panel invite-list">
            <span className="eyebrow">GRANT OPPORTUNITIES</span>
            {opportunities.length === 0 ? (
              <p className="app-muted">No opportunities yet — save one on the left, or add a grant from Business.</p>
            ) : (
              opportunities.map((o) => (
                <article key={o.id}>
                  <div>
                    <strong>{o.name}</strong>
                    <small>
                      {[o.funder, o.deadline ? new Date(o.deadline).toLocaleDateString() : "no deadline"]
                        .filter(Boolean)
                        .join(" · ")}
                      {o.amountMinUsd || o.amountMaxUsd
                        ? ` · $${o.amountMinUsd ?? "?"}–$${o.amountMaxUsd ?? "?"}`
                        : ""}
                    </small>
                  </div>
                  {o.applicationUrl ? (
                    <a href={o.applicationUrl} target="_blank" rel="noreferrer">
                      Source ↗
                    </a>
                  ) : null}
                </article>
              ))
            )}
          </section>
        </section>
      ) : null}

      {!loading ? (
        <section className="admin-grid">
          <form className="intel-panel" onSubmit={startApplication}>
            <span className="eyebrow">START AN APPLICATION</span>
            <label>
              Opportunity
              <select
                value={appForm.grantOpportunityId}
                onChange={(e) => setAppForm({ ...appForm, grantOpportunityId: e.target.value })}
              >
                <option value="">Not linked / general grant</option>
                {opportunities.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount requested ($)
              <input
                type="number"
                min="0"
                value={appForm.amountRequestedUsd}
                onChange={(e) => setAppForm({ ...appForm, amountRequestedUsd: e.target.value })}
              />
            </label>
            <button className="primary-action" type="submit">
              Start application
            </button>
          </form>

          <section className="intel-panel invite-list">
            <span className="eyebrow">APPLICATIONS</span>
            {applications.length === 0 ? (
              <p className="app-muted">No applications yet. Start one here after you have an opportunity, or open Business · Grants.</p>
            ) : (
              applications.map((a) => (
                <article
                  key={a.id}
                  onClick={() => void loadItems(a.id)}
                  style={{ cursor: "pointer" }}
                  data-selected={selectedId === a.id ? "true" : undefined}
                >
                  <div>
                    <strong>{a.opportunityName ?? "General grant application"}</strong>
                    <small>
                      {a.seasonYear} · {statusLabel(a.status)}
                      {a.amountRequestedUsd ? ` · ${money(a.amountRequestedUsd)} requested` : ""}
                      {a.status === "awarded" && a.amountAwardedUsd ? ` · ${money(a.amountAwardedUsd)} awarded` : ""}
                    </small>
                  </div>
                  <select
                    value={a.status}
                    aria-label={`Status for ${a.opportunityName ?? "application"}`}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      void updateStatus(a.id, e.target.value);
                    }}
                  >
                    {GRANT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {grantStatusLabel(s)}
                      </option>
                    ))}
                  </select>
                </article>
              ))
            )}
          </section>
        </section>
      ) : null}

      {selectedApp ? (
        <section className="compare-panel">
          <span className="eyebrow">
            {(selectedApp.opportunityName ?? "APPLICATION").toUpperCase()} — WRITING ITEMS
          </span>
          <p className="app-muted">
            {doneItems}/{items.length} items marked done · click another application to switch.
          </p>

          <div className="intel-panel">
            {items.length === 0 ? (
              <p className="app-muted">
                No prompts yet. Add essay questions, attachments, or requirements below — or paste requirements when
                creating the grant in Business.
              </p>
            ) : (
              items.map((item) => (
                <article key={item.id}>
                  <div>
                    <strong>{item.kind}</strong>
                    {item.prompt ? <small>{item.prompt}</small> : null}
                  </div>
                  <textarea
                    rows={4}
                    defaultValue={item.content ?? ""}
                    key={`${item.id}-${item.content ?? ""}`}
                    onBlur={(e) => void saveItem(item.id, e.target.value)}
                    maxLength={item.charLimit ?? undefined}
                    placeholder="Draft response…"
                  />
                  {item.charLimit ? (
                    <small>
                      {(item.content ?? "").length}/{item.charLimit} characters
                    </small>
                  ) : null}
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={(e) => void toggleDone(item.id, e.target.checked)}
                    />{" "}
                    Done
                  </label>
                </article>
              ))
            )}

            <form onSubmit={addItem}>
              <label>
                Kind
                <select value={itemForm.kind} onChange={(e) => setItemForm({ ...itemForm, kind: e.target.value })}>
                  {GRANT_ITEM_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Prompt
                <input
                  value={itemForm.prompt}
                  onChange={(e) => setItemForm({ ...itemForm, prompt: e.target.value })}
                  placeholder="Describe the team’s community impact…"
                />
              </label>
              <label>
                Character limit
                <input
                  type="number"
                  min="0"
                  value={itemForm.charLimit}
                  onChange={(e) => setItemForm({ ...itemForm, charLimit: e.target.value })}
                />
              </label>
              <button className="primary-action" type="submit">
                Add item
              </button>
            </form>
          </div>

          <div className="intel-panel">
            <span className="eyebrow">STATUS &amp; FOLLOW-UP</span>
            {selectedApp.status === "awarded" || selectedApp.status === "submitted" ? (
              <div className="budget-fields">
                <label>
                  Amount awarded ($)
                  <input
                    type="number"
                    min="0"
                    value={awardedAmount || selectedApp.amountAwardedUsd || ""}
                    onChange={(e) => setAwardedAmount(e.target.value)}
                    placeholder={selectedApp.amountRequestedUsd ?? "0"}
                  />
                </label>
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => void updateStatus(selectedApp.id, "awarded", awardedAmount || selectedApp.amountRequestedUsd || "")}
                >
                  Record as awarded
                </button>
              </div>
            ) : null}
            <button type="button" onClick={() => void draftFollowup()}>
              Draft follow-up email
            </button>
            {draft ? (
              <div>
                <label>
                  Subject
                  <input value={draft.subject} readOnly />
                </label>
                <label>
                  Body
                  <textarea rows={8} value={draft.body} readOnly />
                </label>
              </div>
            ) : null}
            <p className="app-muted">
              Pipeline overview stays on{" "}
              <a href={`/business?orgId=${encodeURIComponent(orgId)}&tab=grants`}>Business · Grants</a>.
            </p>
          </div>
        </section>
      ) : null}
    </main>
  );
}
