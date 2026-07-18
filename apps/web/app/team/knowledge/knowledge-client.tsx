"use client";

import { useCallback, useEffect, useState } from "react";
import {
  KNOWLEDGE_TEMPLATES,
  KNOWLEDGE_TEMPLATE_KINDS,
  MAX_BODY,
  TEMPLATE_KIND_LABEL,
  type KnowledgeTemplateKind,
  type KnowledgeWikiView,
} from "../../../lib/knowledge";
import "./knowledge.css";

type Tab = "wiki" | "search" | "templates" | "ai";
type LinkTargetType = "decision" | "design_review";

export default function KnowledgeClient() {
  const [view, setView] = useState<KnowledgeWikiView | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("wiki");
  const [searchDraft, setSearchDraft] = useState("");
  const [creating, setCreating] = useState(false);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftTemplate, setDraftTemplate] = useState<KnowledgeTemplateKind>("blank");
  const [draftSeason, setDraftSeason] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftPinned, setDraftPinned] = useState(false);

  const [linkType, setLinkType] = useState<LinkTargetType>("decision");
  const [linkTargetId, setLinkTargetId] = useState("");
  const [linkNote, setLinkNote] = useState("");

  const [aiContent, setAiContent] = useState("");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiUpdatedAt, setAiUpdatedAt] = useState<string | null>(null);
  const [canEditAi, setCanEditAi] = useState(false);

  const orgId = view && view.status === "ready" ? view.orgId : "";
  const ready = view?.status === "ready" ? view : null;

  const load = useCallback(async (opts?: { pageId?: string; page?: string; q?: string }) => {
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    if (urlOrg) params.set("orgId", urlOrg);
    // Soft-UI hub redirects used to emit revisionId; wiki API expects pageId.
    const revisionId = params.get("revisionId");
    if (revisionId && !params.get("pageId")) params.set("pageId", revisionId);
    params.delete("revisionId");
    if (opts?.pageId) params.set("pageId", opts.pageId);
    if (opts?.page) params.set("page", opts.page);
    if (opts?.q) params.set("q", opts.q);
    try {
      const response = await fetch(`/api/team/wiki?${params}`);
      const data = (await response.json()) as KnowledgeWikiView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load knowledge base.");
        return;
      }
      setError("");
      setView(data);
      if (data.status === "ready" && data.selected && !opts?.q) {
        setDraftTitle(data.selected.title);
        setDraftBody(data.selected.body);
        setDraftTemplate(data.selected.templateKind);
        setDraftSeason(data.selected.seasonYear != null ? String(data.selected.seasonYear) : "");
        setDraftTags(data.selected.tags.join(", "));
        setDraftPinned(data.selected.pinned);
        setCreating(false);
      }
    } catch {
      setError("Network error loading knowledge base.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadAi = useCallback(async () => {
    if (!orgId) return;
    const response = await fetch(`/api/agent/knowledge?orgId=${encodeURIComponent(orgId)}`);
    const data = await response.json();
    if (response.ok) {
      setAiContent(data.content ?? "");
      setAiEnabled(data.enabled ?? true);
      setAiUpdatedAt(data.updatedAt ?? null);
      setCanEditAi(Boolean(data.canEdit));
    }
  }, [orgId]);

  useEffect(() => {
    if (tab === "ai" && orgId) void loadAi();
  }, [tab, orgId, loadAi]);

  async function run(payload: Record<string, unknown>) {
    if (!orgId || busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/team/wiki", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...payload }),
      });
      const data = (await response.json()) as KnowledgeWikiView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not save.");
        return;
      }
      setView(data);
      setStatus("Saved.");
      setCreating(false);
      if (data.status === "ready" && data.selected) {
        setDraftTitle(data.selected.title);
        setDraftBody(data.selected.body);
        setDraftTemplate(data.selected.templateKind);
        setDraftSeason(data.selected.seasonYear != null ? String(data.selected.seasonYear) : "");
        setDraftTags(data.selected.tags.join(", "));
        setDraftPinned(data.selected.pinned);
      }
    } catch {
      setError("Network error — nothing was saved.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAi() {
    if (!orgId || !canEditAi) return;
    setBusy(true);
    try {
      const response = await fetch("/api/agent/knowledge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, content: aiContent, enabled: aiEnabled }),
      });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? "Could not save AI context.");
      else {
        setStatus("Assistant summary saved.");
        await loadAi();
      }
    } finally {
      setBusy(false);
    }
  }

  const teamLabel = ready?.teamNumber ? `Team ${ready.teamNumber}` : "Team";

  return (
    <main className="module-page kb-page">
      <header className="kb-hero">
        <div>
          <h1>Knowledge Base</h1>
          <p>
            Searchable wiki with handoff templates, linked to decisions and design reviews. The FRC Assistant
            and CAD agent retrieve these as tools — empty corpus means empty answers, never invented history.
          </p>
        </div>
        <div className="kb-hero-actions">
          {orgId && (
            <>
              <a className="button secondary" href={`/team/getting-started?orgId=${orgId}`}>
                Getting started
              </a>
              <a className="button secondary" href={`/team/calendar?orgId=${orgId}`}>
                Calendar
              </a>
              <a className="button secondary" href={`/logistics?orgId=${orgId}`}>
                Logistics
              </a>
              <a className="button secondary" href={`/kickoff?orgId=${orgId}`}>
                Kickoff
              </a>
              <a className="button secondary" href={`/chat?orgId=${orgId}`}>
                FRC Assistant
              </a>
              <a className="button secondary" href={`/decisions?orgId=${orgId}`}>
                Decisions
              </a>
              <a className="button secondary" href={`/reviews?orgId=${orgId}`}>
                Reviews
              </a>
            </>
          )}
        </div>
      </header>

      <div className="kb-tabs" role="tablist" aria-label="Knowledge sections">
        {(
          [
            ["wiki", "Wiki"],
            ["search", "Search history"],
            ["templates", "Templates"],
            ["ai", "Assistant summary"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {error && <p className="kb-alert" role="alert">{error}</p>}
      {status && <p className="kb-status" role="status">{status}</p>}

      {view?.status === "setup_required" && <p className="kb-alert">{view.message}</p>}

      {tab === "search" && ready && (
        <section className="kb-main">
          <h2>Cross-season search</h2>
          <form
            className="kb-tools"
            onSubmit={(e) => {
              e.preventDefault();
              void load({ q: searchDraft });
            }}
          >
            <input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder='e.g. "swerve over tank"'
              aria-label="Search wiki, decisions, and reviews"
            />
            <button type="submit" className="button primary" disabled={busy}>
              Search
            </button>
          </form>
          {ready.searchQuery && ready.searchHits.length === 0 && (
            <p className="kb-list-empty">No wiki pages, decisions, or reviews matched “{ready.searchQuery}”.</p>
          )}
          <ul className="kb-list" style={{ marginTop: 12 }}>
            {ready.searchHits.map((hit) => (
              <li key={`${hit.source}:${hit.id}`}>
                <a className="kb-list-item" href={hit.href}>
                  <b>{hit.title}</b>
                  <small>
                    {hit.source.replace("_", " ")}
                    {hit.seasonYear != null ? ` · ${hit.seasonYear}` : ""}
                  </small>
                  {hit.snippet && <small>{hit.snippet}</small>}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "templates" && ready && (
        <section className="kb-main kb-templates">
          <h2>Handoff templates</h2>
          <p className="kb-meta">Create a structured page — fill in real team facts; nothing is pre-filled with demo data.</p>
          <div className="kb-template-grid">
            {KNOWLEDGE_TEMPLATES.map((tpl) => (
              <button
                key={tpl.kind}
                type="button"
                className="kb-template"
                disabled={busy}
                onClick={() =>
                  void run({
                    action: "upsert_page",
                    fromTemplate: tpl.kind,
                    templateKind: tpl.kind,
                    seasonYear: new Date().getFullYear(),
                  })
                }
              >
                <span className="kb-badge handoff">{tpl.kind.replace("_", " ")}</span>
                <strong>{tpl.title}</strong>
                <span>{tpl.blurb}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {tab === "ai" && ready && (
        <section className="kb-main kb-ai">
          <h2>Assistant summary</h2>
          <p className="kb-ai-hint">
            One markdown document injected into every team-scope chat. Prefer durable facts here; put structured
            handoffs and linked decisions in the Wiki.
            {aiUpdatedAt ? ` Updated ${new Date(aiUpdatedAt).toLocaleString()}.` : ""}
          </p>
          <textarea
            className="kb-body"
            value={aiContent}
            readOnly={!canEditAi}
            maxLength={20000}
            onChange={(e) => setAiContent(e.target.value)}
          />
          {canEditAi && (
            <>
              <label className="kb-row">
                <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
                Include in assistant prompts
              </label>
              <div className="kb-actions">
                <button type="button" className="button primary" disabled={busy} onClick={() => void saveAi()}>
                  Save assistant summary
                </button>
              </div>
            </>
          )}
          <div className="kb-ai-links">
            <a href={`/team/knowledge/history?orgId=${orgId}`}>Revision history</a>
          </div>
        </section>
      )}

      {tab === "wiki" && ready && (
        <section className="kb-layout">
          <aside className="kb-side">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => {
                setCreating(true);
                setDraftTitle("");
                setDraftBody(`# ${teamLabel}\n\n`);
                setDraftTemplate("blank");
                setDraftSeason(String(new Date().getFullYear()));
                setDraftTags("");
                setDraftPinned(false);
              }}
            >
              New page
            </button>
            <ul className="kb-list">
              {ready.pages.length === 0 && !creating && (
                <li className="kb-list-empty">No wiki pages yet. Start from Templates or New page.</li>
              )}
              {ready.pages.map((page) => (
                <li key={page.id}>
                  <button
                    type="button"
                    className={`kb-list-item${ready.selected?.id === page.id && !creating ? " active" : ""}`}
                    onClick={() => void load({ pageId: page.id })}
                  >
                    <b>
                      {page.pinned ? "★ " : ""}
                      {page.title}
                    </b>
                    <small>
                      {TEMPLATE_KIND_LABEL[page.templateKind]}
                      {page.seasonYear != null ? ` · ${page.seasonYear}` : ""}
                      {page.linkCount ? ` · ${page.linkCount} linked` : ""}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="kb-main kb-editor">
            {(creating || ready.selected) && (
              <>
                <div className="kb-editor-head">
                  <h2>{creating ? "New page" : "Edit page"}</h2>
                  {ready.selected && !creating && (
                    <p className="kb-meta">
                      Updated {new Date(ready.selected.updatedAt).toLocaleString()}
                      {ready.selected.updatedByName ? ` · ${ready.selected.updatedByName}` : ""}
                    </p>
                  )}
                </div>
                <label className="kb-field">
                  <span>Title</span>
                  <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
                </label>
                <div className="kb-row">
                  <label className="kb-field">
                    <span>Template kind</span>
                    <select
                      value={draftTemplate}
                      onChange={(e) => setDraftTemplate(e.target.value as KnowledgeTemplateKind)}
                    >
                      {KNOWLEDGE_TEMPLATE_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {TEMPLATE_KIND_LABEL[kind]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="kb-field">
                    <span>Season</span>
                    <input value={draftSeason} onChange={(e) => setDraftSeason(e.target.value)} placeholder="optional" />
                  </label>
                  <label>
                    <input type="checkbox" checked={draftPinned} onChange={(e) => setDraftPinned(e.target.checked)} />
                    Pinned
                  </label>
                </div>
                <label className="kb-field">
                  <span>Tags</span>
                  <input value={draftTags} onChange={(e) => setDraftTags(e.target.value)} placeholder="drivetrain, cad" />
                </label>
                <label className="kb-field">
                  <span>Body</span>
                  <textarea
                    className="kb-body"
                    value={draftBody}
                    maxLength={MAX_BODY}
                    onChange={(e) => setDraftBody(e.target.value)}
                  />
                </label>
                <div className="kb-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy || !draftTitle.trim()}
                    onClick={() =>
                      void run({
                        action: "upsert_page",
                        id: creating ? null : ready.selected?.id,
                        title: draftTitle,
                        body: draftBody,
                        templateKind: draftTemplate,
                        seasonYear: draftSeason || null,
                        tags: draftTags,
                        pinned: draftPinned,
                      })
                    }
                  >
                    {busy ? "Saving…" : creating ? "Create page" : "Save page"}
                  </button>
                  {!creating && ready.selected && (
                    <button
                      type="button"
                      className="kb-link danger"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("Delete this wiki page?")) {
                          void run({ action: "delete_page", id: ready.selected!.id });
                        }
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>

                {!creating && ready.selected && (
                  <section style={{ marginTop: 8 }}>
                    <h2>Linked decisions / reviews</h2>
                    <ul className="kb-list">
                      {ready.selected.links.length === 0 && (
                        <li className="kb-list-empty">
                          Attach the ADR or design review that explains this page.
                        </li>
                      )}
                      {ready.selected.links.map((link) => (
                        <li key={link.id} className="kb-list-item" style={{ cursor: "default" }}>
                          <b>
                            {link.targetType === "decision" ? "Decision" : "Review"}:{" "}
                            {link.targetTitle ?? link.targetId}
                          </b>
                          <small>
                            {link.targetSeasonYear != null ? `${link.targetSeasonYear}` : ""}
                            {link.note ? ` · ${link.note}` : ""}
                          </small>
                          <button
                            type="button"
                            className="kb-link danger"
                            disabled={busy}
                            onClick={() => void run({ action: "unlink", linkId: link.id })}
                          >
                            Unlink
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="kb-row" style={{ marginTop: 10 }}>
                      <select
                        value={linkType}
                        onChange={(e) => {
                          setLinkType(e.target.value as LinkTargetType);
                          setLinkTargetId("");
                        }}
                      >
                        <option value="decision">Decision</option>
                        <option value="design_review">Design review</option>
                      </select>
                      <select value={linkTargetId} onChange={(e) => setLinkTargetId(e.target.value)}>
                        <option value="">Select…</option>
                        {(linkType === "decision" ? ready.decisions : ready.reviews).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.seasonYear} · {item.title}
                            {"subsystem" in item ? ` (${item.subsystem})` : ""}
                          </option>
                        ))}
                      </select>
                      <input value={linkNote} onChange={(e) => setLinkNote(e.target.value)} placeholder="Why linked?" />
                      <button
                        type="button"
                        className="button primary"
                        disabled={busy || !linkTargetId}
                        onClick={() =>
                          void run({
                            action: "link",
                            pageId: ready.selected!.id,
                            targetType: linkType,
                            targetId: linkTargetId,
                            note: linkNote || null,
                          })
                        }
                      >
                        Link
                      </button>
                    </div>
                  </section>
                )}
              </>
            )}

            {!creating && !ready.selected && (
              <div className="kb-empty">
                <h2>No page selected</h2>
                <p>Pick a page, create one, or start from a handoff template.</p>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
