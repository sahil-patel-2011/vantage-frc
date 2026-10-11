/**
 * Team lessons: step-by-step modules a team writes (or uploads as a PDF), ending in practice
 * questions that the server checks. Stored as `team_lessons.body` (migration 0717).
 *
 * Client-safe: types and limits only.
 */

export const LESSON_LIMITS = {
  title: 160,
  summary: 600,
  audience: 120,
  minutesMin: 1,
  minutesMax: 600,
  steps: 40,
  stepTitle: 160,
  stepText: 8000,
  stepExample: 4000,
  stepWhenToUse: 1000,
  questions: 20,
  prompt: 1000,
  optionsMin: 2,
  optionsMax: 6,
  option: 300,
  accepted: 10,
  acceptedText: 200,
  unit: 24,
  id: 40,
  /** Largest absolute value a number answer or tolerance may hold. */
  numberMagnitude: 1e12,
  /** What one practice answer may be, as text. */
  answerText: 200,
} as const;

export const DEFAULT_LESSON_TITLE = "Untitled lesson";

export type LessonStatus = "draft" | "published" | "archived";
export type LessonSource = "editor" | "pdf";
export type LessonRole = "owner" | "admin" | "scout" | "viewer";

export type LessonStep = {
  id: string;
  title: string;
  /** Markdown, rendered by the team wiki's renderer. */
  text: string;
  example?: string;
  whenToUse?: string;
};

export type ChoiceQuestion = {
  id: string;
  kind: "choice";
  prompt: string;
  options: string[];
  /** Index into options. */
  answer: number;
};

export type NumberQuestion = {
  id: string;
  kind: "number";
  prompt: string;
  /** Null only while a draft is being written; publishing requires a number. */
  answer: number | null;
  tolerance: number;
  unit?: string;
};

export type TextQuestion = {
  id: string;
  kind: "text";
  prompt: string;
  /** Matched ignoring case and extra spaces. */
  accepted: string[];
};

export type PracticeQuestion = ChoiceQuestion | NumberQuestion | TextQuestion;
export type QuestionKind = PracticeQuestion["kind"];

export type LessonBody = {
  steps: LessonStep[];
  practice: PracticeQuestion[];
};

/** What someone who cannot edit the lesson receives: no answers, no tolerances. */
export type PublicQuestion =
  | { id: string; kind: "choice"; prompt: string; options: string[] }
  | { id: string; kind: "number"; prompt: string; unit?: string }
  | { id: string; kind: "text"; prompt: string };

export type PublicLessonBody = {
  steps: LessonStep[];
  practice: PublicQuestion[];
};

/** Choice: the option index. Number: a number or the typed text. Text: the typed text. */
export type PracticeAnswers = Record<string, number | string>;

export type QuestionResult = { id: string; correct: boolean; feedback: string };

export type PracticeResult = {
  results: QuestionResult[];
  score: number;
  total: number;
  passed: boolean;
  /** How many correct answers pass this lesson. */
  passMark: number;
};

export type LessonMeta = {
  title: string;
  summary: string;
  audience: string;
  minutes: number | null;
};

/** One row of the list page. */
export type LessonSummary = {
  id: string;
  title: string;
  summary: string;
  audience: string;
  minutes: number | null;
  status: LessonStatus;
  source: LessonSource;
  stepCount: number;
  questionCount: number;
  createdBy: string;
  createdByName: string | null;
  updatedAt: string;
  publishedAt: string | null;
  canEdit: boolean;
  best: { score: number; total: number; passed: boolean; at: string } | null;
};

export type LessonsListView =
  | {
      status: "ready";
      orgId: string;
      role: LessonRole;
      canCreate: boolean;
      canManage: boolean;
      published: LessonSummary[];
      /** Drafts and archived lessons this person can see (their own, or all for owners/admins). */
      drafts: LessonSummary[];
    }
  | { status: "setup_required"; message: string };

export type LessonRevisionSummary = {
  id: string;
  version: number;
  title: string;
  savedAt: string;
  savedByName: string | null;
};

export type LessonAttempt = {
  id: string;
  score: number;
  total: number;
  passed: boolean;
  createdAt: string;
};

export type LessonDetail = {
  id: string;
  orgId: string;
  title: string;
  summary: string;
  audience: string;
  minutes: number | null;
  status: LessonStatus;
  source: LessonSource;
  pdfFileId: string | null;
  pdfFileName: string | null;
  version: number;
  createdBy: string;
  createdByName: string | null;
  updatedAt: string;
  updatedByName: string | null;
  publishedAt: string | null;
  /** Full body (with answers) for editors; the public body for everyone else. */
  body: LessonBody | PublicLessonBody;
  editor: boolean;
  canPublish: boolean;
  canChangeStatus: boolean;
  canDelete: boolean;
};

export type LessonDetailView =
  | {
      status: "ready";
      role: LessonRole;
      lesson: LessonDetail;
      attempts: LessonAttempt[];
      revisions: LessonRevisionSummary[];
    }
  | { status: "setup_required"; message: string };
