"use client";

import { canConnectForTeam } from "../../lib/ai/team-roles";
import { aiConnectionHref } from "../../lib/ai/connection";

import { useCallback, useEffect, useRef, useState } from "react";
import { MeteredAiCutoffBanner } from "../../components/metered-ai-cutoff-banner";
import { EmptyState, Button, askConfirm } from "../../components/ui";
import { resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import { canDeleteKickoffRow } from "../../lib/kickoff";
import type { KickoffIntelligenceRecord } from "../../lib/kickoff-intelligence";
import { hubHref } from "../../lib/nav/hubs";
import type { ProviderSetupStep } from "./kickoff-model";

type IntelResponse = {
  status?: string;
  message?: string | null;
  orgId?: string;
  records?: KickoffIntelligenceRecord[];
  role?: string;
  userId?: string;
  error?: string;
  code?: string;
  reason?: string;
  hardCutoff?: boolean;
};

type IntelRead = { ok: boolean; status: number; data: IntelResponse };

async function readIntel(url: string): Promise<IntelRead> {
  const response = await fetch(url);
  return { ok: response.ok, status: response.status, data: (await response.json()) as IntelResponse };
}

/** A read of /api/kickoff/intelligence started before /api/kickoff answers. */
export type KickoffIntelPrefetch = { seasonYear: number; result: Promise<IntelRead | null> };

/**
 * Starts the intelligence read at the same time as the Kickoff view instead of after it (the
 * section used to mount, and only then fetch, once /api/kickoff returned). Without an org hint
 * the server picks the same team /api/kickoff picks and says which one it answered for; the
 * section only uses this answer when that team and season match what it renders.
 */
export function prefetchKickoffIntelligence(orgHint: string, seasonYear: number): KickoffIntelPrefetch {
  const params = new URLSearchParams({ seasonYear: String(seasonYear) });
  if (orgHint) params.set("orgId", orgHint);
  return {
    seasonYear,
    result: readIntel(`/api/kickoff/intelligence?${params.toString()}`).catch(() => null),
  };
}

export function IntelligenceSection({
  orgId,
  seasonYear,
  busyKey,
  setBusyKey,
  setError,
  onApplied,
  cutoffCode,
  setCutoffCode,
  onIntelMeta,
  prefetch = null,
}: {
  prefetch?: KickoffIntelPrefetch | null;
  orgId: string;
  seasonYear: number;
  busyKey: string | null;
  setBusyKey: (key: string | null) => void;
  setError: (message: string) => void;
  onApplied: () => Promise<void>;
  cutoffCode: string | null;
  setCutoffCode: (code: string | null) => void;
  /** Told whether a summary exists (and its CAD brief), for a caller that wants to know. */
  onIntelMeta?: (meta: { hasIntelligence: boolean; cadJobId: string | null }) => void;
}) {
  const [manualText, setManualText] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [records, setRecords] = useState<KickoffIntelligenceRecord[]>([]);
  const [role, setRole] = useState("");
  const [userId, setUserId] = useState("");
  const [intelStatus, setIntelStatus] = useState<"ready" | "empty" | "loading">("loading");
  const [emptyMessage, setEmptyMessage] = useState(
    "Upload a game manual excerpt or kickoff transcript to generate the season intelligence summary.",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [providerSetup, setProviderSetup] = useState<{ message: string; steps: ProviderSetupStep[] } | null>(
    null,
  );
  const busy = busyKey != null;
  const selected = records.find((record) => record.id === selectedId) ?? records[0] ?? null;

  const prefetchUsed = useRef(false);

  const loadIntel = useCallback(async () => {
    try {
      let read: IntelRead | null = null;
      if (prefetch && !prefetchUsed.current && prefetch.seasonYear === seasonYear) {
        prefetchUsed.current = true;
        const early = await prefetch.result;
        // Only trust the early answer when it is for this team; otherwise read again.
        if (early?.ok && early.data.orgId === orgId) read = early;
      }
      read ??= await readIntel(
        `/api/kickoff/intelligence?orgId=${encodeURIComponent(orgId)}&seasonYear=${seasonYear}`,
      );
      const response = read;
      const data = read.data;
      if (!response.ok) {
        const cutoff = resolveCutoffErrorCode(response.status, data);
        if (cutoff) setCutoffCode(cutoff);
        setError(data.error ?? "Could not load game intelligence.");
        setIntelStatus("empty");
        onIntelMeta?.({ hasIntelligence: false, cadJobId: null });
        return;
      }
      setError("");
      const nextRecords = data.records ?? [];
      setRecords(nextRecords);
      setRole(data.role ?? "");
      setUserId(data.userId ?? "");
      setIntelStatus(nextRecords.length ? "ready" : "empty");
      setEmptyMessage(
        data.message ??
          "Upload a game manual excerpt or kickoff transcript to generate the season intelligence summary.",
      );
      if (nextRecords.length) {
        setSelectedId((current) => current ?? nextRecords[0]!.id);
        onIntelMeta?.({
          hasIntelligence: true,
          cadJobId: nextRecords[0]?.cadJobId ?? null,
        });
      } else {
        setSelectedId(null);
        onIntelMeta?.({ hasIntelligence: false, cadJobId: null });
      }
    } catch {
      setError("Couldn't load the season summary. Check your connection and try again.");
      setIntelStatus("empty");
      onIntelMeta?.({ hasIntelligence: false, cadJobId: null });
    }
  }, [orgId, seasonYear, onIntelMeta, setCutoffCode, setError, prefetch]);

  useEffect(() => {
    void loadIntel();
  }, [loadIntel]);

  useEffect(() => {
    if (!selected) return;
    onIntelMeta?.({ hasIntelligence: true, cadJobId: selected.cadJobId ?? null });
  }, [selected, onIntelMeta]);

  async function runIntel(body: Record<string, unknown>, key: string) {
    setBusyKey(key);
    setError("");
    setCutoffCode(null);
    setProviderSetup(null);
    try {
      const response = await fetch("/api/kickoff/intelligence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as {
        error?: string;
        code?: string;
        reason?: string;
        message?: string;
        status?: string;
        steps?: ProviderSetupStep[];
        hardCutoff?: boolean;
        id?: string;
        cadJobId?: string | null;
        record?: KickoffIntelligenceRecord | null;
      };
      if (!response.ok) {
        const cutoff = resolveCutoffErrorCode(response.status, data);
        if (cutoff) {
          setCutoffCode(cutoff);
          setError("");
          return;
        }
        if (data.code === "setup_required" || data.status === "setup_required") {
          setProviderSetup({
            message: data.message || data.error || "Ask a mentor to connect team AI before generating a kickoff summary.",
            steps: Array.isArray(data.steps) ? data.steps : [],
          });
          setError("");
          return;
        }
        setError(data.error ?? "Intelligence action failed.");
        return;
      }
      if (data.id) setSelectedId(data.id);
      await loadIntel();
      await onApplied();
    } catch {
      setError("Network error — intelligence was not saved.");
    } finally {
      setBusyKey(null);
    }
  }

  function onPickFile(kind: "manual" | "transcript", file: File | null) {
    if (!file) return;
    if (file.size > 1_500_000) {
      setError("Keep uploads under ~1.5 MB of plain text. For PDFs, paste extracted text instead.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (kind === "manual") setManualText(text);
      else setTranscriptText(text);
    };
    reader.readAsText(file);
  }

  const canGenerate = Boolean(manualText.trim() || transcriptText.trim() || sourceUrl.trim());

  return (
    <section className="app-card soft-panel kick-section kick-intel">
      <header className="kick-intel-head">
        <div>
          <h2>Game release intelligence</h2>
          <p className="app-muted">
            Paste the game manual and kickoff transcript (or a text URL). Vantage structures a season summary, seeds
            Strategy design priorities, and opens a CAD brief. Everything it writes is marked as an{" "}
            <strong>AI suggestion</strong> — check it against the manual before you build on it.
          </p>
        </div>
      </header>

      <MeteredAiCutoffBanner orgId={orgId} errorCode={cutoffCode} compact />

      {providerSetup ? (
        <EmptyState
          compact
          title="Team AI isn't connected yet"
          description={
            canConnectForTeam(role)
              ? "Connect an assistant to generate a season summary from your sources."
              : providerSetup.message || "Ask a mentor to connect team AI to generate a season summary."
          }
        >
          {canConnectForTeam(role) ? (
            <Button as="a" variant="primary" href={aiConnectionHref(orgId)}>Connect AI</Button>
          ) : null}
        </EmptyState>
      ) : null}

      <form
        className="kick-intel-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runIntel(
            {
              action: "analyze",
              orgId,
              seasonYear,
              manualText: manualText.trim() || null,
              transcriptText: transcriptText.trim() || null,
              sourceUrl: sourceUrl.trim() || null,
              createCadBrief: true,
              applyDrafts: true,
            },
            "intel-analyze",
          );
        }}
      >
        <div className="kick-intel-entry">
          <label>
            Game manual (paste or .txt)
            <textarea
              value={manualText}
              disabled={busy}
              rows={7}
              placeholder="Paste scoring tables, game pieces, constraints from the official manual…"
              onChange={(event) => setManualText(event.target.value)}
            />
            {/* Named on the input itself. This label already wraps the
                textarea above, and a label names only its first control — so
                without this the file picker was the one control on the page
                with no name at all. */}
            <input
              type="file"
              aria-label="Upload the game manual as a .txt file"
              accept=".txt,.md,.markdown,text/plain"
              disabled={busy}
              onChange={(event) => onPickFile("manual", event.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Kickoff video transcript
            <textarea
              value={transcriptText}
              disabled={busy}
              rows={7}
              placeholder="Paste the reveal transcript or Q&A…"
              onChange={(event) => setTranscriptText(event.target.value)}
            />
            <input
              type="file"
              aria-label="Upload the kickoff transcript as a .txt file"
              accept=".txt,.md,.markdown,text/plain"
              disabled={busy}
              onChange={(event) => onPickFile("transcript", event.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <label>
          Optional text URL
          <input
            type="url"
            value={sourceUrl}
            disabled={busy}
            placeholder="https://… (plain text / markdown — not PDF binary)"
            onChange={(event) => setSourceUrl(event.target.value)}
          />
        </label>
        <div className="kick-intel-submit">
          <Button variant="primary" type="submit" disabled={busy || !canGenerate}>
            {busyKey === "intel-analyze" ? "Generating…" : "Generate summary"}
          </Button>
          <span className="app-muted">
            Also suggests strategy priorities and starts a CAD brief.
          </span>
        </div>
      </form>

      {intelStatus === "loading" && !selected ? (
        <EmptyState soft title="Loading intelligence…" description="Checking for a saved release summary." aria-busy />
      ) : !selected ? (
        <EmptyState soft badge="Empty" title="No structured summary yet" description={emptyMessage}>
          <p className="app-muted">
            Paste the {seasonYear} game manual and kickoff transcript above to fill this in.
          </p>
        </EmptyState>
      ) : (
        <article className="kick-intel-result">
          <header className="kick-intel-result-head">
            <div>
              <span className="kick-chip kick-phase-auto">{selected.adviceLabel}</span>
              <h3>{selected.title}</h3>
              <p className="app-muted">From your team&apos;s AI</p>
            </div>
            <div className="kick-intel-result-actions">
              {records.length > 1 ? (
                <label className="kick-year">
                  Version
                  <select
                    value={selected.id}
                    disabled={busy}
                    onChange={(event) => setSelectedId(event.target.value)}
                  >
                    {records.map((record) => (
                      <option key={record.id} value={record.id}>
                        {record.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <nav className="kick-pipeline-links" aria-label="Open strategy and CAD">
                <Button as="a" variant="secondary" href={hubHref("/competition", "strategy", orgId)}>
                  Strategy seeds
                </Button>
                <Button as="a" variant="secondary" href={hubHref("/build", "cad", orgId)}>
                  {selected.cadJobId ? "Open CAD brief" : "CAD briefs"}
                </Button>
              </nav>
            </div>
          </header>

          <p>{selected.summary.overview}</p>

          <div className="kick-intel-grid">
            <div>
              <h4>Game pieces</h4>
              <ul className="kick-list">
                {selected.summary.gamePieces.length ? (
                  selected.summary.gamePieces.map((piece) => (
                    <li key={piece.name}>
                      <strong>{piece.name}</strong>
                      {piece.notes ? <span className="app-muted"> — {piece.notes}</span> : null}
                    </li>
                  ))
                ) : (
                  <li className="app-muted">None extracted yet — add from the manual.</li>
                )}
              </ul>
            </div>
            <div>
              <h4>Scoring (from source)</h4>
              <ul className="kick-list">
                {selected.summary.scoring.length ? (
                  selected.summary.scoring.map((row) => (
                    <li key={`${row.phase}-${row.action}`}>
                      <strong>{row.action}</strong>
                      <span className="app-muted">
                        {" "}
                        · {row.phase}
                        {row.points != null ? ` · ${row.points} pts` : " · points TBD"}
                      </span>
                    </li>
                  ))
                ) : (
                  <li className="app-muted">No numeric scoring lines found — add them below.</li>
                )}
              </ul>
            </div>
            <div>
              <h4>How to play</h4>
              <ul className="kick-list">
                {selected.summary.howToPlay.length ? (
                  selected.summary.howToPlay.map((step) => <li key={step}>{step}</li>)
                ) : (
                  <li className="app-muted">Add gameplay notes from the reveal.</li>
                )}
              </ul>
            </div>
            <div>
              <h4>Constraints</h4>
              <ul className="kick-list">
                {selected.summary.constraints.length ? (
                  selected.summary.constraints.map((item) => <li key={item}>{item}</li>)
                ) : (
                  <li className="app-muted">Confirm robot rules in the official manual.</li>
                )}
              </ul>
            </div>
          </div>

          <div className="kick-intel-grid">
            <div>
              <h4>Design directions ({selected.adviceLabel})</h4>
              <ul className="kick-list">
                {selected.designPrioritiesDraft.map((direction) => (
                  <li key={direction.capability}>
                    <strong>
                      {direction.capability} · w{direction.weight}
                    </strong>
                    <div className="app-muted">{direction.rationale}</div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Open questions</h4>
              <ul className="kick-list">
                {selected.summary.openQuestions.length ? (
                  selected.summary.openQuestions.map((question) => <li key={question}>{question}</li>)
                ) : (
                  <li className="app-muted">None extracted.</li>
                )}
              </ul>
            </div>
          </div>

          <p className="kick-intel-advice">{selected.strategyAdvice.localText}</p>
          <p className="app-muted kick-intel-disclaimer">{selected.summary.provenance.disclaimer}</p>

          <div className="kick-add">
            <Button variant="secondary" type="button" disabled={busy} onClick={() => void runIntel({ action: "apply", orgId, id: selected.id }, "intel-apply")}>
              Re-seed Strategy priorities
            </Button>
            <Button variant="secondary" type="button" disabled={busy} onClick={() => void runIntel({ action: "create_cad_brief", orgId, id: selected.id }, "intel-cad")}>
              {selected.cadJobId ? "Create another CAD brief" : "Create CAD brief"}
            </Button>
            <Button as="a" variant="secondary" href={hubHref("/competition", "strategy", orgId)}>
              Open Strategy
            </Button>
            <Button as="a" variant="secondary" href={hubHref("/build", "cad", orgId)}>
              Open CAD
            </Button>
            {canDeleteKickoffRow({ role, userId, authorId: selected.createdBy }) ? (
              <button
                type="button"
                className="kick-link danger"
                disabled={busy}
                onClick={async () => { if (await askConfirm({ title: "Delete this summary?", body: "The kickoff summary is deleted.", confirmLabel: "Delete summary", tone: "destructive" })) void runIntel({ action: "delete", orgId, id: selected.id }, "intel-delete"); }}
              >
                Delete summary
              </button>
            ) : null}
          </div>
        </article>
      )}
    </section>
  );
}
