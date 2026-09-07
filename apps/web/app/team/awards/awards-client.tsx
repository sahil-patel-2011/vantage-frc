"use client";

import { useEffect, useMemo, useState } from "react";
import { BusinessRelated } from "../../../components/business-related";
import { EmptyState, PageHeader } from "../../../components/ui";
import {
  AWARD_CATALOG,
  AWARD_ITEM_KINDS,
  AWARD_STATUSES,
  awardCatalogEntry,
  awardStatusLabel,
} from "../../../lib/awards";
import { answerText, slugForFile } from "../../../lib/awards-export";
import { AWARDS_RELATED_INCLUDE } from "../../../lib/business/business-related";
import { awardsNextActions } from "../../../lib/business/awards-next-actions";
import { copyToClipboard, downloadTextFile } from "../../../lib/copy-download";
import "./awards.css";

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

function AwardsNextActions({
  actions,
}: {
  actions: ReturnType<typeof awardsNextActions>;
}) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions awards-next-actions" aria-label="Next actions">
      <header>
        <span className="biz-overline">Next actions</span>
        <h2>Draft essays from real submissions</h2>
        <p>Counts reflect submissions you start — never DEMO win rates or invented award dollars.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={action.label}>Open</a>
          </li>
        ))}
      </ol>
    </section>
  );
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

  /** Per-answer copy / download — built client-side from the drafted text, never from a placeholder. */
  async function copyAnswer(item: Item, index: number) {
    const ok = await copyToClipboard(answerText({ index, prompt: item.prompt, content: item.content, kind: item.kind }));
    flash(ok, ok ? `Copied answer ${index}.` : "Clipboard is unavailable in this browser.");
  }

  function downloadAnswer(item: Item, index: number) {
    const stem = selected ? slugForFile(awardCatalogEntry(selected.awardType)?.name ?? selected.awardType) : "award";
    const ok = downloadTextFile(
      `${stem}-q${index}.txt`,
      `${answerText({ index, prompt: item.prompt, content: item.content, kind: item.kind })}\n`,
    );
    if (!ok) flash(false, "Downloads are unavailable in this browser.");
  }

  /** Whole submission: the server assembles every answer (`export` action) so the file matches the DB. */
  async function fetchExport(submissionId: string) {
    const response = await fetch(
      `/api/awards?orgId=${encodeURIComponent(orgId)}&action=export&submissionId=${encodeURIComponent(submissionId)}`,
    );
    const data = (await response.json()) as { text?: string; bundle?: unknown; fileStem?: string; error?: string };
    if (!response.ok || !data.text) throw new Error(data.error ?? "Could not export this submission");
    return { text: data.text, bundle: data.bundle, fileStem: data.fileStem ?? "award" };
  }

  async function copyAll(submissionId: string) {
    try {
      const exported = await fetchExport(submissionId);
      const ok = await copyToClipboard(exported.text);
      flash(ok, ok ? "Copied every answer." : "Clipboard is unavailable in this browser.");
    } catch (error) {
      flash(false, error instanceof Error ? error.message : "Could not export this submission");
    }
  }

  async function downloadAll(submissionId: string, format: "text" | "json") {
    try {
      const exported = await fetchExport(submissionId);
      const ok =
        format === "json"
          ? downloadTextFile(`${exported.fileStem}.json`, JSON.stringify(exported.bundle, null, 2), "application/json")
          : downloadTextFile(`${exported.fileStem}.txt`, exported.text);
      if (!ok) flash(false, "Downloads are unavailable in this browser.");
    } catch (error) {
      flash(false, error instanceof Error ? error.message : "Could not export this submission");
    }
  }

  const selected = submissions.find((s) => s.id === selectedId) ?? null;
  const seasonSubs = submissions.filter((s) => s.seasonYear === seasonYear);
  const totalWon = submissions.filter((s) => s.status === "won").length;
  const inProgress = submissions.filter((s) => !["won", "not_selected"].includes(s.status)).length;
  const incompleteEssayCount = useMemo(
    () => submissions.reduce((sum, s) => sum + Math.max(0, (s.totalItems ?? 0) - (s.doneItems ?? 0)), 0),
    [submissions],
  );
  const catalog = awardCatalogEntry(form.awardType);
  const nextActions = awardsNextActions({
    orgId,
    submissionCount: submissions.length,
    inProgressCount: inProgress,
    wonCount: totalWon,
    incompleteEssayCount,
  });

  return (
    <main className="module-page awards-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={`/business?orgId=${encodeURIComponent(orgId)}`}>Business</a>
            {" / Awards workbench"}
          </>
        }
        title="FIRST award submissions"
        description="Start a catalog award to seed essay prompts, draft responses here, then record wins in Business · Awards for grant writing. Empty means nothing started — not a placeholder scoreboard."
      />

      <BusinessRelated
        orgId={orgId}
        active="awards"
        include={AWARDS_RELATED_INCLUDE}
        ariaLabel="Related awards and impact tools"
      />

      {message ? (
        <p role="status" className={`awards-status${messageTone === "ok" ? " ok" : ""}`}>
          {message}
        </p>
      ) : null}

      {loading ? (
        <EmptyState soft title="Loading awards…" description="Opening this workspace’s FIRST submissions." aria-busy />
      ) : (
        <>
          <AwardsNextActions actions={nextActions} />

          <section className="app-card soft-panel awards-stats" aria-label="Awards season summary">
            <header className="biz-card-head">
              <div>
                <span className="biz-overline">Tracked submissions</span>
                <h2 style={{ margin: 0, fontSize: 16 }}>From work you started only</h2>
              </div>
            </header>
            <div className="soft-snapshot-grid">
              <div>
                <strong>{seasonSubs.length}</strong>
                <span>submissions · {seasonYear}</span>
              </div>
              <div>
                <strong>{totalWon}</strong>
                <span>won (tracked)</span>
              </div>
              <div>
                <strong>{inProgress}</strong>
                <span>in progress</span>
              </div>
              <div>
                <strong>{AWARD_CATALOG.length}</strong>
                <span>catalog awards</span>
              </div>
            </div>
          </section>

          {submissions.length === 0 ? (
            <EmptyState
              soft
              badge="Empty workbench"
              badgeTone="setup"
              title="No FIRST award submissions yet"
              description="Pick an award from the FIRST catalog to pre-load essay prompts. Wins you already earned can be logged on Business · Awards & evidence without inventing history."
            >
              <BusinessRelated
                orgId={orgId}
                include={["impact", "evidence", "grants", "sponsors"]}
                ariaLabel="Empty awards related links"
              />
            </EmptyState>
          ) : null}

          <div className="awards-grid">
            <form className="app-card soft-panel awards-form" onSubmit={addSubmission}>
              <span className="biz-overline">Start a submission</span>
              <h2>Catalog award</h2>
              <div className="awards-fields">
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
                {catalog ? <p>{catalog.description}</p> : null}
                {catalog?.essayPrompts.length ? (
                  <p>
                    Seeds {catalog.essayPrompts.length} essay prompt
                    {catalog.essayPrompts.length === 1 ? "" : "s"}.
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
              </div>
              <button className="app-button" type="submit">
                Start submission
              </button>
            </form>

            <section className="app-card soft-panel awards-list" aria-label="Award submissions">
              <span className="biz-overline">This workspace</span>
              <h2>Submissions</h2>
              {submissions.length === 0 ? (
                <p className="app-muted" style={{ margin: 0, fontSize: 13 }}>
                  No submissions yet — start one from the catalog on the left.
                </p>
              ) : (
                <ul className="awards-submission-list">
                  {submissions.map((s) => (
                    <li
                      key={s.id}
                      onClick={() => void loadItems(s.id)}
                      data-selected={selectedId === s.id ? "true" : undefined}
                    >
                      <div>
                        <strong>{awardCatalogEntry(s.awardType)?.name ?? s.title ?? s.awardType}</strong>
                        <span>
                          {s.seasonYear} · {statusLabel(s.status)} · {s.doneItems}/{s.totalItems} items done
                          {s.deadline ? ` · due ${new Date(s.deadline).toLocaleDateString()}` : ""}
                        </span>
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
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {selected ? (
            <section className="app-card soft-panel awards-items" aria-label="Essay items">
              <span className="biz-overline">
                {(awardCatalogEntry(selected.awardType)?.name ?? selected.awardType).toUpperCase()}
              </span>
              <h2>Essay items</h2>
              <p>
                Drafts save on blur. Mark items done as you finish. Set status to Won when the team receives the award —
                that feeds Business evidence for grant writing.
              </p>
              <div className="awards-export-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="app-button secondary sm" onClick={() => void copyAll(selected.id)}>
                  Copy all answers
                </button>
                <button
                  type="button"
                  className="app-button secondary sm"
                  onClick={() => void downloadAll(selected.id, "text")}
                >
                  Download .txt
                </button>
                <button
                  type="button"
                  className="app-button secondary sm"
                  onClick={() => void downloadAll(selected.id, "json")}
                >
                  Download .json bundle
                </button>
              </div>

              {items.length === 0 ? (
                <p className="app-muted" style={{ margin: 0, fontSize: 13 }}>
                  No essay items on this submission yet. Add a prompt below.
                </p>
              ) : (
                <ul className="awards-item-list">
                  {items.map((item, index) => (
                    <li key={item.id}>
                      {item.prompt ? <p>{item.prompt}</p> : <strong>{item.kind ?? "essay"}</strong>}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="app-button secondary sm"
                          onClick={() => void copyAnswer(item, index + 1)}
                        >
                          Copy answer
                        </button>
                        <button
                          type="button"
                          className="app-button secondary sm"
                          onClick={() => downloadAnswer(item, index + 1)}
                        >
                          Download
                        </button>
                      </div>
                      <textarea
                        rows={5}
                        defaultValue={item.content ?? ""}
                        key={`${item.id}-${item.content ?? ""}`}
                        onBlur={(e) => void saveItem(item.id, e.target.value)}
                        maxLength={item.charLimit ?? undefined}
                        placeholder="Draft essay response…"
                      />
                      {item.charLimit ? (
                        <small className="app-muted">
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
                    </li>
                  ))}
                </ul>
              )}

              <form className="awards-add-item" onSubmit={addItem}>
                <span className="biz-overline">Add item</span>
                <div className="awards-add-item-row">
                  <label>
                    Kind
                    <select
                      value={itemForm.kind}
                      onChange={(e) => setItemForm({ ...itemForm, kind: e.target.value })}
                    >
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
                </div>
                <button className="app-button secondary" type="submit">
                  Add item
                </button>
              </form>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
