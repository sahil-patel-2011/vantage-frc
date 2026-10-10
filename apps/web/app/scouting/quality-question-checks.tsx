"use client";

import { useState } from "react";
import type { FieldTrustSummary } from "@vantage/scouting/trust";
import { Button } from "../../components/ui";

type QuestionCheck = FieldTrustSummary & {
  schemaId: string | null; label: string; formTitle: string | null; year: number | null; version: number | null;
};

export function QualityQuestionChecks({ questions }: { questions: readonly QuestionCheck[] }) {
  const [limit, setLimit] = useState(20);
  if (!questions.length) return <p className="app-muted">No comparable question checks with original forms are available yet. Missing observations remain unknown.</p>;
  return <>
    <div className="field-trust-list">{questions.slice(0, limit).map(question => <article key={`${question.schemaId ?? "legacy"}:${question.fieldKey}`}>
      <div>
        <strong>{question.label}</strong>
        <small className="app-muted">{question.formTitle ? `${question.formTitle} · ${question.year} · version ${question.version}`
          : "Original form details unavailable; refresh to check this question."}</small>
        <span>{question.matches} agree · {question.conflicts} conflict · {question.checks} checks</span>
      </div>
      <b>{question.confidenceScore == null ? "No checks" : `${Math.round(question.confidenceScore * 100)}%`}<small>agreement</small></b>
    </article>)}</div>
    {questions.length > limit ? <div className="scout-quality-more"><span className="app-muted">{limit} of {questions.length} question versions</span>
      <Button type="button" variant="secondary" onClick={() => setLimit(current => current + 20)}>Show {Math.min(20, questions.length - limit)} more</Button>
    </div> : null}
  </>;
}
