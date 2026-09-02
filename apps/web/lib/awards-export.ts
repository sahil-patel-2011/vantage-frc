// Award submission export — pure, framework-free. Turns an award_submissions row plus its
// award_items into (a) per-question plain text a team can paste straight into the FIRST
// submission portal and (b) a JSON bundle (metadata + answers) for their own records.
// Nothing here invents content: an unanswered prompt exports as "(no answer drafted yet)".

export type AwardExportSubmission = {
  id: string;
  seasonYear: number;
  eventKey: string | null;
  awardType: string;
  title: string | null;
  status: string;
  priority: string;
  deadline: string | null;
  summary: string | null;
  createdAt: string | null;
};

export type AwardExportItem = {
  id: string;
  kind: string;
  prompt: string | null;
  content: string | null;
  charLimit: number | null;
  done: boolean;
  sortOrder: number;
};

export type AwardAnswerExport = {
  itemId: string;
  /** 1-based question number in sort order. */
  index: number;
  kind: string;
  prompt: string;
  content: string;
  characterCount: number;
  charLimit: number | null;
  overLimit: boolean;
  done: boolean;
  /** The per-question plain text block. */
  text: string;
};

export type AwardExportBundle = {
  format: "vantage-award-export";
  version: 1;
  exportedAt: string;
  submission: AwardExportSubmission & { awardName: string };
  answers: AwardAnswerExport[];
  totals: { questions: number; answered: number; characters: number };
};

export type AwardExport = {
  /** Every answer as one plain-text document (header + numbered questions). */
  text: string;
  bundle: AwardExportBundle;
  answers: AwardAnswerExport[];
  /** Safe file stem, e.g. `impact-award-2026`. */
  fileStem: string;
};

export const NO_ANSWER_PLACEHOLDER = "(no answer drafted yet)";

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

export function slugForFile(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "award";
}

/** Plain text for ONE question: the prompt as a heading, then the drafted answer. */
export function answerText(input: { index: number; prompt: string | null; content: string | null; kind?: string }): string {
  const prompt = normalizeText(input.prompt) || `${input.kind ?? "essay"} ${input.index}`;
  const content = normalizeText(input.content) || NO_ANSWER_PLACEHOLDER;
  return `Q${input.index}. ${prompt}\n\n${content}`;
}

export function buildAwardExport(
  submission: AwardExportSubmission,
  items: readonly AwardExportItem[],
  options: { awardName?: string | null; exportedAt?: string } = {},
): AwardExport {
  const awardName = options.awardName?.trim() || submission.title?.trim() || submission.awardType;
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const ordered = [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

  const answers: AwardAnswerExport[] = ordered.map((item, position) => {
    const index = position + 1;
    const prompt = normalizeText(item.prompt) || `${item.kind} ${index}`;
    const content = normalizeText(item.content);
    const characterCount = content.length;
    return {
      itemId: item.id,
      index,
      kind: item.kind,
      prompt,
      content,
      characterCount,
      charLimit: item.charLimit,
      overLimit: item.charLimit != null && item.charLimit > 0 && characterCount > item.charLimit,
      done: item.done,
      text: answerText({ index, prompt: item.prompt, content: item.content, kind: item.kind }),
    };
  });

  const header = [
    `${awardName} — ${submission.seasonYear}`,
    [
      `Status: ${submission.status.replace(/_/g, " ")}`,
      submission.eventKey ? `Event: ${submission.eventKey}` : null,
      submission.deadline ? `Deadline: ${submission.deadline}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    normalizeText(submission.summary) ? `\n${normalizeText(submission.summary)}` : null,
  ]
    .filter((line): line is string => line != null)
    .join("\n");

  const text = [header, ...answers.map((answer) => answer.text)].join("\n\n---\n\n") + "\n";
  const answered = answers.filter((answer) => answer.content.length > 0).length;

  return {
    text,
    answers,
    fileStem: `${slugForFile(awardName)}-${submission.seasonYear}`,
    bundle: {
      format: "vantage-award-export",
      version: 1,
      exportedAt,
      submission: { ...submission, awardName },
      answers,
      totals: {
        questions: answers.length,
        answered,
        characters: answers.reduce((sum, answer) => sum + answer.characterCount, 0),
      },
    },
  };
}
