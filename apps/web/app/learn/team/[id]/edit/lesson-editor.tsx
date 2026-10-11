"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { askConfirm, Button, EmptyState, PageHeader } from "../../../../../components/ui";
import { withOrgHref } from "../../../../../lib/nav/product-nav";
import {
  decodeStoredDraft,
  draftsEqual,
  draftStorageKey,
  saveStatusText,
  type LessonDraft,
  type StoredDraft,
} from "../../../../../lib/team-lessons/autosave";
import { LESSON_LIMITS, type LessonBody, type LessonDetail, type LessonDetailView, type LessonRevisionSummary, type LessonRole } from "../../../../../lib/team-lessons/types";
import { lessonFetch, lessonHref, lessonsHref, useLessonOrg, whenText } from "../../lesson-shared";
import { PdfPanel } from "./editor-pdf";
import { PracticeEditor } from "./editor-practice";
import { StepsEditor } from "./editor-steps";
import { NumberField, TextField } from "./editor-fields";
import { uploadLessonPdf, type PdfUploadProgress } from "./lesson-pdf-upload";
import { clearLocalDraft, useLessonAutosave } from "./use-lesson-autosave";

type Ready = Extract<LessonDetailView, { status: "ready" }>;
type Saved = { version: number; updatedAt: string };

const STATUS_LABEL = { draft: "Draft", published: "Published", archived: "Archived" } as const;

function toDraft(lesson: LessonDetail): LessonDraft {
  return {
    title: lesson.title,
    summary: lesson.summary,
    audience: lesson.audience,
    minutes: lesson.minutes,
    body: lesson.body as LessonBody,
  };
}

function readStoredDraft(lessonId: string): StoredDraft | null {
  try {
    return decodeStoredDraft(window.localStorage.getItem(draftStorageKey(lessonId)), lessonId);
  } catch {
    return null;
  }
}

