"use client";

import { useId, useRef, useState } from "react";
import type { FieldTrustSummary } from "@vantage/scouting/trust";
import { Button } from "../../components/ui";
import { useExitPresence } from "../../components/ui/use-exit-presence";
import { QualityQuestionReports } from "./quality-question-reports";

type QuestionCheck = FieldTrustSummary & {
  schemaId: string | null; label: string; formTitle: string | null; year: number | null; version: number | null;
};

export function QualityQuestionChecks({ questions, orgId, eventKey }: { questions: readonly QuestionCheck[]; orgId: string; eventKey: string }) {
  const [limit, setLimit] = useState(20);
  const [open, setOpen] = useState<string | null>(null);
  if (!questions.length) return <p className="app-muted">No comparable question checks with original forms are available yet. Missing observations remain unknown.</p>;
  return <>
    <div className="field-trust-list">{questions.slice(0, limit).map(question => {
      const key = `${question.schemaId ?? "legacy"}:${question.fieldKey}`;
      return <QuestionRow key={key} question={question} orgId={orgId} eventKey={eventKey} open={open === key} onToggle={() => setOpen(current => current === key ? null : key)} />;
    })}</div>
    {questions.length > limit ? <div className="scout-quality-more"><span className="app-muted">{limit} of {questions.length} question versions</span>
      <Button type="button" variant="secondary" onClick={() => setLimit(current => current + 20)}>Show {Math.min(20, questions.length - limit)} more</Button>
    </div> : null}
  </>;
}

function QuestionSummary({ question, open }: { question: QuestionCheck; open: boolean }) {
  return <><div><strong>{question.label}</strong>
    <small className="app-muted">{question.formTitle ? `${question.formTitle} · ${question.year} · version ${question.version}` : "Original form details unavailable; refresh to check this question."}</small>
    <span>{question.matches} agree · {question.conflicts} conflict · {question.checks} checks{question.schemaId ? open ? " · Hide reports" : " · Review reports" : ""}</span>
  </div><b>{question.confidenceScore == null ? "No checks" : `${Math.round(question.confidenceScore * 100)}%`}<small>agreement</small></b></>;
}

function QuestionRow({ question, orgId, eventKey, open, onToggle }: {
  question: QuestionCheck; orgId: string; eventKey: string; open: boolean; onToggle: () => void;
}) {
  const id = useId();
  const presence = useExitPresence(open);
  const control = useRef<HTMLButtonElement | null>(null);
  return <article className="scout-quality-question">
    {question.schemaId ? <button ref={control} type="button" className="scout-quality-question-control" aria-expanded={open} aria-controls={presence.present ? id : undefined} onClick={onToggle}
      aria-label={`${open ? "Hide" : "Review"} reports for ${question.label}, ${question.formTitle}, version ${question.version}: ${question.checks} checks, ${question.conflicts} needing review`}>
      <QuestionSummary question={question} open={open} />
    </button> : <div className="scout-quality-question-control"><QuestionSummary question={question} open={false} /></div>}
    {question.schemaId && presence.present ? <div id={id} className="scout-quality-report-disclosure" data-closing={presence.closing || undefined} aria-hidden={presence.closing || undefined} inert={presence.closing}
      onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); control.current?.focus(); onToggle(); } }}>
      <QualityQuestionReports scope={{ orgId, eventKey, schemaId: question.schemaId, fieldKey: question.fieldKey }} hasConflicts={question.conflicts > 0} active={open} />
    </div> : null}
  </article>;
}
