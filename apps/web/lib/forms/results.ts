/**
 * Turning form answers into something a team can act on.
 *
 * Two rules shape this file.
 *
 * 1. Nothing is invented. Every number here is computed from answers that were
 *    actually submitted. When there is not enough data to say something, the
 *    summary says so instead of producing a confident-looking figure. A team
 *    deciding who drives, or whether a student can travel, is making a real
 *    decision about real people.
 * 2. A chart is not an insight. A bar chart of "which subteams interest you"
 *    is only useful once someone says "Programming has two interested students
 *    and four open slots". The reading is the product; the chart is support.
 */

import {
  CHOICE_KINDS,
  NUMERIC_KINDS,
  numericValue,
  optionsFor,
  type FormPurpose,
  type FormQuestion,
  type QuestionKind,
} from "./types";

export type AnswerRow = {
  questionId: string;
  responseId: string;
  valueText: string;
  valueNumber: number | null;
};

export type ChoiceBucket = { label: string; count: number; share: number };

export type QuestionSummary = {
  questionId: string;
  label: string;
  kind: QuestionKind;
  /** Responses that answered this question at all. */
  answered: number;
  /** Responses to the form as a whole, so skips are visible. */
  totalResponses: number;
  /** Populated for choice kinds. Ordered by count, descending. */
  buckets: ChoiceBucket[];
  /** Populated for numeric kinds only, and only from parseable answers. */
  stats: { count: number; min: number; max: number; mean: number; median: number } | null;
  /** Free-text answers, verbatim and untruncated, most recent first. */
  textAnswers: string[];
  /** Plain-language reading, or null when there is nothing honest to say. */
  reading: string | null;
};

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  if (sorted.length % 2 !== 0) return upper;
  return ((sorted[mid - 1] ?? 0) + upper) / 2;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A multi_select answer is stored as one text value; the options a respondent
 * picked are separated by " | " on write. Splitting on write instead of storing
 * a row per option keeps one answer per (response, question), which is what the
 * unique index guarantees.
 */
export const MULTI_SEPARATOR = " | ";

function splitMulti(kind: QuestionKind, raw: string): string[] {
  if (kind !== "multi_select") return [raw];
  return raw.split(MULTI_SEPARATOR).map((part) => part.trim()).filter(Boolean);
}

