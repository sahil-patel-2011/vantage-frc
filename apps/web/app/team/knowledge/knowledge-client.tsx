"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KNOWLEDGE_TEMPLATES,
  KNOWLEDGE_TEMPLATE_KINDS,
  MAX_BODY,
  TEMPLATE_KIND_LABEL,
  type KnowledgePageSummary,
  type KnowledgeTemplateKind,
  type KnowledgeWikiView,
} from "../../../lib/knowledge";
import { EmptyState } from "../../../components/ui";
import { ActionMenu, type ActionSpec } from "../../../components/ui/action-menu";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import "./knowledge.css";

type Tab = "wiki" | "search" | "templates" | "ai";
type LinkTargetType = "decision" | "design_review";

function fmtUpdated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function filterPages(pages: KnowledgePageSummary[], q: string): KnowledgePageSummary[] {
  const needle = q.trim().toLowerCase();
  return pages.filter((page) => {
    if (!needle) return true;
    const hay = [page.title, page.slug, TEMPLATE_KIND_LABEL[page.templateKind], ...page.tags]
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  });
}

export default function KnowledgeClient({ embedded = false }: { embedded?: boolean } = {}) {
  const [view, setView] = useState<KnowledgeWikiView | null>(null);
  const [error, setError] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("wiki");
  const [searchDraft, setSearchDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [listQuery, setListQuery] = useState("");

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
  const teamLabel = ready?.teamNumber ? `Team ${ready.teamNumber}` : "Team";

  const dirty = useMemo(() => {
    if (!ready) return false;
    if (creating) {
      return Boolean(draftTitle.trim() || draftBody.trim() || draftTags.trim() || draftPinned);
    }
    const selected = ready.selected;
    if (!selected) return false;
    const season = selected.seasonYear != null ? String(selected.seasonYear) : "";
    return (
      draftTitle !== selected.title ||
      draftBody !== selected.body ||
      draftTemplate !== selected.templateKind ||
      draftSeason !== season ||
      draftTags !== selected.tags.join(", ") ||
      draftPinned !== selected.pinned
    );
  }, [creating, draftBody, draftPinned, draftSeason, draftTags, draftTemplate, draftTitle, ready]);

  const filteredPages = useMemo(
    () => (ready ? filterPages(ready.pages, listQuery) : []),
    [listQuery, ready],
  );

  const hydrateFromSelected = useCallback((data: Extract<KnowledgeWikiView, { status: "ready" }>) => {
    if (!data.selected) return;
    setDraftTitle(data.selected.title);
    setDraftBody(data.selected.body);
    setDraftTemplate(data.selected.templateKind);
    setDraftSeason(data.selected.seasonYear != null ? String(data.selected.seasonYear) : "");
    setDraftTags(data.selected.tags.join(", "));
    setDraftPinned(data.selected.pinned);
    setCreating(false);
  }, []);

  const load = useCallback(
    async (opts?: { pageId?: string; page?: string; q?: string }) => {
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
          setErrorStatus(response.status);
          return;
        }
        setError("");
        setErrorStatus(null);
        setView(data);
        if (data.status === "ready" && data.selected && !opts?.q) {
          hydrateFromSelected(data);
        }
      } catch {
        setError("Network error loading knowledge base.");
        setErrorStatus(null);
      }
    },
    [hydrateFromSelected],
  );

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
        hydrateFromSelected(data);
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

  function beginCreate() {
    setCreating(true);
    setDraftTitle("");
    setDraftBody(`# ${teamLabel}\n\n`);
    setDraftTemplate("blank");
    setDraftSeason(String(new Date().getFullYear()));
    setDraftTags("");
    setDraftPinned(false);
    setStatus("");
  }

  function startSeasonPlaybook() {
    void run({
      action: "upsert_page",
      fromTemplate: "season_playbook",
      templateKind: "season_playbook",
      seasonYear: new Date().getFullYear(),
    });
  }

  function selectPage(pageId: string) {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    void load({ pageId });
  }

  function cancelCreate() {
    if (dirty && !window.confirm("Discard this draft?")) return;
    setCreating(false);
    if (ready?.selected) hydrateFromSelected(ready);
    else {
      setDraftTitle("");
      setDraftBody("");
      setDraftTemplate("blank");
      setDraftSeason("");
      setDraftTags("");
      setDraftPinned(false);
    }
  }

  function insertMarkdown(snippet: string) {
    setDraftBody((prev) => (prev ? `${prev.trimEnd()}\n\n${snippet}` : snippet));
  }

  const bodyRemaining = MAX_BODY - draftBody.length;

  if (!view && !error) {
    return (
      <main className="module-page kb-page">
        <EmptyState soft title="Loading…" aria-busy />
      </main>
    );
  }

  // Nothing loaded at all — say why, and offer the action that actually fixes it.
  if (!view && error) {
    const copy = loadFailureCopy(
      classifyLoadFailure({
        status: errorStatus,
        message: error,
        online: typeof navigator === "undefined" ? true : navigator.onLine,
      }),
      {
        nextPath:
          typeof window === "undefined"
            ? null
            : `${window.location.pathname}${window.location.search}`,
        message: error,
      },
    );
    return (
      <main className={`module-page kb-page${embedded ? " is-embedded" : ""}`}>
        {!embedded ? (
          <header className="kb-hero">
            <div>
              <h1>Playbook</h1>
            </div>
          </header>
        ) : null}
        <EmptyState soft title={copy.title} description={copy.description}>
          {copy.primary ? (
            <a className="app-button" href={copy.primary.href}>
              {copy.primary.label}
            </a>
          ) : null}
          {copy.showRetry ? (
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (view?.status === "setup_required") {
    return (
      <main className="module-page kb-page">
        {!embedded ? (
          <header className="kb-hero">
            <div>
              <h1>Playbook</h1>
            </div>
          </header>
        ) : null}
        <EmptyState soft badge="Setup" badgeTone="setup" title="Choose a team" description={view.message}>
          <a className="button primary" href="/workspace">
            Choose team
          </a>
        </EmptyState>
      </main>
    );
  }

  return (
    <main className={`module-page kb-page${embedded ? " is-embedded" : ""}`}>
      {!embedded ? (
        <header className="kb-hero">
          <div>
            <h1>Playbook</h1>
          </div>
        </header>
      ) : null}

      {tab !== "wiki" ? (
        <button type="button" className="kb-back" onClick={() => setTab("wiki")}>
          ← Pages
        </button>
      ) : null}

      {error ? (
        <p className="kb-alert" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="kb-status" role="status">
          {status}
        </p>
      ) : null}

      {tab === "search" && ready ? (
        <section className="kb-main">
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
              placeholder="Search pages…"
              aria-label="Search wiki"
            />
            <button type="submit" className="button primary" disabled={busy}>
              Search
            </button>
          </form>
          {ready.searchQuery && ready.searchHits.length === 0 ? (
            <EmptyState soft title="No matches" description={`Nothing matched “${ready.searchQuery}”.`} />
          ) : null}
          <ul className="kb-list" style={{ marginTop: 12 }}>
            {ready.searchHits.map((hit) => (
              <li key={`${hit.source}:${hit.id}`}>
                <a className="kb-list-item" href={hit.href}>
                  <b>{hit.title}</b>
                  <small>
                    {hit.source.replace("_", " ")}
                    {hit.seasonYear != null ? ` · ${hit.seasonYear}` : ""}
                  </small>
                  {hit.snippet ? <small>{hit.snippet}</small> : null}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "templates" && ready ? (
        <section className="kb-main kb-templates">
          <div className="kb-template-grid">
            {KNOWLEDGE_TEMPLATES.map((tpl) => (
              <button
                key={tpl.kind}
                type="button"
                className="kb-template"
                disabled={busy}
                onClick={() => {
                  setTab("wiki");
                  void run({
                    action: "upsert_page",
                    fromTemplate: tpl.kind,
                    templateKind: tpl.kind,
                    seasonYear: new Date().getFullYear(),
                  });
                }}
              >
                <span className="kb-badge handoff">{tpl.kind.replace("_", " ")}</span>
                <strong>{tpl.title}</strong>
                <span>{tpl.blurb}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "ai" && ready ? (
        <section className="kb-main kb-ai">
          <p className="kb-ai-hint">
            Facts the assistant should always know.
            {aiUpdatedAt ? ` Updated ${new Date(aiUpdatedAt).toLocaleString()}.` : ""}
          </p>
          <textarea
            className="kb-body"
            value={aiContent}
            readOnly={!canEditAi}
            maxLength={20000}
            onChange={(e) => setAiContent(e.target.value)}
          />
          {canEditAi ? (
            <>
              <label className="kb-row">
                <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
                Include in assistant prompts
              </label>
              <div className="kb-actions">
                <ActionMenu
                  label="Assistant summary"
                  maxSecondary={0}
                  actions={[
                    {
                      id: "save-ai",
                      label: "Save assistant summary",
                      intent: "primary",
                      disabled: busy,
                      onClick: () => void saveAi(),
                    },
                    {
                      id: "history",
                      label: "Change history",
                      hint: "Who edited the team wiki, and when",
                      href: `/team/knowledge/history?orgId=${orgId}`,
                    },
                  ]}
                />
              </div>
            </>
          ) : null}
          {canEditAi ? null : (
            <div className="kb-ai-links">
              <a href={`/team/knowledge/history?orgId=${orgId}`}>History</a>
            </div>
          )}
        </section>
      ) : null}

      {tab === "wiki" && ready ? (
        <section className="kb-layout">
          <aside className="kb-side">
            <div className="kb-side-head">
              {ready.pages.length === 0 ? (
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={startSeasonPlaybook}
                >
                  Start season playbook
                </button>
              ) : (
                <button type="button" className="button primary" disabled={busy} onClick={beginCreate}>
                  New page
                </button>
              )}
              <p className="kb-meta">
                {ready.pages.length} page{ready.pages.length === 1 ? "" : "s"}
                {filteredPages.length !== ready.pages.length ? ` · ${filteredPages.length} shown` : ""}
              </p>
            </div>

            {ready.pages.length > 0 ? (
              <label className="kb-field">
                <input
                  value={listQuery}
                  onChange={(e) => setListQuery(e.target.value)}
                  placeholder="Filter pages"
                  aria-label="Filter wiki pages"
                />
              </label>
            ) : null}

            <ul className="kb-list">
              {ready.pages.length > 0 && filteredPages.length === 0 ? (
                <li className="kb-list-empty">No pages match this filter.</li>
              ) : null}
              {filteredPages.map((page) => (
                <li key={page.id}>
                  <button
                    type="button"
                    className={`kb-list-item${ready.selected?.id === page.id && !creating ? " active" : ""}`}
                    onClick={() => selectPage(page.id)}
                  >
                    <b>
                      {page.pinned ? "★ " : ""}
                      {page.title}
                    </b>
                    <small>
                      {TEMPLATE_KIND_LABEL[page.templateKind]}
                      {page.seasonYear != null ? ` · ${page.seasonYear}` : ""}
                      {page.linkCount ? ` · ${page.linkCount} linked` : ""}
                      {` · ${fmtUpdated(page.updatedAt)}`}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
            <div className="kb-side-links">
              <button type="button" className="kb-link" onClick={() => setTab("templates")}>
                Templates
              </button>
              {ready.pages.length > 0 ? (
                <button type="button" className="kb-link" onClick={() => setTab("search")}>
                  Search
                </button>
              ) : null}
              <button type="button" className="kb-link" onClick={() => setTab("ai")}>
                Assistant
              </button>
            </div>
          </aside>

          <div className="kb-main kb-editor">
            {creating || ready.selected ? (
              <>
                <div className="kb-editor-head">
                  <div>
                    <h2>{creating ? "New page" : "Edit page"}</h2>
                    {ready.selected && !creating ? (
                      <p className="kb-meta">
                        Updated {fmtUpdated(ready.selected.updatedAt)}
                        {ready.selected.updatedByName ? ` · ${ready.selected.updatedByName}` : ""}
                        {ready.selected.slug ? ` · /${ready.selected.slug}` : ""}
                      </p>
                    ) : (
                      <p className="kb-meta">Markdown.</p>
                    )}
                  </div>
                  {dirty ? (
                    <span className="kb-dirty" role="status">
                      Unsaved
                    </span>
                  ) : null}
                </div>

                <div className="kb-editor-toolbar" role="toolbar" aria-label="Editor shortcuts">
                  {/* Five equally-loud markdown chips became three controls: the two students
                      reach for, plus the rest one keystroke away. Every insert still works. */}
                  <ActionMenu
                    tone="row"
                    label="Markdown insert"
                    overflowLabel="More formats"
                    maxSecondary={1}
                    actions={[
                      { id: "heading", label: "Heading", intent: "primary", disabled: busy, onClick: () => insertMarkdown("## Heading\n") },
                      { id: "bullet", label: "Bullet", disabled: busy, onClick: () => insertMarkdown("- \n") },
                      { id: "bold", label: "Bold", disabled: busy, hint: "Wraps text in **", onClick: () => insertMarkdown("**bold** ") },
                      { id: "numbered", label: "Numbered", disabled: busy, hint: "Starts an ordered list", onClick: () => insertMarkdown("1. \n") },
                      { id: "code", label: "Code", disabled: busy, hint: "Inline `code` span", onClick: () => insertMarkdown("`code` ") },
                    ]}
                  />
                  <span className="kb-charcount" aria-live="polite">
                    {draftBody.length.toLocaleString()} / {MAX_BODY.toLocaleString()}
                    {bodyRemaining < 2000 ? ` · ${bodyRemaining.toLocaleString()} left` : ""}
                  </span>
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
                    <input
                      value={draftSeason}
                      onChange={(e) => setDraftSeason(e.target.value)}
                      placeholder="optional"
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={draftPinned}
                      onChange={(e) => setDraftPinned(e.target.checked)}
                    />
                    Pinned
                  </label>
                </div>
                <label className="kb-field">
                  <span>Tags</span>
                  <input
                    value={draftTags}
                    onChange={(e) => setDraftTags(e.target.value)}
                    placeholder="drivetrain, cad"
                  />
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
                  {/* Save is the one loud control. Cancel sits beside it while drafting;
                      Delete is always behind the overflow with a confirm step (no window.confirm). */}
                  <ActionMenu
                    label="Page"
                    maxSecondary={1}
                    actions={[
                      {
                        id: "save",
                        label: busy ? "Saving…" : creating ? "Create page" : "Save page",
                        intent: "primary",
                        disabled: busy || !draftTitle.trim() || (!creating && !dirty),
                        onClick: () =>
                          void run({
                            action: "upsert_page",
                            id: creating ? null : ready.selected?.id,
                            title: draftTitle,
                            body: draftBody,
                            templateKind: draftTemplate,
                            seasonYear: draftSeason || null,
                            tags: draftTags,
                            pinned: draftPinned,
                          }),
                      },
                      ...(creating
                        ? [{ id: "cancel", label: "Cancel", disabled: busy, onClick: cancelCreate } satisfies ActionSpec]
                        : []),
                      ...(!creating && ready.selected
                        ? [
                            {
                              id: "delete",
                              label: "Delete page",
                              intent: "destructive",
                              disabled: busy,
                              hint: "Removes the page and its links for the whole team",
                              onClick: () => void run({ action: "delete_page", id: ready.selected!.id }),
                            } satisfies ActionSpec,
                          ]
                        : []),
                    ]}
                  />
                </div>

                {!creating && ready.selected ? (
                  <section className="kb-links-panel">
                    <h2>Linked decisions / reviews</h2>
                    <ul className="kb-list">
                      {ready.selected.links.length === 0 ? (
                        <li className="kb-list-empty">
                          Attach the ADR or design review that explains this page — same org only.
                        </li>
                      ) : null}
                      {ready.selected.links.map((link) => (
                        <li key={link.id} className="kb-list-item kb-list-item--static">
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
                    <div className="kb-row kb-link-form">
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
                      <input
                        value={linkNote}
                        onChange={(e) => setLinkNote(e.target.value)}
                        placeholder="Why linked?"
                      />
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
                ) : null}
              </>
            ) : null}

            {!creating && !ready.selected ? (
              ready.pages.length === 0 ? (
                <EmptyState soft title="No pages yet">
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy}
                    onClick={startSeasonPlaybook}
                  >
                    Start season playbook
                  </button>
                </EmptyState>
              ) : (
                <EmptyState soft title="Select a page" />
              )
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
