/**
 * Reading a dues form well enough to know who must never be chased.
 *
 * The whole feature rests on one rule: a student who answered "Requesting
 * assistance" does not get an email about money. Not a gentle one, not a
 * batched one, not one that goes to their parent. They have already told the
 * team something difficult, in writing, and the correct response is a quiet
 * conversation with a mentor — not an automated reminder arriving at 7am on a
 * Tuesday, possibly in a mailbox a sibling or a parent also reads.
 *
 * That rule only holds if the reading is conservative, so this file is built
 * around three deliberate choices:
 *
 *   1. Assistance is absorbing. An answer that mentions assistance is
 *      assistance, even if it also says "partial payment". Someone paying what
 *      they can while asking for help is exactly who must not be chased.
 *   2. Anything unrecognised is "unknown", and unknown is never emailed. If a
 *      team writes an option this file cannot read, the honest outcome is to
 *      leave that person out and show the treasurer the count, not to guess.
 *   3. A form with no way to ask for assistance cannot be used to chase
 *      anybody — see `findDuesStatusQuestion`.
 *
 * No database access here on purpose: this is the part that has to be provable
 * by reading it, and it is covered by dues.test.ts.
 */

import { CHOICE_KINDS, optionsFor, type FormQuestion } from "./types";
import { MULTI_SEPARATOR } from "./results";

export type DuesStatus = "paid" | "owing" | "assistance" | "unknown";

/**
 * Phrases a team might actually write for "I need help paying".
 *
 * Wider than the starter template's own wording, because a team that renamed
 * the option to "Applying for the hardship fund" must still be protected. False
 * positives here are cheap (one person is not emailed and a lead follows up in
 * person); false negatives are the failure this feature exists to prevent.
 */
const ASSISTANCE = /assist|hardship|scholarship|financial aid|fee waiver|waiver|need help|needs help|help paying|cannot pay|can't pay|cant pay|unable to pay|reduced|sponsor(ed)? place|bursary|subsid/i;

/**
 * Still owes something. Checked before "paid" so "Not yet paid" is not read as
 * paid.
 *
 * Note what is NOT in here: a bare "due". "Paid before the due date" is a
 * perfectly ordinary option label, and matching "due" would turn someone who
 * has paid into someone who gets chased. A team whose only wording is "Due"
 * lands in `unknown`, which sends nothing and is shown to the treasurer as a
 * count — the failure this file wants is under-reaching, not mis-reaching.
 */
const OWING = /not yet|not paid|unpaid|no payment|haven'?t paid|have not paid|partial|part payment|outstanding|owes?\b|owing|owed|balance|instal?ment|payment plan|pending payment/i;

const PAID = /paid|settled|complete|covered|done/i;

/** Classify one option or free-text answer. Order is the safety property. */
export function classifyDuesValue(raw: string): DuesStatus {
  const value = raw.trim();
  if (!value) return "unknown";
  if (ASSISTANCE.test(value)) return "assistance";
  if (OWING.test(value)) return "owing";
  if (PAID.test(value)) return "paid";
  return "unknown";
}

/** Assistance beats everything, then owing, then paid. Unknown only when nothing else matched. */
function mostProtective(a: DuesStatus, b: DuesStatus): DuesStatus {
  if (a === "assistance" || b === "assistance") return "assistance";
  if (a === "owing" || b === "owing") return "owing";
  if (a === "paid" || b === "paid") return "paid";
  return "unknown";
}

/**
 * Classify a whole answer, including a multi-select where someone ticked more
 * than one box ("Partial payment | Requesting assistance" is assistance).
 */
export function classifyDuesAnswer(raw: string): DuesStatus {
  const parts = raw.split(MULTI_SEPARATOR).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return "unknown";
  return parts.map(classifyDuesValue).reduce(mostProtective, "unknown");
}

export type DuesQuestionCheck =
  | { ok: true; question: FormQuestion }
  | { ok: false; reason: string };

/**
 * Find the question that carries payment status — and refuse if the form gives
 * nobody a way to ask for help.
 *
 * This is the structural half of the never-chase rule. A team can rename or
 * rewrite the dues question however they like, but if the option list contains
 * no way to say "I need assistance", then a student in that position had no
 * honest answer to give, and chasing the ones who ticked "Not yet paid" would
 * be chasing them too. Rather than send anyway and hope, the feature stops and
 * says what to add.
 */
export function findDuesStatusQuestion(questions: FormQuestion[]): DuesQuestionCheck {
  const choices = questions
    .filter((question) => CHOICE_KINDS.includes(question.kind))
    .sort((a, b) => a.position - b.position);

  if (choices.length === 0) {
    return {
      ok: false,
      reason:
        "This form has no multiple-choice question, so there is nothing that records who has paid. Add a payment status question with options like “Paid in full”, “Partial payment”, “Requesting assistance” and “Not yet paid”.",
    };
  }

  const withPayment = choices.filter((question) => {
    const statuses = optionsFor(question).map(classifyDuesValue);
    return statuses.includes("owing") || statuses.includes("paid");
  });

  if (withPayment.length === 0) {
    return {
      ok: false,
      reason:
        "No question on this form records payment status. Add one with options like “Paid in full”, “Partial payment”, “Requesting assistance” and “Not yet paid”.",
    };
  }

  const withAssistance = withPayment.find((question) =>
    optionsFor(question).some((option) => classifyDuesValue(option) === "assistance"),
  );

  if (!withAssistance) {
    const question = withPayment[0];
    return {
      ok: false,
      reason: `“${question?.label ?? "The payment question"}” gives nobody a way to say they need financial assistance, so Vantage will not send reminders from this form. Add an option such as “Requesting assistance” first — a student who cannot pay needs an answer that is not a reminder.`,
    };
  }

  return { ok: true, question: withAssistance };
}

export type DuesCounts = {
  paid: number;
  owing: number;
  assistance: number;
  unknown: number;
};

export function emptyDuesCounts(): DuesCounts {
  return { paid: 0, owing: 0, assistance: 0, unknown: 0 };
}

export function tallyDues(statuses: DuesStatus[]): DuesCounts {
  const counts = emptyDuesCounts();
  for (const status of statuses) counts[status] += 1;
  return counts;
}