export function summarizeQuestion(
  question: FormQuestion,
  answers: AnswerRow[],
  totalResponses: number,
): QuestionSummary {
  const mine = answers.filter((a) => a.questionId === question.id && a.valueText.trim() !== "");
  const answered = mine.length;

  let buckets: ChoiceBucket[] = [];
  if (CHOICE_KINDS.includes(question.kind)) {
    const counts = new Map<string, number>();
    // Seed with the declared options so an option nobody picked still shows as
    // zero — "no one chose Programming" is a finding, and dropping the row
    // would hide it.
    for (const option of optionsFor(question)) counts.set(option, 0);
    for (const answer of mine) {
      for (const part of splitMulti(question.kind, answer.valueText)) {
        counts.set(part, (counts.get(part) ?? 0) + 1);
      }
    }
    // multi_select shares are of respondents, not of picks, so two people each
    // choosing three subteams does not read as 600%.
    const denominator = answered || 1;
    buckets = [...counts.entries()]
      .map(([label, count]) => ({ label, count, share: round((count / denominator) * 100) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  let stats: QuestionSummary["stats"] = null;
  if (NUMERIC_KINDS.includes(question.kind)) {
    const numbers = mine
      .map((a) => (a.valueNumber != null ? a.valueNumber : numericValue(question.kind, a.valueText)))
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b);
    if (numbers.length > 0) {
      stats = {
        count: numbers.length,
        min: numbers[0] ?? 0,
        max: numbers[numbers.length - 1] ?? 0,
        mean: round(numbers.reduce((sum, n) => sum + n, 0) / numbers.length),
        median: round(median(numbers)),
      };
    }
  }

  const textAnswers =
    CHOICE_KINDS.includes(question.kind) || NUMERIC_KINDS.includes(question.kind)
      ? []
      : mine.map((a) => a.valueText).reverse();

  return {
    questionId: question.id,
    label: question.label,
    kind: question.kind,
    answered,
    totalResponses,
    buckets,
    stats,
    textAnswers,
    reading: readingFor({ kind: question.kind, answered, totalResponses, buckets, stats }),
  };
}

/**
 * One sentence about what a question's answers show, or null.
 *
 * Null is a real and common outcome. With one response there is no distribution
 * to describe, and saying "100% chose Mechanical" about a single person is
 * worse than saying nothing.
 */
function readingFor(input: {
  kind: QuestionKind;
  answered: number;
  totalResponses: number;
  buckets: ChoiceBucket[];
  stats: QuestionSummary["stats"];
}): string | null {
  const { kind, answered, totalResponses, buckets, stats } = input;
  if (answered === 0) return null;

  const skipped = totalResponses - answered;
  const skipNote = skipped > 0 ? ` ${skipped} of ${totalResponses} skipped it.` : "";

  if (CHOICE_KINDS.includes(kind)) {
    if (answered < 2) return null;
    const picked = buckets.filter((b) => b.count > 0);
    const top = picked[0];
    if (!top) return null;
    const empty = buckets.filter((b) => b.count === 0).map((b) => b.label);
    const lead = `${top.label} leads with ${top.count} of ${answered} (${top.share}%).`;
    const gap =
      empty.length > 0
        ? ` Nobody chose ${empty.slice(0, 3).join(", ")}${empty.length > 3 ? ` and ${empty.length - 3} more` : ""}.`
        : "";
    return lead + gap + skipNote;
  }

  if (stats) {
    if (stats.count < 2) return null;
    const spread =
      stats.max - stats.min === 0
        ? ` Everyone answered ${stats.min}.`
        : ` Range ${stats.min}–${stats.max}.`;
    return `Average ${stats.mean}, median ${stats.median} across ${stats.count} answers.${spread}${skipNote}`;
  }

  if (answered < 2) return null;
  return `${answered} written ${answered === 1 ? "answer" : "answers"}.${skipNote}`;
}

export type FormInsight = {
  headline: string;
  detail: string;
  /** True when the reading rests on so few responses that it may not hold. */
  provisional: boolean;
};

/**
 * A whole-form reading, framed for what the form is for.
 *
 * This is the "why does this matter for FRC" layer the results page leads with.
 * It is rule-based rather than model-generated on purpose: it runs with no API
 * key, costs nothing, cannot hallucinate a number, and is the same every time
 * the page loads. The AI drafting path sits alongside it for the open-ended
 * "summarise what people wrote" case, where a model genuinely helps.
 */
export function formInsight(input: {
  purpose: FormPurpose;
  totalResponses: number;
  assignedCount: number;
  /**
   * How many of the assigned people have actually answered.
   *
   * Distinct from `totalResponses`, and the distinction matters: a form that is
   * assigned to four students and shared as a link can hold four responses of
   * which one came from a stranger and one assignee never replied. Reading
   * "4 of 4 assigned people have answered" off the response count is a coverage
   * figure that goes up when the wrong people answer. Omitted means "unknown",
   * and then the sentence does not claim coverage at all.
   */
  respondedAssignees?: number;
  summaries: QuestionSummary[];
}): FormInsight {
  const { purpose, totalResponses, assignedCount, respondedAssignees, summaries } = input;

  if (totalResponses === 0) {
    return {
      headline: "No responses yet",
      detail:
        assignedCount > 0
          ? `Assigned to ${assignedCount} ${assignedCount === 1 ? "person" : "people"}. Nothing to read until someone answers.`
          : "Share the link or assign this form, then answers will show up here.",
      provisional: false,
    };
  }

  const provisional = totalResponses < 3;
  const answeredAssignees = respondedAssignees ?? totalResponses;
  const outstanding = assignedCount > 0 ? Math.max(assignedCount - answeredAssignees, 0) : 0;
  // Responses that came from outside the assigned list — a share link, a parent,
  // a prospective student. Named separately so the coverage figure stays about
  // the people who were actually asked.
  const extra = Math.max(totalResponses - answeredAssignees, 0);
  const coverage =
    assignedCount > 0
      ? `${answeredAssignees} of ${assignedCount} assigned ${answeredAssignees === 1 ? "person has" : "people have"} answered${outstanding > 0 ? `; ${outstanding} outstanding` : ""}${extra > 0 ? `; ${extra} more answered through the link` : ""}.`
      : `${totalResponses} ${totalResponses === 1 ? "response" : "responses"} so far.`;

  const detail = [coverage, purposeReading(purpose, summaries)].filter(Boolean).join(" ");

  return {
    headline: purposeHeadline(purpose, totalResponses),
    detail,
    provisional,
  };
}

function purposeHeadline(purpose: FormPurpose, total: number): string {
  const n = `${total} ${total === 1 ? "response" : "responses"}`;
  switch (purpose) {
    case "intake":
      return `${n} from prospective members`;
    case "tryout":
      return `${n} from tryout candidates`;
    case "mentor":
      return `${n} from mentors`;
    case "dues":
      return `${n} on dues`;
    case "travel":
      return `${n} on travel`;
    case "safety":
      return `${n} on safety`;
    case "feedback":
      return `${n} of feedback`;
    default:
      return n;
  }
}

/**
 * The domain-specific part: what these answers mean for running a team.
 *
 * Every branch reads from real buckets and returns "" when the data does not
 * support a claim, so an empty string is a correct answer here.
 */
function purposeReading(purpose: FormPurpose, summaries: QuestionSummary[]): string {
  const choice = summaries.filter((s) => s.buckets.some((b) => b.count > 0));

  if (purpose === "intake" || purpose === "mentor") {
    // The useful question for a team is not "how many signed up" but "where are
    // we thin". An interest bucket with zero picks is an unstaffed subteam.
    const interest = choice.find((s) => s.buckets.length >= 3);
    if (!interest) return "";
    const empty = interest.buckets.filter((b) => b.count === 0).map((b) => b.label);
    const top = interest.buckets.find((b) => b.count > 0);
    if (empty.length > 0 && top) {
      return `On "${interest.label}", ${top.label} is strongest (${top.count}) and nobody picked ${empty.slice(0, 3).join(", ")} — those are the gaps to recruit into.`;
    }
    if (top) return `On "${interest.label}", ${top.label} leads with ${top.count}.`;
    return "";
  }

  if (purpose === "dues") {
    const status = choice.find((s) => s.buckets.some((b) => /paid|assist|not yet/i.test(b.label)));
    if (!status) return "";
    // Someone who ticked both "Partial payment" and "Requesting assistance" is
    // one person, and they belong in the assistance count only. Counting them in
    // both made a four-person form read as though five people had answered, and
    // put a family who asked for help into the list a treasurer chases.
    const assist = status.buckets.filter((b) => /assist/i.test(b.label)).reduce((sum, b) => sum + b.count, 0);
    const unpaid = status.buckets
      .filter((b) => /not yet|partial/i.test(b.label) && !/assist/i.test(b.label))
      .reduce((sum, b) => sum + b.count, 0);
    const parts: string[] = [];
    if (unpaid > 0) parts.push(`${unpaid} still owe`);
    if (assist > 0) parts.push(`${assist} asked for assistance — follow up privately`);
    return parts.length ? `${parts.join("; ")}.` : "Everyone who answered is paid up.";
  }

  if (purpose === "safety") {
    const trained = choice.find((s) => s.kind === "yes_no");
    if (!trained) return "";
    const no = trained.buckets.find((b) => b.label === "No")?.count ?? 0;
    return no > 0
      ? `${no} answered "No" on "${trained.label}" — they should not be in the shop until that is cleared.`
      : `Everyone who answered is clear on "${trained.label}".`;
  }

  if (purpose === "travel") {
    const going = choice.find((s) => s.kind === "yes_no");
    if (!going) return "";
    const yes = going.buckets.find((b) => b.label === "Yes")?.count ?? 0;
    return yes > 0 ? `${yes} travelling — use that as the headcount for rooms and transport.` : "";
  }

  if (purpose === "feedback" || purpose === "tryout") {
    const rated = summaries.find((s) => s.stats && s.stats.count >= 2);
    if (!rated?.stats) return "";
    return `"${rated.label}" averages ${rated.stats.mean} (range ${rated.stats.min}–${rated.stats.max}).`;
  }

  const first = summaries.find((s) => s.reading);
  return first?.reading ?? "";
}
