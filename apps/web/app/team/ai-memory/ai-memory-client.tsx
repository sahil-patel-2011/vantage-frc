"use client";
import { Button, EmptyState, PageHeader } from "../../../components/ui";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AiHubRelated } from "../../../components/ai-hub-related";
import {
  errorStreak,
  errorStreakChecklist,
  journalEntryTitle,
  retentionNotice,
  sourceChips,
  statusLine,
  type DreamJournalEntry,
  type DreamJournalPage,
} from "../../../lib/dreaming/journal";
import {
  AI_MEMORY_RELATED_INCLUDE,
  AI_MEMORY_SCOPE_CARDS,
  aiMemoryNextActions,
  aiMemoryRelatedLinks,
  aiMemoryShellCopy,
  classifyAiMemoryShell,
  formatAiMemoryMetric,
  type AiMemoryShellKind,
} from "../../../lib/ai-memory/ai-memory-related";
import { hubHref } from "../../../lib/nav/hubs";
import "./ai-memory.css";

type TeamSettings = { enabled: boolean; tokenBudget: number; retentionDays: number };
type Counts = { active: string; expiringSoon: string; total: string };

function MemoryRelatedStrip({ orgId }: { orgId: string }) {
  const links = aiMemoryRelatedLinks(orgId, { include: [...AI_MEMORY_RELATED_INCLUDE] });
  return (
    <nav className="product-hub-related ai-memory-related" aria-label="Related AI tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActions({
  orgId,
  shell,
  enabled,
  activeCount,
}: {
  orgId: string;
  shell: AiMemoryShellKind;
  enabled: boolean;
  activeCount: number;
}) {
  const actions = aiMemoryNextActions({ orgId, shell, enabled, activeCount });
  if (!actions.length) return null;
  return (
    <section className="ai-memory-next-actions app-card soft-panel edc-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ShellPrimary({
  orgId,
  shell,
  enabled,
  activeCount,
  onRetry,
}: {
  orgId: string;
  shell: AiMemoryShellKind;
  enabled: boolean;
  activeCount: number;
  onRetry?: () => void;
}) {
  if (shell === "error" && onRetry) {
    return (
      <Button variant="primary" type="button" onClick={onRetry}>
        Retry
      </Button>
    );
  }
  const primary = aiMemoryNextActions({ orgId, shell, enabled, activeCount }).find(
    (action) => action.primary,
  );
  if (!primary) return null;
  return (
    <Button as="a" variant="primary" href={primary.href}>
      {primary.label}
    </Button>
  );
}

function JournalEntryCard({ entry }: { entry: DreamJournalEntry }) {
  const chips = sourceChips(entry.sourceCounts);
  const status = statusLine(entry);
  const badge =
    entry.status === "error"
      ? { className: "app-badge setup", text: "Run failed" }
      : entry.status === "no_activity"
        ? { className: "app-badge", text: "Quiet day" }
        : entry.status === "no_ai_fallback"
          ? { className: "app-badge setup", text: "No AI summary" }
          : entry.kind === "weekly"
            ? { className: "app-badge good", text: "Week roll-up" }
            : null;

  return (
    <article className={`dream-entry${entry.kind === "weekly" ? " weekly" : ""}`}>
      <header>
        <h3>{journalEntryTitle(entry)}</h3>
        {badge ? <span className={badge.className}>{badge.text}</span> : null}
      </header>
      {chips.length ? (
        <ul className="dream-chips" aria-label="What fed this entry">
          {chips.map((chip) => (
            <li key={chip.id}>{chip.label}</li>
          ))}
        </ul>
      ) : null}
      {status ? <p className="dream-status app-muted">{status}</p> : null}
      {entry.content ? (
        <p className="dream-body">{entry.content}</p>
      ) : entry.status === "ok" || entry.status === "no_ai_fallback" ? (
        <p className="dream-status app-muted">
          This entry has expired under your retention window and is no longer used in Chat.
        </p>
      ) : null}
    </article>
  );
}

