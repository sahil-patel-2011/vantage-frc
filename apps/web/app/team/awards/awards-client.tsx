"use client";

import { useEffect, useState } from "react";
import { EmptyState, PageHeader } from "../../../components/ui";
import {
  AWARD_CATALOG,
  AWARD_ITEM_KINDS,
  AWARD_STATUSES,
  awardCatalogEntry,
  awardStatusLabel,
} from "../../../lib/awards";

type Submission = {
  id: string;
  seasonYear: number;
  awardType: string;
  title?: string | null;
  status: string;
  deadline?: string | null;
  totalItems: number;
  doneItems: number;
};

type Item = {
  id: string;
  kind?: string;
  prompt: string | null;
  content: string | null;
  charLimit: number | null;
  done?: boolean;
};

function statusLabel(status: string) {
  return AWARD_STATUSES.includes(status as (typeof AWARD_STATUSES)[number])
    ? awardStatusLabel(status as (typeof AWARD_STATUSES)[number])
    : status;
}

export default function AwardsClient({ orgId }: { orgId: string }) {
  const seasonYear = new Date().getFullYear();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "error">("ok");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    awardType: AWARD_CATALOG[0]!.slug,
    eventKey: "",
    deadline: "",
  });
  const [itemForm, setItemForm] = useState({ kind: "essay", prompt: "", charLimit: "" });

  function flash(ok: boolean, text: string) {
    setMessageTone(ok ? "ok" : "error");
    setMessage(text);
  }

  async function load() {
    setLoading(true);
    const response = await fetch(`/api/awards?orgId=${encodeURIComponent(orgId)}`);
    const data = await response.json();
    setSubmissions(data.submissions ?? []);
    if (!response.ok) flash(false, data.error ?? "Unable to load award submissions");
    else setMessage("");
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function loadItems(submissionId: string) {
    setSelectedId(submissionId);
    const response = await fetch(
      `/api/awards/items?orgId=${encodeURIComponent(orgId)}&submissionId=${encodeURIComponent(submissionId)}`,
    );
    const data = await response.json();
    setItems(data.items ?? []);
    if (!response.ok) flash(false, data.error ?? "Unable to load essay items");
  }

  async function addSubmission(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/awards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, seasonYear, ...form }),
    });
    const data = await response.json();
    flash(
      response.ok,
      response.ok ? "Award submission started — essay prompts pre-loaded." : (data.error ?? "Could not start submission"),
    );
    if (response.ok) {
      setForm({ awardType: AWARD_CATALOG[0]!.slug, eventKey: "", deadline: "" });
      await load();
      if (data.submission?.id) await loadItems(data.submission.id as string);
    }
  }

  async function updateStatus(id: string, status: string) {
    const response = await fetch("/api/awards", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, id, status }),
    });
    const data = await response.json();
    flash(response.ok, response.ok ? "Status updated." : (data.error ?? "Could not update status"));
    if (response.ok) await load();
  }

  async function saveItem(id: string, content: string) {
    const response = await fetch("/api/awards/items", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, id, content }),
    });
    if (!response.ok) {
      const data = await response.json();
      flash(false, data.error ?? "Could not save essay");
      return;
    }
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, content } : item)));
    if (selectedId) await load();
  }

  async function toggleDone(id: string, done: boolean) {
    const response = await fetch("/api/awards/items", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, id, done }),
    });
    if (!response.ok) {
      const data = await response.json();
      flash(false, data.error ?? "Could not update item");
      return;
    }
    if (selectedId) {
      await loadItems(selectedId);
      await load();
    }
  }

  async function addItem(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    const response = await fetch("/api/awards/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        submissionId: selectedId,
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
      await load();
    }
  }

  const selected = submissions.find((s) => s.id === selectedId) ?? null;
  const seasonSubs = submissions.filter((s) => s.seasonYear === seasonYear);
  const totalWon = submissions.filter((s) => s.status === "won").length;
  const inProgress = submissions.filter((s) => !["won", "not_selected"].includes(s.status)).length;
  const catalog = awardCatalogEntry(form.awardType);

  return (
    <main className="module-page business-page biz-workbench">
      <PageHeader
        breadcrumbs={
          <>
            <a href={`/business?orgId=${encodeURIComponent(orgId)}`}>Business</a>
            {" / Awards"}
          </>
        }
        title="Awards workbench"
        description={
          <>
            Start a catalog award to seed essay prompts, draft responses here, then record wins in{" "}
            <a href={`/business?orgId=${encodeURIComponent(orgId)}&tab=evidence`}>Business · Awards</a> for grant
            writing. Empty means nothing has been started — not a placeholder scoreboard.
          </>
        }
      >
        <div className="biz-header-actions">
          <a className="app-button" href={`/business?orgId=${encodeURIComponent(orgId)}&tab=evidence`}>
            Business · Awards
          </a>
          <a className="app-button secondary" href={`/team/grants?orgId=${encodeURIComponent(orgId)}`}>
            Grants
          </a>
          <a className="app-button secondary" href={`/impact?orgId=${encodeURIComponent(orgId)}`}>
            Impact
          </a>
        </div>
      </PageHeader>

      {message ? (
        <p role="status" className={`telemetry-status${messageTone === "ok" ? " success" : ""}`}>
          {message}
        </p>
      ) : null}
      {loading ? (
        <EmptyState soft title="Loading awards…" description="Fetching submissions and essay items." aria-busy />
      ) : null}

      {!loading ? (
        <section className="biz-summary" aria-label="Awards summary">
          <div className="biz-summary-tile">
            <strong>{seasonSubs.length}</strong>
            <span>Submissions · {seasonYear}</span>
          </div>
          <div className="biz-summary-tile">
            <strong>{totalWon}</strong>
            <span>Won (tracked)</span>
          </div>
          <div className="biz-summary-tile">
            <strong>{inProgress}</strong>
            <span>In progress</span>
          </div>
          <div className="biz-summary-tile">
            <strong>{AWARD_CATALOG.length}</strong>
            <span>Catalog awards</span>
          </div>
        </section>
      ) : null}

      {!loading && submissions.length === 0 ? (
        <EmptyState
          soft
          badge="Empty"
          badgeTone="good"
          title="No FIRST award submissions yet"
          description={
            <>
              Pick an award from the FIRST catalog to pre-load essay prompts. Wins you already earned can be logged on{" "}
              <a href={`/business?orgId=${encodeURIComponent(orgId)}&tab=evidence`}>Business · Awards</a> without
              inventing history.
            </>
          }
        >
          <a className="app-button" href={`/business?orgId=${encodeURIComponent(orgId)}&tab=evidence`}>
            Log award evidence
          </a>
        </EmptyState>
      ) : null}

      {!loading ? (
        <section className="admin-grid">
          <form className="app-card soft-panel" onSubmit={addSubmission}>
            <span className="eyebrow">START AN AWARD SUBMISSION</span>
            <label>
              Award
              <select value={form.awardType} onChange={(e) => setForm({ ...form, awardType: e.target.value })}>
                {AWARD_CATALOG.map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            {catalog ? <p className="app-muted">{catalog.description}</p> : null}
            {catalog?.essayPrompts.length ? (
              <p className="app-muted">
                Seeds {catalog.essayPrompts.length} essay prompt{catalog.essayPrompts.length === 1 ? "" : "s"}.
              </p>
            ) : null}
            <label>
              Event key (optional)
              <input
                value={form.eventKey}
                onChange={(e) => setForm({ ...form, eventKey: e.target.value })}
                placeholder="2027mnmin"
              />
            </label>
            <label>
              Deadline
              <input
                type="date"
                value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
              />
            </label>
            <button className="app-button" type="submit">
              Start submission
            </button>
          </form>

          <section className="app-card soft-panel invite-list">
            <span className="eyebrow">SUBMISSIONS</span>
            {submissions.length === 0 ? (
              <p className="app-muted">No submissions yet — start one from the catalog on the left.</p>
            ) : (
              submissions.map((s) => (
                <article
                  key={s.id}
                  onClick={() => void loadItems(s.id)}
                  style={{ cursor: "pointer" }}
                  data-selected={selectedId === s.id ? "true" : undefined}
                >
                  <div>
                    <strong>{awardCatalogEntry(s.awardType)?.name ?? s.title ?? s.awardType}</strong>
                    <small>
                      {s.seasonYear} · {statusLabel(s.status)} · {s.doneItems}/{s.totalItems} items done
                      {s.deadline ? ` · due ${new Date(s.deadline).toLocaleDateString()}` : ""}
                    </small>
                  </div>
                  <select
                    value={s.status}
                    aria-label={`Status for ${awardCatalogEntry(s.awardType)?.name ?? s.awardType}`}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      void updateStatus(s.id, e.target.value);
                    }}
                  >
                    {AWARD_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {awardStatusLabel(st)}
                      </option>
                    ))}
                  </select>
                </article>
              ))
            )}
          </section>
        </section>
      ) : null}

      {selected ? (
        <section className="compare-panel">
          <span className="eyebrow">
            {(awardCatalogEntry(selected.awardType)?.name ?? selected.awardType).toUpperCase()} — ESSAY ITEMS
          </span>
          <p className="app-muted">
            Drafts save on blur. Mark items done as you finish. Set status to Won when the team receives the award —
            that feeds Business evidence for grant writing.
          </p>

          <div className="app-card soft-panel">
            {items.length === 0 ? (
              <p className="app-muted">No essay items on this submission yet. Add a prompt below.</p>
            ) : (
              items.map((item) => (
                <article key={item.id}>
                  {item.prompt ? <p>{item.prompt}</p> : <strong>{item.kind ?? "essay"}</strong>}
                  <textarea
                    rows={5}
                    defaultValue={item.content ?? ""}
                    key={`${item.id}-${item.content ?? ""}`}
                    onBlur={(e) => void saveItem(item.id, e.target.value)}
                    maxLength={item.charLimit ?? undefined}
                    placeholder="Draft essay response…"
                  />
                  {item.charLimit ? (
                    <small>
                      {(item.content ?? "").length}/{item.charLimit} characters
                    </small>
                  ) : null}
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={Boolean(item.done)}
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
                  {AWARD_ITEM_KINDS.map((kind) => (
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
                  placeholder="Additional essay or task prompt…"
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
              <button className="app-button" type="submit">
                Add item
              </button>
            </form>
          </div>
        </section>
      ) : null}
    </main>
  );
}
