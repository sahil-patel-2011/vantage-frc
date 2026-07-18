"use client";

import { useCallback, useEffect, useState } from "react";
import { BuildHubRelated } from "../../components/build-hub-related";
import {
  kickoffSummary,
  PHASES,
  pointsPerSecond,
  PRIORITY_STATUSES,
  rankActions,
  type DesignPriority,
  type KickoffView,
  type Phase,
  type RuleNote,
  type ScoringAction,
} from "../../lib/kickoff";
import type { KickoffIntelligenceRecord } from "../../lib/kickoff-intelligence";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };
type RunFn = (body: ActionBody, key: string) => Promise<void>;

function IntelligenceSection({
  orgId,
  seasonYear,
  busyKey,
  setBusyKey,
  setError,
  onApplied,
}: {
  orgId: string;
  seasonYear: number;
  busyKey: string | null;
  setBusyKey: (key: string | null) => void;
  setError: (message: string) => void;
  onApplied: () => Promise<void>;
}) {
  const [manualText, setManualText] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [records, setRecords] = useState<KickoffIntelligenceRecord[]>([]);
  const [emptyMessage, setEmptyMessage] = useState(
    "Upload a game manual excerpt or kickoff transcript to generate the season intelligence summary.",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const busy = busyKey != null;
  const selected = records.find((record) => record.id === selectedId) ?? records[0] ?? null;

  const loadIntel = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/kickoff/intelligence?orgId=${encodeURIComponent(orgId)}&seasonYear=${seasonYear}`,
      );
      const data = (await response.json()) as {
        status?: string;
        message?: string | null;
        records?: KickoffIntelligenceRecord[];
        error?: string;
      };
      if (!response.ok) {
        setError(data.error ?? "Could not load game intelligence.");
        return;
      }
      setRecords(data.records ?? []);
      setEmptyMessage(
        data.message ??
          "Upload a game manual excerpt or kickoff transcript to generate the season intelligence summary.",
      );
      if (data.records?.length) {
        setSelectedId((current) => current ?? data.records![0]!.id);
      }
    } catch {
      setError("Network error — could not load game intelligence.");
    }
  }, [orgId, seasonYear, setError]);

  useEffect(() => {
    void loadIntel();
  }, [loadIntel]);

  async function runIntel(body: Record<string, unknown>, key: string) {
    setBusyKey(key);
    setError("");
    try {
      const response = await fetch("/api/kickoff/intelligence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as {
        error?: string;
        id?: string;
        cadJobId?: string | null;
        record?: KickoffIntelligenceRecord | null;
      };
      if (!response.ok) {
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

  return (
    <section className="app-card kick-section kick-intel">
      <h2>Game release intelligence</h2>
      <p className="app-muted">
        Paste the game manual and kickoff transcript (or a text URL). Vantage structures a season summary, seeds design
        priorities, and opens a CAD design brief — labeled <strong>MODEL</strong> advice, never invented DEMO stats.
      </p>

      {!selected ? (
        <div className="kick-intel-empty">
          <strong>Waiting for release materials</strong>
          <p className="app-muted">{emptyMessage}</p>
        </div>
      ) : (
        <article className="kick-intel-result">
          <header className="kick-intel-result-head">
            <div>
              <span className="kick-chip kick-phase-auto">{selected.adviceLabel}</span>
              <h3>{selected.title}</h3>
              <p className="app-muted">
                {selected.provider}/{selected.model}
                {selected.cadJobId ? (
                  <>
                    {" "}
                    ·{" "}
                    <a className="kick-link" href={`/cad?orgId=${encodeURIComponent(orgId)}`}>
                      Open CAD brief
                    </a>
                  </>
                ) : null}
              </p>
            </div>
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
                  <li className="app-muted">None extracted yet.</li>
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
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() => void runIntel({ action: "apply", orgId, id: selected.id }, "intel-apply")}
            >
              Re-seed priorities
            </button>
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() => void runIntel({ action: "create_cad_brief", orgId, id: selected.id }, "intel-cad")}
            >
              {selected.cadJobId ? "Create another CAD brief" : "Create CAD brief"}
            </button>
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
        <label>
          Game manual (paste or .txt)
          <textarea
            value={manualText}
            disabled={busy}
            rows={7}
            placeholder="Paste scoring tables, game pieces, constraints…"
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
        <button
          type="submit"
          className="app-button"
          disabled={busy || (!manualText.trim() && !transcriptText.trim() && !sourceUrl.trim())}
        >
          {busyKey === "intel-analyze" ? "Generating…" : "Generate summary → strategy → CAD"}
        </button>
      </form>
    </section>
  );
}

function ScoringSection({
  actions,
  orgId,
  seasonYear,
  busyKey,
  run,
}: {
  actions: ScoringAction[];
  orgId: string;
  seasonYear: number;
  busyKey: string | null;
  run: RunFn;
}) {
  const [label, setLabel] = useState("");
  const [phase, setPhase] = useState<Phase>("teleop");
  const [pointsText, setPointsText] = useState("");
  const [secondsText, setSecondsText] = useState("");
  const busy = busyKey != null;
  const ranked = rankActions(actions);

  return (
    <section className="app-card kick-section">
      <h2>Scoring analysis</h2>
      <p className="app-muted">
        List every way to score, estimate the cycle time, and let points per second show where the value is.
      </p>

      {ranked.length === 0 ? (
        <p className="app-muted">No scoring actions yet — start with the highest-point actions in the {seasonYear} game.</p>
      ) : (
        <div className="kick-table">
          <div className="kick-row kick-row-head" aria-hidden="true">
            <span>Action</span>
            <span>Phase</span>
            <span>Points</span>
            <span>Est. sec</span>
            <span>Pts/sec</span>
            <span />
          </div>
          {ranked.map((action) => {
            const rate = pointsPerSecond(action);
            const rowKey = `action:${action.id}`;
            const rowBusy = busyKey === rowKey;
            return (
              <div key={action.id} className="kick-row">
                <span className="kick-label">
                  {action.label}
                  {action.notes ? <small className="app-muted">{action.notes}</small> : null}
                </span>
                <span className={`kick-chip kick-phase-${action.phase}`}>{action.phase}</span>
                <input
                  key={`pts-${action.id}-${action.points}`}
                  type="number"
                  className="kick-num"
                  min={0}
                  max={1000}
                  step={0.5}
                  defaultValue={action.points}
                  disabled={rowBusy}
                  aria-label={`Points for ${action.label}`}
                  onBlur={(event) => {
                    const raw = event.target.value.trim();
                    if (raw === "") return;
                    const next = Number(raw);
                    if (!Number.isFinite(next) || next < 0 || next > 1000 || next === action.points) return;
                    void run({ action: "update_action", orgId, id: action.id, points: next }, rowKey);
                  }}
                />
                <input
                  key={`sec-${action.id}-${action.estSeconds ?? "none"}`}
                  type="number"
                  className="kick-num"
                  min={0}
                  max={600}
                  step={0.5}
                  placeholder="—"
                  defaultValue={action.estSeconds ?? ""}
                  disabled={rowBusy}
                  aria-label={`Estimated seconds for ${action.label}`}
                  onBlur={(event) => {
                    const raw = event.target.value.trim();
                    const next = raw === "" ? null : Number(raw);
                    if (next != null && (!Number.isFinite(next) || next <= 0 || next > 600)) return;
                    if (next === action.estSeconds) return;
                    void run({ action: "update_action", orgId, id: action.id, estSeconds: next }, rowKey);
                  }}
                />
                <b className="kick-rate">{rate == null ? "—" : rate.toFixed(2)}</b>
                <button
                  type="button"
                  className="kick-link danger"
                  aria-label={`Delete ${action.label}`}
                  disabled={busy}
                  onClick={() => void run({ action: "delete_action", orgId, id: action.id }, rowKey)}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      <form
        className="kick-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!label.trim() || pointsText.trim() === "") return;
          void run(
            {
              action: "add_action",
              orgId,
              seasonYear,
              label: label.trim(),
              phase,
              points: Number(pointsText),
              estSeconds: secondsText.trim() === "" ? null : Number(secondsText),
            },
            "add-action",
          ).then(() => {
            setLabel("");
            setPointsText("");
            setSecondsText("");
          });
        }}
      >
        <input
          value={label}
          disabled={busy}
          placeholder="Scoring action (e.g. Score in high goal)"
          onChange={(event) => setLabel(event.target.value)}
        />
        <select value={phase} disabled={busy} aria-label="Phase" onChange={(event) => setPhase(event.target.value as Phase)}>
          {PHASES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <input
          type="number"
          className="kick-num-add"
          min={0}
          max={1000}
          step={0.5}
          value={pointsText}
          disabled={busy}
          placeholder="Points"
          onChange={(event) => setPointsText(event.target.value)}
        />
        <input
          type="number"
          className="kick-num-add"
          min={0}
          max={600}
          step={0.5}
          value={secondsText}
          disabled={busy}
          placeholder="Est. sec"
          onChange={(event) => setSecondsText(event.target.value)}
        />
        <button type="submit" className="app-button secondary" disabled={busy || !label.trim() || pointsText.trim() === ""}>
          Add action
        </button>
      </form>
    </section>
  );
}

function PrioritySection({
  priorities,
  actions,
  orgId,
  seasonYear,
  busyKey,
  run,
}: {
  priorities: DesignPriority[];
  actions: ScoringAction[];
  orgId: string;
  seasonYear: number;
  busyKey: string | null;
  run: RunFn;
}) {
  const [capability, setCapability] = useState("");
  const [rationale, setRationale] = useState("");
  const [weightText, setWeightText] = useState("3");
  const [linkedId, setLinkedId] = useState("");
  const busy = busyKey != null;
  const sorted = [...priorities].sort((a, b) => b.weight - a.weight);

  return (
    <section className="app-card kick-section">
      <h2>Design priorities</h2>
      <p className="app-muted">Turn the best-value actions into weighted robot capabilities the team commits to.</p>

      {sorted.length === 0 ? (
        <p className="app-muted">No priorities yet — derive them from the top of the scoring analysis.</p>
      ) : (
        <ul className="kick-list">
          {sorted.map((priority) => {
            const rowKey = `priority:${priority.id}`;
            const rowBusy = busyKey === rowKey;
            return (
              <li key={priority.id} className="kick-priority">
                <div className="kick-priority-text">
                  <strong>{priority.capability}</strong>
                  {priority.rationale ? <small className="app-muted">{priority.rationale}</small> : null}
                </div>
                <div className="kick-weight" role="group" aria-label={`Weight for ${priority.capability}`}>
                  {[1, 2, 3, 4, 5].map((weight) => (
                    <button
                      key={weight}
                      type="button"
                      className={weight === priority.weight ? "kick-weight-btn active" : "kick-weight-btn"}
                      disabled={rowBusy}
                      onClick={() => {
                        if (weight !== priority.weight) {
                          void run({ action: "update_priority", orgId, id: priority.id, weight }, rowKey);
                        }
                      }}
                    >
                      {weight}
                    </button>
                  ))}
                </div>
                <select
                  value={priority.status}
                  disabled={rowBusy}
                  aria-label={`Status for ${priority.capability}`}
                  onChange={(event) => void run({ action: "update_priority", orgId, id: priority.id, status: event.target.value }, rowKey)}
                >
                  {PRIORITY_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <select
                  value={priority.linkedActionId ?? ""}
                  disabled={rowBusy}
                  aria-label={`Linked action for ${priority.capability}`}
                  onChange={(event) =>
                    void run({ action: "update_priority", orgId, id: priority.id, linkedActionId: event.target.value || null }, rowKey)
                  }
                >
                  <option value="">No linked action</option>
                  {actions.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                  {priority.linkedActionId != null && !actions.some((entry) => entry.id === priority.linkedActionId) ? (
                    <option value={priority.linkedActionId}>Linked (other season)</option>
                  ) : null}
                </select>
                <button
                  type="button"
                  className="kick-link danger"
                  aria-label={`Delete ${priority.capability}`}
                  disabled={busy}
                  onClick={() => void run({ action: "delete_priority", orgId, id: priority.id }, rowKey)}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="kick-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!capability.trim()) return;
          void run(
            {
              action: "add_priority",
              orgId,
              seasonYear,
              capability: capability.trim(),
              rationale: rationale.trim(),
              weight: Number(weightText),
              linkedActionId: linkedId || null,
            },
            "add-priority",
          ).then(() => {
            setCapability("");
            setRationale("");
            setWeightText("3");
            setLinkedId("");
          });
        }}
      >
        <input
          value={capability}
          disabled={busy}
          placeholder="Capability (e.g. Fast ground intake)"
          onChange={(event) => setCapability(event.target.value)}
        />
        <input value={rationale} disabled={busy} placeholder="Why it matters" onChange={(event) => setRationale(event.target.value)} />
        <select value={weightText} disabled={busy} aria-label="Weight" onChange={(event) => setWeightText(event.target.value)}>
          {[1, 2, 3, 4, 5].map((weight) => (
            <option key={weight} value={String(weight)}>
              Weight {weight}
            </option>
          ))}
        </select>
        <select value={linkedId} disabled={busy} aria-label="Linked action" onChange={(event) => setLinkedId(event.target.value)}>
          <option value="">No linked action</option>
          {actions.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <button type="submit" className="app-button secondary" disabled={busy || !capability.trim()}>
          Add priority
        </button>
      </form>
    </section>
  );
}

function RulesSection({
  ruleNotes,
  orgId,
  seasonYear,
  busyKey,
  run,
}: {
  ruleNotes: RuleNote[];
  orgId: string;
  seasonYear: number;
  busyKey: string | null;
  run: RunFn;
}) {
  const [question, setQuestion] = useState("");
  const [ruleRef, setRuleRef] = useState("");
  const busy = busyKey != null;
  const sorted = [...ruleNotes].sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1));

  return (
    <section className="app-card kick-section">
      <h2>Rules Q&A</h2>
      <p className="app-muted">Track manual questions from kickoff weekend and record the ruling once it lands.</p>

      {sorted.length === 0 ? (
        <p className="app-muted">No rules questions yet for the {seasonYear} season.</p>
      ) : (
        <ul className="kick-list">
          {sorted.map((note) => {
            const rowKey = `note:${note.id}`;
            const rowBusy = busyKey === rowKey;
            return (
              <li key={note.id} className="kick-rule">
                <div className="kick-rule-head">
                  <strong>{note.question}</strong>
                  {note.ruleRef ? <span className="kick-chip">{note.ruleRef}</span> : null}
                  <span className={note.status === "answered" ? "app-badge good" : "app-badge setup"}>
                    {note.status === "answered" ? "Answered" : "Open"}
                  </span>
                  <span className="kick-rule-actions">
                    <button
                      type="button"
                      className="kick-link"
                      disabled={rowBusy}
                      onClick={() =>
                        void run(
                          { action: "update_rule_note", orgId, id: note.id, status: note.status === "answered" ? "open" : "answered" },
                          rowKey,
                        )
                      }
                    >
                      {note.status === "answered" ? "Reopen" : "Mark answered"}
                    </button>
                    <button
                      type="button"
                      className="kick-link danger"
                      aria-label={`Delete ${note.question}`}
                      disabled={busy}
                      onClick={() => void run({ action: "delete_rule_note", orgId, id: note.id }, rowKey)}
                    >
                      ✕
                    </button>
                  </span>
                </div>
                <textarea
                  key={`answer-${note.id}-${note.answer}`}
                  defaultValue={note.answer}
                  placeholder="Answer (cite the manual or official Q&A)…"
                  disabled={rowBusy}
                  aria-label={`Answer for ${note.question}`}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next === note.answer) return;
                    void run({ action: "update_rule_note", orgId, id: note.id, answer: next }, rowKey);
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="kick-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!question.trim()) return;
          void run(
            { action: "add_rule_note", orgId, seasonYear, question: question.trim(), ruleRef: ruleRef.trim() },
            "add-rule-note",
          ).then(() => {
            setQuestion("");
            setRuleRef("");
          });
        }}
      >
        <input
          value={question}
          disabled={busy}
          placeholder="Rules question (e.g. Can two robots defend the same zone?)"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <input
          value={ruleRef}
          disabled={busy}
          placeholder="Rule ref (e.g. G420)"
          className="kick-ref-input"
          onChange={(event) => setRuleRef(event.target.value)}
        />
        <button type="submit" className="app-button secondary" disabled={busy || !question.trim()}>
          Add question
        </button>
      </form>
    </section>
  );
}

export default function KickoffClient() {
  const [view, setView] = useState<KickoffView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const load = useCallback(async () => {
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/kickoff${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as KickoffView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load kickoff analysis.");
        setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
    } catch {
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/kickoff", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return;
        }
        await load();
      } catch {
        setError("Network error — changes were not saved.");
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  if (fetchFailed || !view) {
    return (
      <main className="module-page kick-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Season / Kickoff</span>
            <h1>Kickoff & Game Analysis</h1>
          </div>
        </header>
        <div className="app-card kick-empty">
          {fetchFailed ? (
            <>
              <strong>Could not load kickoff analysis</strong>
              <p className="app-muted">{error || "Check your connection and try again."}</p>
              <button type="button" className="app-button secondary" onClick={() => void load()}>
                Retry
              </button>
            </>
          ) : (
            <p className="app-muted">Loading kickoff analysis…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page kick-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Season / Kickoff</span>
            <h1>Kickoff & Game Analysis</h1>
            <p>Break the new game into scoring actions, rank them by value, and lock the design priorities.</p>
          </div>
        </header>
        <BuildHubRelated active="kickoff" />
        <div className="app-card kick-empty soft-panel">
          <span className="app-badge setup">Setup required</span>
          <strong>Select a team workspace</strong>
          <p className="app-muted">{view.message}</p>
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </div>
      </main>
    );
  }

  const orgId = view.context.orgId ?? "";
  const yearSet = new Set<number>([view.context.defaultSeasonYear]);
  for (const entry of view.actions) yearSet.add(entry.seasonYear);
  for (const entry of view.priorities) yearSet.add(entry.seasonYear);
  for (const entry of view.ruleNotes) yearSet.add(entry.seasonYear);
  const years = [...yearSet].sort((a, b) => b - a);
  const year = selectedYear != null && yearSet.has(selectedYear) ? selectedYear : view.context.defaultSeasonYear;
  const actions = view.actions.filter((entry) => entry.seasonYear === year);
  const priorities = view.priorities.filter((entry) => entry.seasonYear === year);
  const ruleNotes = view.ruleNotes.filter((entry) => entry.seasonYear === year);
  const summary = kickoffSummary(actions, priorities, ruleNotes);

  return (
    <main className="module-page kick-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Season / Kickoff</span>
          <h1>Kickoff & Game Analysis</h1>
          <p>
            Start from the {year} manual and kickoff transcript for {view.context.orgName ?? "your team"}
            {view.context.teamNumber ? ` (Team ${view.context.teamNumber})` : ""} — structure the game, rank
            scoring value, lock design priorities, and hand a CAD brief to Onshape/Fusion paths.
          </p>
          <p className="app-muted" style={{ marginTop: "0.5rem" }}>
            <a href={`/team/getting-started?orgId=${encodeURIComponent(orgId)}`}>Getting started</a>
            {" · "}
            <a href={`/team/calendar?orgId=${encodeURIComponent(orgId)}`}>Subteam calendar</a>
            {" · "}
            <a href={`/team/knowledge?orgId=${encodeURIComponent(orgId)}`}>Knowledge wiki</a>
            {" · "}
            <a href={`/logistics?orgId=${encodeURIComponent(orgId)}`}>Logistics</a>
          </p>
        </div>
        <label className="kick-year">
          Season
          <select value={year} disabled={busyKey != null} onChange={(event) => setSelectedYear(Number(event.target.value))}>
            {years.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </header>

      <BuildHubRelated orgId={orgId} active="kickoff" />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <section className="kick-tiles">
        <div className="app-card kick-tile">
          <span className="kick-tile-value">{summary.actions}</span>
          <span className="kick-tile-label">Actions analyzed</span>
        </div>
        <div className="app-card kick-tile">
          <span className="kick-tile-value kick-tile-best">{summary.bestAction ?? "—"}</span>
          <span className="kick-tile-label">Best value action</span>
        </div>
        <div className="app-card kick-tile">
          <span className="kick-tile-value">{summary.committed}</span>
          <span className="kick-tile-label">Committed priorities</span>
        </div>
        <div className="app-card kick-tile">
          <span className="kick-tile-value">{summary.openQuestions}</span>
          <span className="kick-tile-label">Open rules questions</span>
        </div>
      </section>

      <IntelligenceSection
        orgId={orgId}
        seasonYear={year}
        busyKey={busyKey}
        setBusyKey={setBusyKey}
        setError={setError}
        onApplied={load}
      />
      <ScoringSection actions={actions} orgId={orgId} seasonYear={year} busyKey={busyKey} run={run} />
      <PrioritySection priorities={priorities} actions={actions} orgId={orgId} seasonYear={year} busyKey={busyKey} run={run} />
      <RulesSection ruleNotes={ruleNotes} orgId={orgId} seasonYear={year} busyKey={busyKey} run={run} />
    </main>
  );
}
