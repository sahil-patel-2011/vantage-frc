"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ActionMenu, askConfirm, Button, CardGridSkeleton, EmptyState, PageHeader, Modal } from "../../../components/ui";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { discardDraftBody, splitDrafts } from "../../../lib/team-lessons/list";
import type { LessonSummary, LessonsListView } from "../../../lib/team-lessons/types";
import { looksLikePdf, uploadLessonPdf, type PdfUploadProgress } from "./[id]/edit/lesson-pdf-upload";
import {
  lessonEditHref,
  lessonFetch,
  lessonHref,
  LessonLoadError,
  LessonLoading,
  LessonOrgProblem,
  useLessonOrg,
  whenText,
  type LessonLoadFailure,
} from "./lesson-shared";

const DESCRIPTION =
  "Lessons your team wrote: one step at a time, ending in practice questions Vantage checks for you.";

type NewKind = "editor" | "pdf";

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
      {/* Plain text: the button below is the one way into the lesson. */}
      <h3>{lesson.title}</h3>
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

function DraftRow({
  lesson,
  orgId,
  discarding,
  onDiscard,
}: {
  lesson: LessonSummary;
  orgId: string;
  discarding: boolean;
  onDiscard: (lesson: LessonSummary) => void;
}) {
  const empty = lesson.source === "editor" && !lesson.stepCount && !lesson.questionCount;
  return (
    <li className="team-lesson-draft">
      <div>
        <strong className="team-lesson-draft-title">{lesson.title}</strong>
        <span className="app-muted">
          {lesson.status === "archived" ? "Archived" : empty ? "Draft · nothing written yet" : "Draft"}
          {lesson.createdByName ? ` · by ${lesson.createdByName}` : ""} · changed {whenText(lesson.updatedAt)}
        </span>
      </div>
      {/* The way in is the row's one button; discarding lives behind More, red, and asks first
          (onDiscard opens the confirmation), instead of a red button under Edit on every row. */}
      <ActionMenu
        className="team-lesson-draft-actions"
        tone="row"
        label={`${lesson.title} lesson`}
        triggerTestId={`lesson-more:${lesson.id}`}
        actions={[
          lesson.canEdit
            ? { id: "edit", label: "Edit", href: lessonEditHref(lesson.id, orgId), intent: "primary" as const }
            : { id: "open", label: "Open", href: lessonHref(lesson.id, orgId), intent: "primary" as const },
          // Only the author of a draft, or an owner or admin, may delete it (the API checks too).
          ...(lesson.status === "draft" && lesson.canDelete
            ? [{
                id: "discard",
                label: discarding ? "Discarding…" : "Discard draft",
                intent: "destructive" as const,
                confirmsItself: true,
                disabled: discarding,
                onClick: () => onDiscard(lesson),
              }]
            : []),
        ]}
      />
    </li>
  );
}

