"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { Button, EmptyState, PageHeader, Panel } from "../../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";

type Prompt = {
  id: string;
  title: string;
  category: string;
  body: string;
  createdBy: string;
  updatedAt: string;
};

type View = {
  prompts: Prompt[];
  viewerId: string | null;
};

const CATEGORIES = ["general", "strategy", "scouting", "build", "outreach", "business", "cad"] as const;

function categoryLabel(category: string): string {
  switch (category) {
    case "general":
      return "General";
    case "strategy":
      return "Strategy";
    case "scouting":
      return "Scouting";
    case "build":
      return "Build";
    case "outreach":
      return "Outreach";
    case "business":
      return "Business";
    case "cad":
      return "CAD";
    default: {
      const _exhaustive: string = category;
      return _exhaustive;
    }
  }
}

const STARTERS: Array<{ title: string; category: string; body: string }> = [
  {
    title: "Match strategy draft",
    category: "strategy",
    body: "Context: we're playing {opponent alliance} at {event}. Using our team knowledge, draft a match strategy. Tell me: our role, auto plan, teleop priorities, and endgame — as a short bulleted list.",
  },
  {
    title: "What to scout",
    category: "scouting",
    body: "Context: qualification matches at {event}. What are the 5 most decision-relevant things we should scout about our upcoming opponents? Give me a checklist we can hand to scouts.",
  },
  {
    title: "Sponsor thank-you email",
    category: "outreach",
    body: "Context: {sponsor} gave us {amount/donation}. Write a warm, specific thank-you email from our team. Result: 120 words, friendly, mentions how the support helps students.",
  },
];

function isPromptsView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const row = value as { prompts?: unknown };
  return Array.isArray(row.prompts);
}

async function persistPromptsSnapshot(orgId: string, data: View): Promise<void> {
  if (!orgId.trim()) return;
  try {
    await putFeatureSnapshot("prompts", orgId, data);
  } catch {
    // Live prompt library already painted; IndexedDB is best-effort.
  }
}

export default function PromptsClient({ orgId }: { orgId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState({ title: "", category: "general", body: "" });
  const [message, setMessage] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("prompts", orgId);
      if (!viewRef.current && cached?.data && isPromptsView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFailureStatus(null);
    try {
      const response = await fetch(`/api/team/prompts?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFailureStatus(response.status);
        setMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load prompts.",
        );
        return;
      }
      const prompts =
        data && typeof data === "object" && "prompts" in data && Array.isArray(data.prompts)
          ? (data.prompts as Prompt[])
          : [];
      const viewerId =
        data && typeof data === "object" && "viewerId" in data && typeof data.viewerId === "string"
          ? data.viewerId
          : null;
      if (!response.ok) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Prompts. Showing the last copy on this device.");
          return;
        }
        setFailureStatus(response.status);
        setMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load prompts.",
        );
        return;
      }
      const next: View = { prompts, viewerId };
      setView(next);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistPromptsSnapshot(orgId, next);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Prompts. Showing the last copy on this device.");
        return;
      }
      setMessage("Could not reach the server.");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/team/prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, ...form }),
    });
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Prompt saved to the library." : (data.error ?? "Could not save prompt."));
    if (response.ok) {
      setForm({ title: "", category: form.category, body: "" });
      await load();
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this prompt?")) return;
    const response = await fetch(
      `/api/team/prompts?orgId=${encodeURIComponent(orgId)}&id=${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Deleted." : (data.error ?? "Could not delete."));
    if (response.ok) await load();
  }

  async function copy(prompt: Prompt) {
    try {
      await navigator.clipboard.writeText(prompt.body);
      setCopiedId(prompt.id);
      setTimeout(() => setCopiedId((current) => (current === prompt.id ? null : current)), 1500);
    } catch {
      setMessage("Copy failed — select the text yourself.");
    }
  }

  if (message && !view) {
    const failure = loadFailureCopy(
      classifyLoadFailure({
        status: failureStatus,
        message,
        online: typeof navigator === "undefined" ? true : navigator.onLine,
      }),
      {
        nextPath:
          typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
        message,
      },
    );
    return (
      <main className="module-page">
        <PageHeader breadcrumbs="Team / Prompts" title="Prompts" />
        <OfflineBanner feature="Prompts" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          badge={failure.kind === "auth" ? "Signed out" : failure.kind === "forbidden" ? "No access" : "Unavailable"}
          badgeTone="setup"
          title={failure.title}
          description={failure.description}
        >
          {failure.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page">
        <PageHeader breadcrumbs="Team / Prompts" title="Prompts" />
        <OfflineBanner feature="Prompts" fromCache={fromCache} cachedAt={cachedAt} />
        <Panel>
          <p className="app-muted">Loading prompts…</p>
        </Panel>
      </main>
    );
  }

  const byCategory = view.prompts.reduce<Record<string, Prompt[]>>((acc, prompt) => {
    (acc[prompt.category] ??= []).push(prompt);
    return acc;
  }, {});

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs="Team / Prompts"
        title="Prompts"
        description="Save the ways of asking that work, then copy one into Ask AI. A good prompt gives context, says what you want, and describes the result you expect."
      >
        <Button as="a" variant="secondary" href={withOrgHref("/ai?tab=chat", orgId)}>
          Ask AI
        </Button>
        <Button as="a" variant="secondary" href={withOrgHref("/team/knowledge", orgId)}>
          Playbook
        </Button>
      </PageHeader>
      <OfflineBanner feature="Prompts" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? (
        <p role="status" className="app-muted">
          {message}
        </p>
      ) : null}

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={add}>
          <span className="eyebrow">Add a prompt</span>
          <label>
            Title
            <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label>
            Category
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {categoryLabel(category)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Prompt
            <textarea
              required
              rows={6}
              value={form.body}
              onChange={(event) => setForm({ ...form, body: event.target.value })}
              placeholder="Context: … · Do: … · Result: …"
            />
          </label>
          <Button variant="primary" type="submit">
            Save prompt
          </Button>
          {!view.prompts.length ? (
            <div style={{ marginTop: "0.75rem" }}>
              <small className="app-muted">Or start from an example:</small>
              <div className="intel-actions" style={{ marginTop: "6px" }}>
                {STARTERS.map((starter) => (
                  <Button
                    variant="secondary"
                    type="button"
                    key={starter.title}
                    onClick={() => setForm({ title: starter.title, category: starter.category, body: starter.body })}
                  >
                    {starter.title}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </form>

        <section className="intel-panel">
          <span className="eyebrow">Library · {view.prompts.length}</span>
          {!view.prompts.length ? (
            <p className="app-muted">No saved prompts yet. Add your first from the form.</p>
          ) : null}
          {Object.entries(byCategory).map(([category, list]) => (
            <div key={category}>
              <p className="eyebrow" style={{ marginTop: "1rem" }}>
                {categoryLabel(category)}
              </p>
              {list.map((prompt) => (
                <article className="admin-org" style={{ display: "block", padding: "12px 0" }} key={prompt.id}>
                  <strong>{prompt.title}</strong>
                  <small style={{ whiteSpace: "pre-wrap", display: "block", margin: "4px 0 8px" }}>
                    {prompt.body}
                  </small>
                  <div className="intel-actions">
                    <Button variant="secondary" type="button" onClick={() => void copy(prompt)}>
                      {copiedId === prompt.id ? "Copied" : "Copy"}
                    </Button>
                    {prompt.createdBy === view.viewerId ? (
                      <Button variant="secondary" type="button" onClick={() => void remove(prompt.id)}>
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ))}
        </section>
      </section>
    </main>
  );
}
