"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, EmptyState, PageHeader } from "../../../components/ui";
import { withOrgHref } from "../../../lib/nav/product-nav";
import type { LessonSummary, LessonsListView } from "../../../lib/team-lessons/types";
import { lessonEditHref, lessonFetch, lessonHref, useLessonOrg, whenText } from "./lesson-shared";

const DESCRIPTION =
  "Lessons your team wrote: one step at a time, ending in practice questions Vantage checks for you.";

function Breadcrumbs({ orgId }: { orgId: string | null }) {
  return (
    <>
      <a href={withOrgHref("/learn", orgId)}>Learn</a>
      {" / Team resources"}
    </>
  );
}

function bestText(lesson: LessonSummary): string {
  if (!lesson.questionCount) return "No practice questions";
  if (!lesson.best) return "Not tried yet";
  return `Your best: ${lesson.best.score} of ${lesson.best.total}${lesson.best.passed ? " · Passed" : ""}`;
}

function LessonCard({ lesson, orgId }: { lesson: LessonSummary; orgId: string }) {
  const meta = [
    lesson.source === "pdf" ? "PDF lesson" : `${lesson.stepCount} step${lesson.stepCount === 1 ? "" : "s"}`,
    lesson.minutes ? `${lesson.minutes} min` : null,
    lesson.audience.trim() ? `For ${lesson.audience.trim()}` : null,
  ].filter(Boolean);
  return (
    <li className="team-lesson-card" data-testid="team-lesson-card">
      <h3>
        <a href={lessonHref(lesson.id, orgId)}>{lesson.title}</a>
      </h3>
      {lesson.summary.trim() ? <p className="team-lesson-card-summary">{lesson.summary}</p> : null}
      <p className="team-lesson-card-meta">{meta.join(" · ")}</p>
      <p className="team-lesson-card-meta">
        {lesson.questionCount ? `Practice: ${lesson.questionCount} question${lesson.questionCount === 1 ? "" : "s"}` : null}
        {lesson.questionCount ? " · " : null}
        <span className={lesson.best?.passed ? "team-lesson-passed" : undefined}>{bestText(lesson)}</span>
      </p>
      <div className="team-lesson-card-actions">
        <Button as="a" variant="secondary" size="sm" href={lessonHref(lesson.id, orgId)}>
          {lesson.best ? "Take it again" : "Start lesson"}
        </Button>
        {lesson.canEdit ? (
          <Button as="a" variant="ghost" size="sm" href={lessonEditHref(lesson.id, orgId)}>
            Edit
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function DraftRow({ lesson, orgId }: { lesson: LessonSummary; orgId: string }) {
  return (
    <li className="team-lesson-draft">
      <div>
        <a href={lesson.canEdit ? lessonEditHref(lesson.id, orgId) : lessonHref(lesson.id, orgId)}>{lesson.title}</a>
        <span className="app-muted">
          {lesson.status === "archived" ? "Archived" : "Draft"}
          {lesson.createdByName ? ` · by ${lesson.createdByName}` : ""} · changed {whenText(lesson.updatedAt)}
        </span>
      </div>
      {lesson.canEdit ? (
        <Button as="a" variant="ghost" size="sm" href={lessonEditHref(lesson.id, orgId)}>
          Edit
        </Button>
      ) : null}
    </li>
  );
}

export function TeamLessonsClient() {
  const org = useLessonOrg();
  const orgId = org.status === "ready" ? org.orgId : null;
  const [view, setView] = useState<LessonsListView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<"editor" | "pdf" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setError(null);
    const result = await lessonFetch<LessonsListView>(`/api/team-lessons?orgId=${encodeURIComponent(orgId)}`);
    if (result.ok && result.data) setView(result.data);
    else setError(result.error ?? (result.status === 0 ? "Couldn't reach Vantage. Check your connection." : "Team resources could not be loaded."));
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(start: "editor" | "pdf") {
    if (!orgId || creating) return;
    setCreating(start);
    setNotice(null);
    const result = await lessonFetch<{ id: string }>("/api/team-lessons", {
      method: "POST",
      body: JSON.stringify({ orgId }),
    });
    if (result.ok && result.data?.id) {
      const href = lessonEditHref(result.data.id, orgId);
      window.location.assign(start === "pdf" ? `${href}${href.includes("?") ? "&" : "?"}start=pdf` : href);
      return;
    }
    setCreating(null);
    setNotice(result.error ?? "The lesson could not be created. Try again.");
  }

  const header = (actions?: ReactNode) => (
    <PageHeader breadcrumbs={<Breadcrumbs orgId={orgId} />} title="Team resources" description={DESCRIPTION}>
      {actions}
    </PageHeader>
  );

  if (org.status === "none") {
    return (
      <main className="module-page team-lessons-page">
        {header()}
        <EmptyState soft badge="Needs setup" badgeTone="setup" title="Choose your team" description="Team resources belong to a team. Choose yours to see them.">
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page team-lessons-page">
        {header()}
        {error ? (
          <EmptyState title="Couldn't load lessons" description={error}>
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </EmptyState>
        ) : (
          <EmptyState soft aria-busy title="Loading your team's lessons…" />
        )}
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page team-lessons-page">
        {header()}
        <EmptyState soft badge="Needs setup" badgeTone="setup" title="Team resources aren't ready yet" description={view.message} />
      </main>
    );
  }

  const hasAny = view.published.length + view.drafts.length > 0;
  const newButton =
    view.canCreate && hasAny ? (
      <Button variant="primary" disabled={creating !== null} onClick={() => void create("editor")}>
        {creating === "editor" ? "Creating…" : "New lesson"}
      </Button>
    ) : undefined;

  return (
    <main className="module-page team-lessons-page">
      {header(newButton)}
      {notice ? (
        <p className="team-lesson-notice" role="alert">
          {notice}
        </p>
      ) : null}

      {!hasAny ? (
        view.canCreate ? (
          <EmptyState
            title="No lessons yet"
            description="Make one in two ways. Write it here: one step at a time, each with an optional example and when to use it — Vantage saves as you type. Or upload a PDF your team already has. Either way, finish with practice questions that Vantage checks."
          >
            <div className="team-lesson-empty-actions">
              <Button variant="primary" disabled={creating !== null} onClick={() => void create("editor")}>
                {creating === "editor" ? "Creating…" : "Write a lesson"}
              </Button>
              <Button variant="secondary" disabled={creating !== null} onClick={() => void create("pdf")}>
                {creating === "pdf" ? "Creating…" : "Upload a PDF"}
              </Button>
            </div>
          </EmptyState>
        ) : (
          <EmptyState
            title="No lessons yet"
            description="When someone on your team publishes a lesson, it shows up here. Team owners, admins and team members can write one here or upload a PDF."
          />
        )
      ) : null}

      {view.published.length ? (
        <section className="team-lessons-section" aria-labelledby="team-lessons-published">
          <h2 id="team-lessons-published">Lessons</h2>
          <ul className="team-lesson-grid">
            {view.published.map((lesson) => (
              <LessonCard key={lesson.id} lesson={lesson} orgId={view.orgId} />
            ))}
          </ul>
        </section>
      ) : hasAny ? (
        <p className="app-muted">Nothing is published yet. Publish a draft below when it is ready.</p>
      ) : null}

      {view.drafts.length ? (
        <section className="team-lessons-section" aria-labelledby="team-lessons-drafts">
          <h2 id="team-lessons-drafts">{view.canManage ? "Drafts and archived" : "Your drafts"}</h2>
          <p className="app-muted">
            {view.canManage
              ? "Only owners, admins and each lesson's author see these."
              : "Only you and your team's owners and admins see these until you publish."}
          </p>
          <ul className="team-lesson-drafts">
            {view.drafts.map((lesson) => (
              <DraftRow key={lesson.id} lesson={lesson} orgId={view.orgId} />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