export function TeamLessonsClient() {
  const org = useLessonOrg();
  const orgId = org.status === "ready" ? org.orgId : null;
  const [view, setView] = useState<LessonsListView | null>(null);
  const [error, setError] = useState<LessonLoadFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The "New lesson" / "Upload a PDF lesson" dialog. Nothing is created until it is submitted
  // with a title (and, for a PDF lesson, the file uploaded), so no empty "Untitled" drafts.
  const [newLesson, setNewLesson] = useState<NewKind | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [formProblem, setFormProblem] = useState<{ field: "title" | "file" | null; message: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [upload, setUpload] = useState<PdfUploadProgress | null>(null);
  const [discarding, setDiscarding] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setError(null);
    const result = await lessonFetch<LessonsListView>(`/api/team-lessons?orgId=${encodeURIComponent(orgId)}`);
    if (result.ok && result.data) setView(result.data);
    else {
      setError({
        status: result.status,
        message: result.error ?? (result.status === 0 ? "Couldn't reach Vantage. Check your connection." : "Team resources could not be loaded."),
      });
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  function openNew(kind: NewKind) {
    setNewTitle("");
    setNewFile(null);
    setFormProblem(null);
    setNotice(null);
    setNewLesson(kind);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!orgId || !newLesson || creating) return;
    const title = newTitle.trim();
    if (!title) return setFormProblem({ field: "title", message: "Give the lesson a title." });
    if (newLesson === "pdf" && !newFile) return setFormProblem({ field: "file", message: "Choose the PDF file." });
    if (newLesson === "pdf" && newFile && !looksLikePdf(newFile)) return setFormProblem({ field: "file", message: "Choose a PDF file (.pdf)." });
    setFormProblem(null);
    setCreating(true);

    let pdfFileId: string | undefined;
    if (newLesson === "pdf" && newFile) {
      const uploaded = await uploadLessonPdf({ file: newFile, orgId, onProgress: setUpload });
      if ("error" in uploaded) {
        setUpload(null);
        setCreating(false);
        return setFormProblem({ field: "file", message: uploaded.error });
      }
      pdfFileId = uploaded.fileId;
      setUpload({ label: "Making the lesson…", fraction: 1 });
    }

    const result = await lessonFetch<{ id: string }>("/api/team-lessons", {
      method: "POST",
      body: JSON.stringify(pdfFileId ? { orgId, title, pdfFileId } : { orgId, title }),
    });
    if (result.ok && result.data?.id) {
      window.location.assign(lessonEditHref(result.data.id, orgId));
      return;
    }
    setUpload(null);
    setCreating(false);
    setFormProblem({
      field: null,
      message:
        (result.error ?? "The lesson could not be created. Try again.") +
        (pdfFileId ? " The PDF is already in your team's Files, in the Team lessons folder." : ""),
    });
  }

  async function discard(lesson: LessonSummary) {
    if (!orgId || discarding) return;
    const ok = await askConfirm({
      title: `Discard “${lesson.title}”?`,
      body: discardDraftBody(lesson),
      confirmLabel: "Discard draft",
    });
    if (!ok) return;
    setDiscarding(lesson.id);
    setNotice(null);
    const result = await lessonFetch<{ deleted: boolean }>(`/api/team-lessons/${lesson.id}?orgId=${encodeURIComponent(orgId)}`, {
      method: "DELETE",
    });
    setDiscarding(null);
    if (result.ok) {
      setView((current) => (current?.status === "ready" ? { ...current, drafts: current.drafts.filter((entry) => entry.id !== lesson.id) } : current));
    } else setNotice(result.error ?? "The draft couldn't be discarded. Try again.");
  }

  const header = (actions?: ReactNode) => (
    <PageHeader breadcrumbs={<Breadcrumbs orgId={orgId} />} title="Team resources" description={DESCRIPTION}>
      {actions}
    </PageHeader>
  );

  const orgProblem = <LessonOrgProblem org={org} chooseText="Team resources belong to a team. Choose yours to see them." />;
  if (org.status === "none" || org.status === "signed-out" || org.status === "error") {
    return (
      <main className="module-page team-lessons-page">
        {header()}
        {orgProblem}
      </main>
    );
  }

  // Finding the team and loading the list are one loading moment: skeleton cards, with the
  // words for screen readers only.
  if (!view) {
    return (
      <main className="module-page team-lessons-page">
        {header()}
        {error ? (
          <LessonLoadError
            error={error}
            title="Couldn't load lessons"
            onRetry={() => void load()}
            back={{ href: "/workspace", label: "Choose your team" }}
          />
        ) : (
          <LessonLoading label="Loading your team's lessons">
            <CardGridSkeleton cols={2} rows={2} />
          </LessonLoading>
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
  const drafts = splitDrafts(view.drafts);
  // One primary (write a lesson) and one secondary (upload a PDF): the only two ways to start a
  // lesson. The empty state carries the same two choices when there is nothing yet.
  const newButtons =
    view.canCreate && hasAny ? (
      <>
        <Button variant="secondary" onClick={() => openNew("pdf")}>
          Upload a PDF
        </Button>
        <Button variant="primary" onClick={() => openNew("editor")}>
          New lesson
        </Button>
      </>
    ) : undefined;

  const draftRow = (lesson: LessonSummary) => (
    <DraftRow key={lesson.id} lesson={lesson} orgId={view.orgId} discarding={discarding === lesson.id} onDiscard={(entry) => void discard(entry)} />
  );

  return (
    <main className="module-page team-lessons-page">
      {header(newButtons)}
      <Modal
        open={newLesson !== null}
        onClose={() => {
          if (!creating) setNewLesson(null);
        }}
        title={newLesson === "pdf" ? "Upload a PDF lesson" : "New lesson"}
      >
        <form className="team-lesson-new-form" noValidate onSubmit={(event) => void create(event)}>
          <p className="app-muted">
            {newLesson === "pdf"
              ? "Name the lesson and choose the PDF. It is saved in your team's Files (Team lessons folder); next you add practice questions."
              : "Name your lesson to start writing. Nothing is created until you continue."}
          </p>
          <label className="team-lesson-field">
            <span>Lesson title</span>
            <input
              data-autofocus
              className="team-lesson-input"
              value={newTitle}
              maxLength={160}
              disabled={creating}
              aria-invalid={formProblem?.field === "title" ? true : undefined}
              aria-describedby={formProblem?.field === "title" ? "team-lesson-new-problem" : undefined}
              onChange={(event) => {
                setNewTitle(event.target.value);
                if (formProblem?.field === "title") setFormProblem(null);
              }}
              placeholder="e.g. Wiring a motor controller"
            />
          </label>
          {newLesson === "pdf" ? (
            <label className="team-lesson-field">
              <span>PDF file</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={creating}
                aria-invalid={formProblem?.field === "file" ? true : undefined}
                aria-describedby={formProblem?.field === "file" ? "team-lesson-new-problem" : undefined}
                onChange={(event) => {
                  setNewFile(event.target.files?.[0] ?? null);
                  if (formProblem?.field === "file") setFormProblem(null);
                }}
              />
            </label>
          ) : null}
          {formProblem ? (
            <p id="team-lesson-new-problem" className="team-lesson-field-problem" role="alert">
              {formProblem.message}
            </p>
          ) : null}
          {upload ? (
            <div className="guided-progress" role="status" aria-live="polite">
              <span>{upload.label}</span>
              {upload.fraction !== null ? (
                <span className="guided-bar" aria-hidden="true">
                  <i style={{ width: `${Math.round(upload.fraction * 100)}%` }} />
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="team-lesson-card-actions">
            <Button variant="secondary" type="button" disabled={creating} onClick={() => setNewLesson(null)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={creating}>
              {creating ? (newLesson === "pdf" ? "Uploading…" : "Creating…") : newLesson === "pdf" ? "Upload and continue" : "Start writing"}
            </Button>
          </div>
        </form>
      </Modal>
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
              <Button variant="primary" onClick={() => openNew("editor")}>
                Write a lesson
              </Button>
              <Button variant="secondary" onClick={() => openNew("pdf")}>
                Upload a PDF
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
          {drafts.current.length ? <ul className="team-lesson-drafts">{drafts.current.map(draftRow)}</ul> : null}
          {drafts.old.length ? (
            <details className="team-lesson-old-drafts">
              <summary data-disclosure>Old drafts ({drafts.old.length})</summary>
              <p className="app-muted">Empty drafts nobody has changed for a month. Discard the ones you don&apos;t need.</p>
              <ul className="team-lesson-drafts">{drafts.old.map(draftRow)}</ul>
            </details>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
