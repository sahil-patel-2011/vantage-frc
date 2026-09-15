"use client";

import { useCallback, useEffect, useState } from "react";
import { MeteredAiCutoffBanner } from "../../components/metered-ai-cutoff-banner";
import { EmptyState, Button } from "../../components/ui";
import { resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import type { KickoffIntelligenceRecord } from "../../lib/kickoff-intelligence";
import {
  analysisModeLabel,
  intelligenceAnalysisMode,
  intelligenceSourceLine,
  kickoffIntelligenceEmptyMessage,
  scoringEmptyLine,
} from "../../lib/kickoff/season-forecast";
import { kickoffPipelineLinks } from "../../lib/kickoff-related";
import { hubHref } from "../../lib/nav/hubs";
import type { ProviderSetupStep } from "./kickoff-model";

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
}: {
  orgId: string;
  seasonYear: number;
  busyKey: string | null;
  setBusyKey: (key: string | null) => void;
  setError: (message: string) => void;
  onApplied: () => Promise<void>;
  cutoffCode: string | null;
  setCutoffCode: (code: string | null) => void;
  onIntelMeta: (meta: { hasIntelligence: boolean; cadJobId: string | null }) => void;
}) {
  const [manualText, setManualText] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [records, setRecords] = useState<KickoffIntelligenceRecord[]>([]);
  const [intelStatus, setIntelStatus] = useState<"ready" | "empty" | "loading">("loading");
  const [emptyMessage, setEmptyMessage] = useState(kickoffIntelligenceEmptyMessage(false));
  const [canDeepAnalyze, setCanDeepAnalyze] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [providerSetup, setProviderSetup] = useState<{ message: string; steps: ProviderSetupStep[] } | null>(
    null,
  );
  const busy = busyKey != null;
  const selected = records.find((record) => record.id === selectedId) ?? records[0] ?? null;
  const pipeline = kickoffPipelineLinks({ orgId, cadJobId: selected?.cadJobId ?? null });

  const loadIntel = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/kickoff/intelligence?orgId=${encodeURIComponent(orgId)}&seasonYear=${seasonYear}`,
      );
      const data = (await response.json()) as {
        status?: string;
        message?: string | null;
        records?: KickoffIntelligenceRecord[];
        canDeepAnalyze?: boolean;
        teamNumber?: number | null;
        error?: string;
        code?: string;
        reason?: string;
        hardCutoff?: boolean;
      };
      if (!response.ok) {
        const cutoff = resolveCutoffErrorCode(response.status, data);
        if (cutoff) setCutoffCode(cutoff);
        setError(data.error ?? "Could not load game intelligence.");
        setIntelStatus("empty");
        onIntelMeta({ hasIntelligence: false, cadJobId: null });
        return;
      }
      const nextRecords = data.records ?? [];
      const nextCanDeep = data.canDeepAnalyze === true;
      setRecords(nextRecords);
      setCanDeepAnalyze(nextCanDeep);
      setIntelStatus(nextRecords.length ? "ready" : "empty");
      setEmptyMessage(data.message ?? kickoffIntelligenceEmptyMessage(nextCanDeep));
      if (nextRecords.length) {
        setSelectedId((current) => current ?? nextRecords[0]!.id);
        onIntelMeta({
          hasIntelligence: true,
          cadJobId: nextRecords[0]?.cadJobId ?? null,
        });
      } else {
        setSelectedId(null);
        onIntelMeta({ hasIntelligence: false, cadJobId: null });
      }
    } catch {
      setError("Network error — could not load game intelligence.");
      setIntelStatus("empty");
      onIntelMeta({ hasIntelligence: false, cadJobId: null });
    }
  }, [orgId, seasonYear, onIntelMeta, setCutoffCode, setError]);

  useEffect(() => {
    void loadIntel();
  }, [loadIntel]);

  useEffect(() => {
    if (!selected) return;
    onIntelMeta({ hasIntelligence: true, cadJobId: selected.cadJobId ?? null });
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
            Standard analysis collects official manuals, compares how past public leaks lined up with the real FRC game,
            compares this year&apos;s FTC game with FRC, and writes a labeled best guess. Deep analysis is Team 6925
            only — it reads a pasted manual and transcript, then seeds Strategy and CAD. Everything here is{" "}
            <strong>advice</strong> until you check it against the official FRC manual.
          </p>
        </div>
        <nav className="kick-pipeline-links" aria-label="Kickoff pipeline">
          {pipeline.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </nav>
      </header>

      <MeteredAiCutoffBanner orgId={orgId} errorCode={cutoffCode} compact />

      {providerSetup ? (
        <p className="app-muted" role="status">
          {providerSetup.message} Deep analysis needs team AI. Standard analysis still runs from official FIRST pages.{" "}
          <Button as="a" variant="secondary" href={providerSetup.steps[0]?.href ?? "/team/ai-bridge"}>
            {providerSetup.steps[0]?.label ?? "Connect Claude Code"}
          </Button>
        </p>
      ) : null}

      {canDeepAnalyze ? (
      <form
        className="kick-intel-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runIntel(
            {
              action: "analyze",
              mode: "deep",
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
            <input
              type="file"
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
          <Button variant="secondary" type="submit" disabled={busy || !canGenerate}>
            {busyKey === "intel-analyze" ? "Generating…" : "Run Team 6925 deep analysis"}
          </Button>
          <span className="app-muted">
            Reads the pasted manual and transcript, then seeds Strategy and a CAD brief. Chat pauses if the team is at
            its limit.
          </span>
        </div>
      </form>
      ) : null}

      {intelStatus === "loading" && !selected ? (
        <EmptyState soft title="Loading intelligence…" description="Checking for a saved release summary." aria-busy />
      ) : !selected ? (
        <EmptyState soft badge="Empty" title="No season analysis yet" description={emptyMessage}>
          <Button
            variant="primary"
            type="button"
            disabled={busy}
            onClick={() =>
              void runIntel(
                {
                  action: "analyze",
                  mode: "standard",
                  orgId,
                  seasonYear,
                  createCadBrief: false,
                  applyDrafts: false,
                },
                "intel-standard",
              )
            }
          >
            {busyKey === "intel-standard" ? "Building guess…" : "Run standard analysis"}
          </Button>
        </EmptyState>
      ) : (
        <article className="kick-intel-result">
          <header className="kick-intel-result-head">
            <div>
              <span className="kick-chip kick-phase-auto">{analysisModeLabel(intelligenceAnalysisMode(selected.summary))}</span>
              <span className="kick-chip kick-phase-auto">{selected.adviceLabel}</span>
              <h3>{selected.title}</h3>
              <p className="app-muted">{intelligenceSourceLine(intelligenceAnalysisMode(selected.summary))}</p>
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

          {selected.summary.forecast ? (
            <div className="kick-intel-grid">
              <div>
                <h4>Official manuals</h4>
                <ul className="kick-list">
                  {selected.summary.forecast.manuals.map((manual) => (
                    <li key={manual.href}>
                      <a href={manual.href} target="_blank" rel="noreferrer">
                        {manual.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>Leaks vs what shipped</h4>
                <ul className="kick-list">
                  {selected.summary.forecast.leakVsActual.map((row) => (
                    <li key={row.year}>
                      <strong>{row.year}</strong>
                      <div className="app-muted">Public before kickoff: {row.publicBeforeKickoff}</div>
                      <div className="app-muted">What shipped: {row.whatShipped}</div>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>FTC compared with FRC</h4>
                <ul className="kick-list">
                  {selected.summary.forecast.ftcCompare.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>Best guess</h4>
                <ul className="kick-list">
                  {selected.summary.forecast.guess.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

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
                  <li className="app-muted">{scoringEmptyLine(intelligenceAnalysisMode(selected.summary))}</li>
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
            <Button
              variant="secondary"
              type="button"
              disabled={busy}
              onClick={() =>
                void runIntel(
                  {
                    action: "analyze",
                    mode: "standard",
                    orgId,
                    seasonYear,
                    createCadBrief: false,
                    applyDrafts: false,
                  },
                  "intel-standard",
                )
              }
            >
              {busyKey === "intel-standard" ? "Building guess…" : "Run standard analysis again"}
            </Button>
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
            <button
              type="button"
              className="kick-link danger"
              disabled={busy}
              onClick={() => void runIntel({ action: "delete", orgId, id: selected.id }, "intel-delete")}
            >
              Delete summary
            </button>
          </div>
        </article>
      )}
    </section>
  );
}
