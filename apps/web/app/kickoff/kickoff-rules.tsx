"use client";

import { useState } from "react";
import { EmptyState, Button } from "../../components/ui";
import type { RuleNote } from "../../lib/kickoff";
import type { RunFn } from "./kickoff-model";

export function RulesSection({
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
    <section className="app-card soft-panel kick-section">
      <h2>Rules Q&amp;A</h2>
      <p className="app-muted">
        Track manual questions from kickoff weekend and record the ruling once it lands. Cite the official manual or
        FIRST Q&amp;A only.
      </p>

      {sorted.length === 0 ? (
        <EmptyState
          soft
          title={`No rules questions for ${seasonYear}`}
          description="Add real open questions from kickoff — empty stays empty until the team asks."
        />
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
                          {
                            action: "update_rule_note",
                            orgId,
                            id: note.id,
                            status: note.status === "answered" ? "open" : "answered",
                          },
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
        <Button variant="secondary" type="submit" disabled={busy || !question.trim()}>
          Add question
        </Button>
      </form>
    </section>
  );
}
