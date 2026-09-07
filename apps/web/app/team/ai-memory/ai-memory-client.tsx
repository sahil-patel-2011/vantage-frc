"use client";

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
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
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
        <p>From real team memory policy and Neon counts only — never DEMO memories.</p>
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
          This entry has expired under your retention window and is no longer injected into prompts.
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
  const governanceLinks = aiMemoryRelatedLinks(orgId);

  return (
    <main className="intel-app ai-memory-page">
      <header className="intel-header">
        <div>
          <span className="eyebrow">AI / MEMORY</span>
          <h1>What the assistant remembers</h1>
          <p className="app-muted">
            Private memories stay yours in Chat. Team-shared memory is admin opt-in only and fills prompts from
            real promoted messages — empty Neon memory stays empty.
          </p>
        </div>
        <nav className="intel-actions" aria-label="AI Memory shortcuts">
          <a href={chatHref}>Chat</a>
          <a href={budgetsHref}>Budgets</a>
          {governanceLinks
            .filter((link) => link.id === "prompt-caching" || link.id === "governance" || link.id === "knowledge")
            .map((link) => (
              <a key={link.id} href={link.href}>
                {link.label}
              </a>
            ))}
        </nav>
      </header>

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
        <section className="app-card soft-panel product-hub-setup" role="status">
          {shellCopy.badge ? <span className="app-badge setup">{shellCopy.badge}</span> : null}
          <h2>{shellCopy.title}</h2>
          <p className="app-muted">{shellCopy.description}</p>
          <NextActions
            orgId={orgId}
            shell={shell}
            enabled={settings.enabled}
            activeCount={Number.isFinite(activeCount) ? activeCount : 0}
          />
          {shell === "error" ? (
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
          ) : null}
        </section>
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
                  <a className="app-button secondary" href={chatHref}>
                    Open Chat context
                  </a>
                ) : (
                  <a className="app-button secondary" href="#team-memory-policy">
                    Admin policy
                  </a>
                )}
              </article>
            ))}
          </section>

          <section className="metric-grid" aria-label="Team memory counts">
            <article>
              <span>Injection</span>
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
            <section className="app-card soft-panel product-hub-setup" role="status">
              {shellCopy.badge ? <span className="app-badge setup">{shellCopy.badge}</span> : null}
              <h2>{shellCopy.title}</h2>
              <p className="app-muted">{shellCopy.description}</p>
            </section>
          ) : null}

          <NextActions
            orgId={orgId}
            shell={shell}
            enabled={settings.enabled}
            activeCount={Number.isFinite(activeCount) ? activeCount : 0}
          />

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
                <button
                  type="button"
                  className="app-button secondary dream-run-now"
                  onClick={() => void runDreamNow()}
                  disabled={running}
                >
                  {running ? "Running…" : "Run now for today"}
                </button>
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
                No nightly run has ever reached this team. If that is unexpected, the nightly trigger may not
                be scheduled yet — see docs/DREAMING.md for the cron setup.
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
                <button type="button" className="app-button secondary" onClick={() => void loadJournal()}>
                  Retry
                </button>
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
                  <button
                    type="button"
                    className="app-button secondary dream-more"
                    disabled={journalMore}
                    onClick={() => void loadJournal(journalMeta.nextCursor)}
                  >
                    {journalMore ? "Loading…" : "Load earlier entries"}
                  </button>
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
              Opt-in controls for shared injection. Private per-user memory in Chat is unaffected when this is off.
            </p>
            <label className="state-control">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              />
              <span>
                <strong>Use team memory in assistant prompts</strong>
                <small>
                  When off, no shared team memory is injected. Empty lists stay empty — never DEMO facts.
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
              Per-prompt token budget
              <input
                type="number"
                min={0}
                max={10000}
                value={settings.tokenBudget}
                onChange={(e) => setSettings({ ...settings, tokenBudget: Number(e.target.value) })}
              />
              <small>
                Maximum tokens of team memory the assistant may add to any single prompt. Separate from API Budgets.
                0–10000.
              </small>
            </label>
            <div className="ai-memory-policy-actions">
              <button className="primary-action" disabled={saving} type="submit">
                {saving ? "Saving…" : "Save team memory policy"}
              </button>
              <a className="app-button secondary" href={chatHref}>
                Open Chat
              </a>
              <a className="app-button secondary" href={budgetsHref}>
                Open Budgets
              </a>
            </div>
          </form>
        </>
      ) : null}
    </main>
  );
}