function EditorBody({ orgId, view, onReload }: { orgId: string; view: Ready; onReload: () => void }) {
  const lesson = view.lesson;
  const role: LessonRole = view.role;
  const [draft, setDraft] = useState<LessonDraft>(() => toDraft(lesson));
  const draftRef = useRef(draft);
  const [status, setStatus] = useState(lesson.status);
  const [source, setSource] = useState(lesson.source);
  const [pdf, setPdf] = useState({ id: lesson.pdfFileId, name: lesson.pdfFileName });
  const [revisions, setRevisions] = useState<LessonRevisionSummary[]>(view.revisions);
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [localOffer, setLocalOffer] = useState<StoredDraft | null>(null);
  const [upload, setUpload] = useState<PdfUploadProgress | null>(null);
  const [pdfFirst, setPdfFirst] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const autosave = useLessonAutosave({ lessonId: lesson.id, orgId, version: lesson.version });
  const { change, flush, reset, currentVersion, setVersion } = autosave;

  const update = useCallback(
    (edit: (current: LessonDraft) => LessonDraft) => {
      const next = edit(draftRef.current);
      draftRef.current = next;
      setDraft(next);
      setProblems([]);
      change(next);
    },
    [change],
  );

  // "Saved 3 minutes ago" keeps moving.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // A copy this browser kept of changes the server never confirmed.
  useEffect(() => {
    const stored = readStoredDraft(lesson.id);
    const serverDraft = toDraft(lesson);
    if (stored && !draftsEqual(stored.draft, serverDraft)) {
      if (stored.baseVersion === lesson.version) {
        update(() => stored.draft);
        setNotice("Restored changes from this browser that hadn't reached Vantage yet. Saving them now.");
      } else setLocalOffer(stored);
    } else if (stored) clearLocalDraft(lesson.id);
    if (new URLSearchParams(window.location.search).get("start") === "pdf" && lesson.source === "editor") setPdfFirst(true);
    // Once, for the lesson as loaded (the editor remounts when the lesson is reloaded).
  }, []);

  async function refreshRevisions() {
    const result = await lessonFetch<LessonDetailView>(`/api/team-lessons/${lesson.id}?orgId=${encodeURIComponent(orgId)}`);
    if (result.ok && result.data?.status === "ready") setRevisions(result.data.revisions);
  }

  /** Saves pending text first; false (with a notice) when that can't happen. */
  async function saveFirst(): Promise<boolean> {
    const saved = await flush();
    if (!saved) setNotice("Your latest changes aren't saved yet. Wait for “Saved”, then try again.");
    return saved;
  }

  async function act<T>(payload: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: (T & { error?: string; problems?: string[] }) | null }> {
    const result = await lessonFetch<T & { error?: string; problems?: string[] }>(`/api/team-lessons/${lesson.id}`, {
      method: "POST",
      body: JSON.stringify({ orgId, ...payload }),
    });
    if (result.status === 409 && payload.action !== "publish") setNotice(result.error ?? "Someone else edited this lesson. Reload to see their changes.");
    return result;
  }

  async function publish() {
    const ok = await askConfirm({
      title: "Publish this lesson?",
      body:
        role === "scout"
          ? "Everyone on your team will be able to take it. After it is published, only a team owner or admin can change it."
          : "Everyone on your team will be able to take it.",
      confirmLabel: "Publish",
      tone: "neutral",
    });
    if (!ok) return;
    setBusy("publish");
    setNotice(null);
    if (!(await saveFirst())) return setBusy(null);
    const result = await act<Saved>({ action: "publish", version: currentVersion() });
    setBusy(null);
    if (result.ok && result.data) {
      reset({ version: result.data.version, draft: draftRef.current });
      window.location.assign(lessonHref(lesson.id, orgId));
      return;
    }
    if (result.status === 422 && result.data?.problems) setProblems(result.data.problems);
    else setNotice(result.data?.error ?? "The lesson couldn't be published. Try again.");
  }

  async function changeStatus(next: "draft" | "archived") {
    if (next === "archived") {
      const ok = await askConfirm({
        title: `Archive “${draft.title}”?`,
        body: "It disappears from the team's lesson list. Practice results are kept, and you can move it back to draft any time.",
        confirmLabel: "Archive lesson",
      });
      if (!ok) return;
    }
    setBusy(next);
    if (!(await saveFirst())) return setBusy(null);
    const result = await act<Saved>({ action: next === "draft" ? "unpublish" : "archive" });
    setBusy(null);
    if (result.ok && result.data) {
      setVersion(result.data.version);
      setStatus(next);
      setNotice(next === "draft" ? "Moved back to draft. Only its author and owners and admins see it now." : "Archived.");
    } else setNotice(result.data?.error ?? "That didn't work. Try again.");
  }

  async function remove() {
    const ok = await askConfirm({
      title: `Delete “${draft.title}”?`,
      body: "The lesson, its history and everyone's practice results are deleted. This can't be undone. A PDF stays in your team's Files.",
      confirmLabel: "Delete lesson",
    });
    if (!ok) return;
    setBusy("delete");
    const result = await lessonFetch<{ deleted: boolean }>(`/api/team-lessons/${lesson.id}?orgId=${encodeURIComponent(orgId)}`, { method: "DELETE" });
    setBusy(null);
    if (result.ok) {
      clearLocalDraft(lesson.id);
      reset({ version: currentVersion(), draft: draftRef.current });
      window.location.assign(lessonsHref(orgId));
    } else setNotice(result.error ?? "The lesson couldn't be deleted. Try again.");
  }

  async function restore(revision: LessonRevisionSummary) {
    const ok = await askConfirm({
      title: `Restore version ${revision.version}?`,
      body: "The title, steps and practice questions go back to how they were then. What is here now is kept in History first, so you can undo this.",
      confirmLabel: `Restore version ${revision.version}`,
      tone: "neutral",
    });
    if (!ok) return;
    setBusy("restore");
    if (!(await saveFirst())) return setBusy(null);
    const result = await act<Saved & { title: string; body: LessonBody }>({ action: "restore", revisionId: revision.id, version: currentVersion() });
    setBusy(null);
    if (result.ok && result.data) {
      const next = { ...draftRef.current, title: result.data.title, body: result.data.body };
      draftRef.current = next;
      setDraft(next);
      reset({ version: result.data.version, draft: next });
      setNotice(`Restored version ${revision.version}.`);
      void refreshRevisions();
    } else setNotice(result.data?.error ?? "That version couldn't be restored.");
  }

  async function attachPdf(file: File) {
    setNotice(null);
    setUpload({ label: "Saving your changes first…", fraction: null });
    if (!(await saveFirst())) return setUpload(null);
    const uploaded = await uploadLessonPdf({ file, orgId, lessonId: lesson.id, onProgress: setUpload });
    if ("error" in uploaded) {
      setUpload(null);
      setNotice(uploaded.error);
      return;
    }
    setUpload({ label: "Adding it to the lesson…", fraction: 1 });
    const result = await act<Saved & { pdfFileName: string }>({ action: "attach-pdf", fileId: uploaded.fileId, version: currentVersion() });
    setUpload(null);
    if (result.ok && result.data) {
      setVersion(result.data.version);
      setSource("pdf");
      setPdf({ id: uploaded.fileId, name: result.data.pdfFileName });
      setPdfFirst(false);
      setNotice("PDF added. Students read it, then answer the practice questions.");
    } else setNotice(result.data?.error ?? "The PDF uploaded to Files but couldn't be added to the lesson. Try again.");
  }

  async function detachPdf() {
    const ok = await askConfirm({
      title: "Write steps instead?",
      body: "The PDF comes off this lesson but stays in your team's Files. Any steps written earlier come back.",
      confirmLabel: "Use written steps",
      tone: "neutral",
    });
    if (!ok) return;
    setBusy("detach");
    if (!(await saveFirst())) return setBusy(null);
    const result = await act<Saved>({ action: "detach-pdf", version: currentVersion() });
    setBusy(null);
    if (result.ok && result.data) {
      setVersion(result.data.version);
      setSource("editor");
      setPdf({ id: null, name: null });
    } else setNotice(result.data?.error ?? "That didn't work. Try again.");
  }

  async function loadTheirs() {
    const ok = await askConfirm({
      title: "Load their version?",
      body: "Your changes since your last save on this page are replaced by theirs.",
      confirmLabel: "Load their version",
    });
    if (!ok) return;
    clearLocalDraft(lesson.id);
    onReload();
  }

  function applyLocal() {
    if (!localOffer) return;
    update(() => localOffer.draft);
    setLocalOffer(null);
    setNotice("Using the changes kept in this browser. Saving them over the newer version.");
  }

  async function discardLocal() {
    const ok = await askConfirm({
      title: "Discard the unsaved changes?",
      body: "The copy kept in this browser is deleted. The saved lesson stays as it is.",
      confirmLabel: "Discard changes",
    });
    if (!ok) return;
    clearLocalDraft(lesson.id);
    setLocalOffer(null);
  }

  const conflict = autosave.state.kind === "conflict";
  const disabled = busy !== null || conflict;
  const pdfPanel = (
    <PdfPanel
      orgId={orgId}
      source={source}
      pdfFileId={pdf.id}
      pdfFileName={pdf.name}
      progress={upload}
      highlighted={pdfFirst}
      disabled={disabled}
      onFile={(file) => void attachPdf(file)}
      onDetach={() => void detachPdf()}
    />
  );

  return (
    <main className="module-page team-lessons-page team-lesson-editor">
      <PageHeader
        breadcrumbs={
          <>
            <a href={withOrgHref("/learn", orgId)}>Learn</a> / <a href={lessonsHref(orgId)}>Team lessons</a> / Edit
          </>
        }
        title={draft.title.trim() || "Untitled lesson"}
      >
        <Button as="a" variant="secondary" href={lessonHref(lesson.id, orgId)}>
          Preview
        </Button>
      </PageHeader>
      <p className="team-lesson-save-line">
        <span className={`app-badge${status === "published" ? " good" : ""}`}>{STATUS_LABEL[status]}</span>
        <span className="team-lesson-save-status" role="status" aria-live="polite">
          {saveStatusText(autosave.state, now)}
        </span>
      </p>

      {status === "published" ? (
        <p className="team-lesson-banner" role="note">
          This lesson is published. Your changes reach the team as soon as they are saved. To work on it privately, move it
          back to draft first.
        </p>
      ) : null}

      {conflict ? (
        <div className="team-lesson-conflict" role="alert">
          <p>
            <strong>Someone else edited this lesson while you were working.</strong>{" "}
            {autosave.conflict?.updatedByName ? `${autosave.conflict.updatedByName} saved it ${whenText(autosave.conflict.updatedAt)}. ` : ""}
            Your changes are still on this page and in this browser.
          </p>
          <div className="team-lesson-actions">
            <Button variant="secondary" onClick={() => void loadTheirs()}>
              Load their version
            </Button>
            <Button variant="secondary" onClick={autosave.keepMine}>
              Keep my version
            </Button>
          </div>
        </div>
      ) : null}

      {localOffer ? (
        <div className="team-lesson-banner" role="note">
          <p>
            This browser kept changes to this lesson from {whenText(new Date(localOffer.savedAt).toISOString())} that never reached
            Vantage, and the lesson has been saved since.
          </p>
          <div className="team-lesson-actions">
            <Button variant="secondary" onClick={() => void discardLocal()}>
              Discard them
            </Button>
            <Button variant="secondary" onClick={applyLocal}>
              Use them
            </Button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className="team-lesson-notice" role="alert">
          {notice}
        </p>
      ) : null}

      <div className="team-lesson-edit-form" onBlurCapture={() => void flush()}>
        <section className="team-lesson-edit-section" aria-labelledby="team-lesson-about-title">
          <h2 id="team-lesson-about-title">About this lesson</h2>
          <TextField label="Title" value={draft.title} maxLength={LESSON_LIMITS.title} onChange={(title) => update((d) => ({ ...d, title }))} />
          <TextField
            label="Summary"
            optional
            multiline
            value={draft.summary}
            maxLength={LESSON_LIMITS.summary}
            placeholder="What will someone be able to do after this lesson?"
            onChange={(summary) => update((d) => ({ ...d, summary }))}
          />
          <div className="team-lesson-field-row">
            <TextField
              label="Who it's for"
              optional
              value={draft.audience}
              maxLength={LESSON_LIMITS.audience}
              placeholder="New programmers, pit crew, everyone"
              onChange={(audience) => update((d) => ({ ...d, audience }))}
            />
            <NumberField
              label="Minutes it takes (optional)"
              value={draft.minutes}
              integer
              min={LESSON_LIMITS.minutesMin}
              max={LESSON_LIMITS.minutesMax}
              hint={`Use a whole number from ${LESSON_LIMITS.minutesMin} to ${LESSON_LIMITS.minutesMax}.`}
              onChange={(minutes) => update((d) => ({ ...d, minutes }))}
            />
          </div>
        </section>

        {source === "pdf" || pdfFirst ? pdfPanel : null}
        {source === "editor" ? (
          <StepsEditor steps={draft.body.steps} onChange={(steps) => update((d) => ({ ...d, body: { ...d.body, steps } }))} />
        ) : null}
        {source === "editor" && !pdfFirst ? pdfPanel : null}
        <PracticeEditor questions={draft.body.practice} onChange={(practice) => update((d) => ({ ...d, body: { ...d.body, practice } }))} />
      </div>

      {problems.length ? (
        <div className="team-lesson-problems" role="alert">
          <p>
            <strong>Finish these before publishing:</strong>
          </p>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="team-lesson-actions is-split team-lesson-footer">
        <Button as="a" variant="secondary" href={lessonsHref(orgId)}>
          Back to lessons
        </Button>
        {lesson.canChangeStatus && status !== "draft" ? (
          <Button variant="secondary" disabled={disabled} onClick={() => void changeStatus("draft")}>
            {busy === "draft" ? "Moving…" : "Move back to draft"}
          </Button>
        ) : null}
        {lesson.canChangeStatus && status !== "archived" ? (
          <Button variant="secondary" disabled={disabled} onClick={() => void changeStatus("archived")}>
            {busy === "archived" ? "Archiving…" : "Archive"}
          </Button>
        ) : null}
        {status !== "published" ? (
          <Button variant="primary" disabled={disabled} onClick={() => void publish()}>
            {busy === "publish" ? "Publishing…" : "Publish"}
          </Button>
        ) : null}
      </div>

      <details className="team-lesson-history">
        <summary data-disclosure>History ({revisions.length})</summary>
        <p className="app-muted">
          Vantage keeps a copy every few minutes while someone writes, and one each time the lesson is published — the newest 50.
        </p>
        {revisions.length ? (
          <ul>
            {revisions.map((revision) => (
              <li key={revision.id}>
                <span>
                  Version {revision.version} · {revision.title} · {whenText(revision.savedAt)}
                  {revision.savedByName ? ` · kept while ${revision.savedByName} was editing` : ""}
                </span>
                <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void restore(revision)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="app-muted">Nothing kept yet. Copies appear as the lesson is edited.</p>
        )}
      </details>

      {lesson.canDelete ? (
        <section className="team-lesson-danger" aria-labelledby="team-lesson-delete-title">
          <h2 id="team-lesson-delete-title">Delete this lesson</h2>
          <p className="app-muted">Removes the lesson, its history and everyone&apos;s practice results.</p>
          <Button variant="danger" disabled={disabled} onClick={() => void remove()}>
            {busy === "delete" ? "Deleting…" : "Delete lesson"}
          </Button>
        </section>
      ) : null}
    </main>
  );
}

export function LessonEditor({ lessonId }: { lessonId: string }) {
  const org = useLessonOrg();
  const orgId = org.status === "ready" ? org.orgId : null;
  const [view, setView] = useState<LessonDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const load = useCallback(async () => {
    if (!orgId) return;
    setError(null);
    const result = await lessonFetch<LessonDetailView>(`/api/team-lessons/${lessonId}?orgId=${encodeURIComponent(orgId)}`);
    if (result.ok && result.data) {
      setView(result.data);
      setGeneration((value) => value + 1);
    } else setError(result.error ?? (result.status === 0 ? "Couldn't reach Vantage. Check your connection." : "This lesson could not be opened."));
  }, [lessonId, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={withOrgHref("/learn", orgId)}>Learn</a> / <a href={lessonsHref(orgId)}>Team lessons</a> / Edit
        </>
      }
      title="Edit lesson"
    />
  );

  if (org.status === "none") {
    return (
      <main className="module-page team-lessons-page">
        {header}
        <EmptyState soft badge="Needs setup" badgeTone="setup" title="Choose your team" description="This lesson belongs to a team. Choose yours to edit it.">
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  if (view?.status === "setup_required") {
    return (
      <main className="module-page team-lessons-page">
        {header}
        <EmptyState soft badge="Needs setup" badgeTone="setup" title="Team lessons aren't ready yet" description={view.message} />
      </main>
    );
  }
  if (!view || !orgId) {
    return (
      <main className="module-page team-lessons-page">
        {header}
        {error ? (
          <EmptyState title="Couldn't open this lesson" description={error}>
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </EmptyState>
        ) : (
          <EmptyState soft aria-busy title="Opening the editor…" />
        )}
      </main>
    );
  }
  if (!view.lesson.editor) {
    return (
      <main className="module-page team-lessons-page">
        {header}
        <EmptyState
          title="You can't edit this lesson"
          description={
            view.role === "viewer"
              ? "View only members can take lessons but not change them."
              : view.lesson.status === "published" && view.lesson.createdBy
                ? "Published lessons are changed by a team owner or admin. Ask one to move it back to draft if it needs fixing."
                : "Only the person who wrote it, or a team owner or admin, can change it."
          }
        >
          <Button as="a" variant="secondary" href={lessonHref(lessonId, orgId)}>
            Open the lesson
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <EditorBody key={generation} orgId={orgId} view={view} onReload={() => void load()} />;
}