function ErrorStreakBanner({ entries }: { entries: DreamJournalEntry[] }) {
  const streak = useMemo(() => errorStreak(entries), [entries]);
  if (!streak) return null;
  const checks = errorStreakChecklist(streak.errorClass);
  return (
    <section className="dream-error-streak app-card soft-panel" role="alert">
      <span className="app-badge setup">Dreaming is failing</span>
      <h3>
        {streak.count} nights in a row failed ({streak.since} → {streak.latest})
      </h3>
      <p className="app-muted">
        {streak.errorClass
          ? `Last recorded error class: ${streak.errorClass}. No memory was written on those nights.`
          : "No error class was recorded. No memory was written on those nights."}
      </p>
      <ul>
        {checks.map((check) => (
          <li key={check}>{check}</li>
        ))}
      </ul>
    </section>
  );
}

export default function AiMemoryClient({ orgId }: { orgId: string }) {
  const [settings, setSettings] = useState<TeamSettings>({
    enabled: false,
    tokenBudget: 1600,
    retentionDays: 365,
  });
  const [counts, setCounts] = useState<Counts>({ active: "0", expiringSoon: "0", total: "0" });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    const response = await fetch(`/api/agent/team-memory?orgId=${encodeURIComponent(orgId)}`);
    const data = (await response.json()) as {
      error?: string;
      team?: TeamSettings;
      counts?: Counts;
    };
    setHttpStatus(response.status);
    if (!response.ok) {
      setLoadError(data.error ?? "Unable to load team memory settings");
      setMessage("");
    } else {
      setLoadError(null);
      setMessage("");
      if (data.team) setSettings(data.team);
      if (data.counts) setCounts(data.counts);
    }
    setLoading(false);
  }

  const [journal, setJournal] = useState<DreamJournalEntry[]>([]);
  const [journalMeta, setJournalMeta] = useState<Omit<DreamJournalPage, "entries"> | null>(null);
  const [journalLoading, setJournalLoading] = useState(true);
  const [journalMore, setJournalMore] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState("");

  const loadJournal = useCallback(
    async (cursor?: string | null) => {
      if (cursor) setJournalMore(true);
      else setJournalLoading(true);
      setJournalError(null);
      try {
        const query = new URLSearchParams({ orgId });
        if (cursor) query.set("before", cursor);
        const response = await fetch(`/api/dreams?${query.toString()}`);
        const data = (await response.json()) as Partial<DreamJournalPage> & { error?: string };
        if (!response.ok) {
          setJournalError(data.error ?? "Unable to load the team journal");
        } else {
          const page = data as DreamJournalPage;
          const entries = page.entries ?? [];
          setJournal((prior) => (cursor ? [...prior, ...entries] : entries));
          setJournalMeta({
            nextCursor: page.nextCursor ?? null,
            retentionDays: page.retentionDays,
            memoryEnabled: page.memoryEnabled,
            canRunNow: page.canRunNow,
            lastRunAt: page.lastRunAt ?? null,
          });
        }
      } catch {
        setJournalError("Unable to load the team journal");
      } finally {
        setJournalLoading(false);
        setJournalMore(false);
      }
    },
    [orgId],
  );

  useEffect(() => {
    void load();
  }, [orgId]);

  useEffect(() => {
    void loadJournal();
  }, [loadJournal]);

  async function runDreamNow() {
    setRunning(true);
    setRunMessage("");
    try {
      const response = await fetch("/api/dreams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const data = (await response.json()) as {
        error?: string;
        summary?: { ok: number; noActivity: number; fallback: number; errors: number };
      };
      if (!response.ok) {
        setRunMessage(data.error ?? "The dream run failed.");
      } else if (data.summary?.errors) {
        setRunMessage("The run finished with an error — see the newest journal entry.");
      } else if (data.summary?.noActivity) {
        setRunMessage("No activity recorded so far today, so nothing was written.");
      } else if (data.summary?.fallback) {
        setRunMessage("Written without AI — the recorded facts are listed exactly as logged.");
      } else if (data.summary?.ok) {
        setRunMessage("Today's entry is written.");
      } else {
        setRunMessage("Nothing to run — team memory may be off for this team.");
      }
      await loadJournal();
    } catch {
      setRunMessage("The dream run failed.");
    } finally {
      setRunning(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch("/api/agent/team-memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, ...settings }),
    });
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Team memory policy saved." : (data.error ?? "Save failed"));
    setSaving(false);
    if (response.ok) await load();
  }

  const activeCount = Number(counts.active ?? 0);
  const shell = classifyAiMemoryShell({
    loading,
    status: httpStatus,
    error: loadError,
    enabled: settings.enabled,
    activeCount: Number.isFinite(activeCount) ? activeCount : 0,
  });
  const shellCopy = aiMemoryShellCopy(shell);
  const blocked = shell === "forbidden" || shell === "auth_required" || shell === "error";
  const showEmptyBanner = shell === "empty" || shell === "setup";

  const chatHref = hubHref("/ai", "chat", orgId);
  const budgetsHref = hubHref("/ai", "budgets", orgId);

  return (
    <main className="intel-app ai-memory-page">
      <PageHeader
        breadcrumbs="Ask AI / Memory"
        title="What the assistant remembers"
        description="Private memories stay yours in Chat. Team-shared memory is admin opt-in only and uses real promoted messages — if nothing has been saved, Chat has nothing extra."
      />

      <AiHubRelated orgId={orgId} active="memory" />
      <MemoryRelatedStrip orgId={orgId} />

      {message ? (
        <p role="status" className="telemetry-status">
          {message}
        </p>
      ) : null}

      {loading ? (
        <section className="app-card soft-panel product-hub-setup" aria-busy>
          <h2>{shellCopy.title}</h2>
          <p className="app-muted">{shellCopy.description}</p>
        </section>
      ) : null}

      {blocked ? (
        <EmptyState
          soft
          badge={shellCopy.badge}
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <ShellPrimary
            orgId={orgId}
            shell={shell}
            enabled={settings.enabled}
            activeCount={Number.isFinite(activeCount) ? activeCount : 0}
            onRetry={() => void load()}
          />
        </EmptyState>
      ) : null}

      {!loading && !blocked ? (
        <>
          <section className="ai-memory-scope" aria-label="Private versus team-shared memory">
            {AI_MEMORY_SCOPE_CARDS.map((card) => (
              <article key={card.id} className="app-card soft-panel ai-memory-scope-card">
                <span className="eyebrow">{card.id === "private" ? "PRIVATE" : "TEAM-SHARED"}</span>
                <h2>{card.title}</h2>
                <p className="app-muted">{card.body}</p>
                {card.id === "private" ? (
                  <Button as="a" variant="secondary" href={chatHref}>
                    Open Chat context
                  </Button>
                ) : (
                  <Button as="a" variant="secondary" href="#team-memory-policy">
                    Admin policy
                  </Button>
                )}
              </article>
            ))}
          </section>

          <section className="metric-grid" aria-label="Team memory counts">
            <article>
              <span>Team memory</span>
              <strong>{settings.enabled ? "On" : "Off"}</strong>
            </article>
            <article>
              <span>Active memories</span>
              <strong>{formatAiMemoryMetric(counts.active, true)}</strong>
            </article>
            <article>
              <span>Expiring ≤ 7d</span>
              <strong>{formatAiMemoryMetric(counts.expiringSoon, true)}</strong>
            </article>
            <article>
              <span>Total stored</span>
              <strong>{formatAiMemoryMetric(counts.total, true)}</strong>
            </article>
          </section>

          {showEmptyBanner ? (
            <EmptyState
              soft
              badge={shellCopy.badge}
              badgeTone="setup"
              title={shellCopy.title}
              description={shellCopy.description}
            >
              <ShellPrimary
                orgId={orgId}
                shell={shell}
                enabled={settings.enabled}
                activeCount={Number.isFinite(activeCount) ? activeCount : 0}
              />
            </EmptyState>
          ) : (
            <NextActions
              orgId={orgId}
              shell={shell}
              enabled={settings.enabled}
              activeCount={Number.isFinite(activeCount) ? activeCount : 0}
            />
          )}

          <section className="app-card soft-panel dream-journal" aria-label="Team journal">
            <header className="dream-journal-header">
              <div>
                <span className="eyebrow">TEAM JOURNAL</span>
                <h2>What last night&apos;s dream wrote</h2>
                <p className="app-muted">
                  Each night Vantage folds that day&apos;s real activity into one team memory. Quiet days write
                  nothing at all — this list only ever shows runs that actually happened.
                </p>
              </div>
              {journalMeta?.canRunNow ? (
                <Button variant="secondary" type="button" className="dream-run-now" onClick={() => void runDreamNow()} disabled={running}>
                  {running ? "Running…" : "Run now for today"}
                </Button>
              ) : null}
            </header>

            {runMessage ? (
              <p role="status" className="telemetry-status">
                {runMessage}
              </p>
            ) : null}

            <p className="app-muted dream-retention">
              {retentionNotice(journalMeta?.retentionDays ?? settings.retentionDays)}
            </p>

            {journalMeta?.memoryEnabled && !journalLoading && !journalMeta.lastRunAt ? (
              <p className="app-muted dream-status">
                No nightly run has reached this team yet. Ask a mentor if that is unexpected.
              </p>
            ) : null}

            {journalMeta && !journalMeta.memoryEnabled ? (
              <p className="app-muted dream-status">
                Team memory is off, so nightly dreaming is skipped for this team. Turn it on below to start a
                journal.
              </p>
            ) : null}

            <ErrorStreakBanner entries={journal} />

            {journalLoading ? (
              <p className="app-muted" aria-busy>
                Loading the journal…
              </p>
            ) : journalError ? (
              <div className="dream-journal-error" role="status">
                <p className="app-muted">{journalError}</p>
                <Button variant="secondary" type="button" onClick={() => void loadJournal()}>
                  Retry
                </Button>
              </div>
            ) : journal.length === 0 ? (
              <p className="app-muted dream-status">
                No dream has run for this team yet. The first entry appears after the next nightly run
                {journalMeta?.canRunNow ? ", or run one now with the button above." : "."}
              </p>
            ) : (
              <>
                <div className="dream-entries">
                  {journal.map((entry) => (
                    <JournalEntryCard key={`${entry.day}-${entry.kind}`} entry={entry} />
                  ))}
                </div>
                {journalMeta?.nextCursor ? (
                  <Button variant="secondary" type="button" className="dream-more" disabled={journalMore} onClick={() => void loadJournal(journalMeta.nextCursor)}>
                    {journalMore ? "Loading…" : "Load earlier entries"}
                  </Button>
                ) : null}
              </>
            )}
          </section>

          <form
            id="team-memory-policy"
            className="intel-panel auth-policy-form ai-memory-policy"
            onSubmit={save}
          >
            <span className="eyebrow">ADMIN · TEAM MEMORY POLICY</span>
            <p className="app-muted ai-memory-policy-lead">
              Controls for shared team memory. Private Chat memories stay yours when this is off.
            </p>
            <label className="state-control">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              />
              <span>
                <strong>Use team memory in Chat answers</strong>
                <small>
                  When off, Chat does not use shared team notes. Empty lists stay empty.
                </small>
              </span>
            </label>
            <label>
              Retention window (days)
              <input
                type="number"
                min={1}
                max={3650}
                value={settings.retentionDays}
                onChange={(e) => setSettings({ ...settings, retentionDays: Number(e.target.value) })}
              />
              <small>Promoted team memories are ignored once older than this. 1–3650 days.</small>
            </label>
            <label>
              How much team memory each answer can use
              <input
                type="number"
                min={0}
                max={10000}
                value={settings.tokenBudget}
                onChange={(e) => setSettings({ ...settings, tokenBudget: Number(e.target.value) })}
              />
              <small>
                Maximum amount of team memory Chat may add to any single answer. Separate from Chat limits.
                0–10000.
              </small>
            </label>
            <div className="ai-memory-policy-actions">
              <Button variant="primary" disabled={saving} type="submit">
                {saving ? "Saving…" : "Save team memory policy"}
              </Button>
              <Button as="a" variant="secondary" href={chatHref}>
                Open Chat
              </Button>
              <Button as="a" variant="secondary" href={budgetsHref}>
                Open Chat limits
              </Button>
            </div>
          </form>
        </>
      ) : null}
    </main>
  );
}
