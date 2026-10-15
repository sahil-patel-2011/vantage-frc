"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, EmptyState, PageHeader, Skeleton, TextBlockSkeleton } from "../../../../components/ui";
import { withOrgHref } from "../../../../lib/nav/product-nav";
import { publicLessonBody } from "../../../../lib/team-lessons/body";
import type { LessonAttempt, LessonBody, LessonDetailView, PublicLessonBody } from "../../../../lib/team-lessons/types";
import {
  lessonEditHref,
  lessonFetch,
  LessonLoadError,
  LessonLoading,
  LessonOrgProblem,
  lessonsHref,
  StepView,
  useLessonOrg,
  whenText,
  type LessonLoadFailure,
} from "../lesson-shared";
import { LessonPdf } from "./lesson-pdf";
import { LessonPractice } from "./lesson-practice";

type Ready = Extract<LessonDetailView, { status: "ready" }>;

/** What the student sees, whoever is looking: editors get the same view, answers removed. */
function studentBody(view: Ready): PublicLessonBody {
  return view.lesson.editor ? publicLessonBody(view.lesson.body as LessonBody) : (view.lesson.body as PublicLessonBody);
}

export function LessonPlayer({ lessonId }: { lessonId: string }) {
  const org = useLessonOrg();
  const orgId = org.status === "ready" ? org.orgId : null;
  const [view, setView] = useState<LessonDetailView | null>(null);
  const [error, setError] = useState<LessonLoadFailure | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<"steps" | "practice">("steps");
  const [attempts, setAttempts] = useState<LessonAttempt[]>([]);
  const topRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setError(null);
    const result = await lessonFetch<LessonDetailView>(`/api/team-lessons/${lessonId}?orgId=${encodeURIComponent(orgId)}`);
    if (result.ok && result.data) {
      setView(result.data);
      if (result.data.status === "ready") setAttempts(result.data.attempts);
    } else {
      setError({
        status: result.status,
        message: result.error ?? (result.status === 0 ? "Couldn't reach Vantage. Check your connection." : "This lesson could not be loaded."),
      });
    }
  }, [lessonId, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const crumbs = (title?: string) => (
    <>
      <a href={withOrgHref("/learn", orgId)}>Learn</a> / <a href={lessonsHref(orgId)}>Team resources</a>
      {title ? ` / ${title}` : ""}
    </>
  );

  if (org.status === "none" || org.status === "signed-out" || org.status === "error") {
    return (
      <main className="module-page team-lessons-page">
        <PageHeader breadcrumbs={crumbs()} title="Team lesson" />
        <LessonOrgProblem org={org} chooseText="This lesson belongs to a team. Choose yours to open it." />
      </main>
    );
  }

  if (!view || view.status !== "ready") {
    return (
      <main className="module-page team-lessons-page">
        <PageHeader breadcrumbs={crumbs()} title="Team lesson" />
        {view?.status === "setup_required" ? (
          <EmptyState soft badge="Needs setup" badgeTone="setup" title="Team resources aren't ready yet" description={view.message} />
        ) : error ? (
          <LessonLoadError
            error={error}
            title="Couldn't open this lesson"
            onRetry={() => void load()}
            back={{ href: lessonsHref(orgId), label: "Back to Team resources" }}
          />
        ) : (
          <LessonLoading label="Opening the lesson">
            <Skeleton width="40%" height={14} />
            <Skeleton width="70%" height={26} />
            <TextBlockSkeleton lines={5} />
          </LessonLoading>
        )}
      </main>
    );
  }

  const { lesson } = view;
  const body = studentBody(view);
  const usesPdf = lesson.source === "pdf";
  const steps = usesPdf ? [] : body.steps;
  const questions = body.practice;
  const step = steps[Math.min(stepIndex, Math.max(0, steps.length - 1))];
  const onLastStep = stepIndex >= steps.length - 1;
  const meta = [
    lesson.minutes ? `About ${lesson.minutes} min` : null,
    lesson.audience.trim() ? `For ${lesson.audience.trim()}` : null,
    lesson.createdByName ? `By ${lesson.createdByName}` : null,
    lesson.publishedAt ? `Published ${whenText(lesson.publishedAt)}` : null,
  ].filter(Boolean);

  function go(index: number) {
    setStepIndex(index);
    setPhase("steps");
    topRef.current?.scrollIntoView({ block: "start" });
  }

  function toPractice() {
    setPhase("practice");
    topRef.current?.scrollIntoView({ block: "start" });
  }

  return (
    <main className="module-page team-lessons-page team-lesson-player">
      <PageHeader breadcrumbs={crumbs(lesson.title)} title={lesson.title} description={lesson.summary.trim() || undefined}>
        {lesson.editor ? (
          <Button as="a" variant="secondary" href={lessonEditHref(lesson.id, orgId)}>
            Edit lesson
          </Button>
        ) : null}
      </PageHeader>
      {meta.length ? <p className="team-lesson-meta">{meta.join(" · ")}</p> : null}
      {lesson.status !== "published" ? (
        <p className="team-lesson-banner" role="note">
          {lesson.status === "archived" ? "This lesson is archived" : "This is a draft"}. Only its author and your team&apos;s owners
          and admins can see it. Practice answers aren&apos;t saved until it is published.
        </p>
      ) : null}

      <div ref={topRef} className="team-lesson-anchor" />

      {usesPdf ? (
        lesson.pdfFileId && orgId ? (
          <LessonPdf orgId={orgId} fileId={lesson.pdfFileId} fileName={lesson.pdfFileName} />
        ) : (
          <EmptyState soft title="The PDF is missing" description="The file for this lesson was removed from the team's Files. Ask the author to upload it again." />
        )
      ) : null}

      {!usesPdf && steps.length > 1 ? (
        <nav className="team-lesson-outline" aria-label="Steps">
          <ol>
            {steps.map((entry, index) => (
              <li key={entry.id}>
                <button
                  type="button"
                  aria-current={phase === "steps" && index === stepIndex ? "step" : undefined}
                  onClick={() => go(index)}
                >
                  <b aria-hidden="true">{index + 1}</b>
                  <span>{entry.title.trim() || `Step ${index + 1}`}</span>
                </button>
              </li>
            ))}
            {questions.length ? (
              <li>
                <button type="button" aria-current={phase === "practice" ? "step" : undefined} onClick={toPractice}>
                  <b aria-hidden="true">✓</b>
                  <span>Practice</span>
                </button>
              </li>
            ) : null}
          </ol>
        </nav>
      ) : null}

      {!usesPdf && phase === "steps" && step ? (
        <>
          <div className="guided-progress" aria-hidden="true">
            <span className="guided-bar">
              <i style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} />
            </span>
          </div>
          <StepView step={step} number={stepIndex + 1} total={steps.length} />
          <div className="team-lesson-actions is-split">
            <Button variant="secondary" disabled={stepIndex === 0} onClick={() => go(stepIndex - 1)}>
              Back
            </Button>
            {onLastStep ? (
              questions.length ? (
                <Button variant="primary" onClick={toPractice}>
                  Go to practice
                </Button>
              ) : (
                <span className="team-lesson-done">That&apos;s the whole lesson.</span>
              )
            ) : (
              <Button variant="primary" onClick={() => go(stepIndex + 1)}>
                Next
              </Button>
            )}
          </div>
        </>
      ) : null}

      {!usesPdf && steps.length === 0 && !questions.length ? (
        <EmptyState soft title="This lesson is empty" description="It has no steps or practice questions yet." />
      ) : null}

      {questions.length && orgId && (usesPdf || phase === "practice" || steps.length === 0) ? (
        <>
          <LessonPractice
            key={lesson.version}
            lessonId={lesson.id}
            orgId={orgId}
            questions={questions}
            previewOnly={lesson.status !== "published"}
            attempts={attempts}
            onAttempt={(attempt) => setAttempts((prev) => [attempt, ...prev])}
          />
          {!usesPdf && steps.length ? (
            <div className="team-lesson-actions">
              <Button variant="secondary" onClick={() => go(steps.length - 1)}>
                Back to the steps
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
