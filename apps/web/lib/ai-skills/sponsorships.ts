/**
 * The Sponsorships skill's thinking, done in code so it is the same every time and needs no model:
 * who to ask next, what is due, and which matching-gift programs line up — all from the team's
 * own sponsor records. The model only turns this into words (and emails). Pure; no I/O.
 *
 * Nothing is invented: a reason quotes a recorded stage or date, an amount appears only when the
 * team recorded one, and with no records the list is empty.
 */
import type { Sponsor, SponsorProspect } from "../business-portal";
import type { SponsorReminder } from "../sponsor-pipeline";
import { pipelineStageLabel } from "../sponsor-pipeline";
import { dollarsOrNull } from "./bound";
import type { AiSkillDraftKind } from "./catalog";

export type AskNextKind =
  | "thank_you"
  | "renewal"
  | "follow_up"
  | "pledge"
  | "lapsed"
  | "stalled"
  | "not_contacted"
  | "prospect_research";

export type AskNextCandidate = {
  sponsorId: string | null;
  name: string;
  kind: AskNextKind;
  /** Plain reason built from recorded fields only. */
  reason: string;
  dueOn: string | null;
  stage: string | null;
  contactName: string | null;
  /** Recorded ask or pledge, formatted; null when none was recorded. */
  recordedAmount: string | null;
  renewalRisk: "low" | "moderate" | "high" | null;
};

const PRIORITY: Record<AskNextKind, number> = {
  thank_you: 0,
  renewal: 1,
  follow_up: 2,
  pledge: 3,
  lapsed: 4,
  stalled: 5,
  not_contacted: 6,
  prospect_research: 7,
};

/** Days without contact before an Ask or Visit-stage sponsor counts as stalled. */
export const STALLED_AFTER_DAYS = 21;

function dayMs(value: string): number {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`).getTime();
}

function daysSince(value: string | null, now: Date): number | null {
  if (!value) return null;
  const then = dayMs(value);
  if (!Number.isFinite(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

/** "2026-10-01" → "Oct 1". */
export function shortDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Who to ask next, most urgent first: thank-yous and renewals that are due, overdue follow-ups,
 * pledges not yet received, past sponsors who haven't given this season, stalled asks, sponsors
 * never contacted, then saved research prospects by fit. One line per sponsor.
 */
export function rankSponsorAsks(input: {
  sponsors: Sponsor[];
  reminders: SponsorReminder[];
  prospects?: SponsorProspect[];
  renewalRisk?: ReadonlyMap<string, "low" | "moderate" | "high">;
  now?: Date;
  limit?: number;
}): AskNextCandidate[] {
  const now = input.now ?? new Date();
  const byId = new Map(input.sponsors.map((sponsor) => [sponsor.id, sponsor]));
  const best = new Map<string, AskNextCandidate>();

  const consider = (key: string, candidate: AskNextCandidate) => {
    const existing = best.get(key);
    if (!existing || PRIORITY[candidate.kind] < PRIORITY[existing.kind]) best.set(key, candidate);
  };
  const base = (sponsor: Sponsor) => ({
    sponsorId: sponsor.id,
    name: sponsor.name,
    stage: pipelineStageLabel(sponsor.pipelineStage),
    contactName: sponsor.contactName,
    recordedAmount: dollarsOrNull(sponsor.pledgedCents) ?? dollarsOrNull(sponsor.askCents),
    renewalRisk: input.renewalRisk?.get(sponsor.id) ?? null,
  });

  for (const reminder of input.reminders) {
    const sponsor = byId.get(reminder.sponsorId);
    if (!sponsor || sponsor.status === "declined") continue;
    const when = shortDate(reminder.dueOn);
    const reason =
      reminder.kind === "thank_you"
        ? `Thank-you due${when ? ` since ${when}` : ""} — thank them before the next ask`
        : reminder.kind === "renewal"
          ? `Renewal outreach due${when ? ` ${when}` : ""}`
          : `Follow-up was due${when ? ` ${when}` : ""}`;
    consider(sponsor.id, { ...base(sponsor), kind: reminder.kind, reason, dueOn: reminder.dueOn });
  }

  for (const sponsor of input.sponsors) {
    if (sponsor.status === "declined") continue;
    const sinceContact = daysSince(sponsor.lastContactOn, now);
    if (sponsor.pipelineStage === "pledged" && sponsor.seasonCashCents <= 0) {
      consider(sponsor.id, {
        ...base(sponsor),
        kind: "pledge",
        reason: "Pledged, but nothing received this season yet",
        dueOn: null,
      });
      continue;
    }
    if ((sponsor.pipelineStage === "renewal" || sponsor.status === "lapsed") && sponsor.lifetimeCents > 0 && sponsor.seasonCents <= 0) {
      consider(sponsor.id, {
        ...base(sponsor),
        kind: "lapsed",
        reason: "Gave before, nothing recorded this season",
        dueOn: sponsor.renewalDueOn,
      });
      continue;
    }
    if ((sponsor.pipelineStage === "ask" || sponsor.pipelineStage === "visit") && (sinceContact === null || sinceContact >= STALLED_AFTER_DAYS)) {
      consider(sponsor.id, {
        ...base(sponsor),
        kind: "stalled",
        reason:
          sinceContact === null
            ? `${pipelineStageLabel(sponsor.pipelineStage)} stage, no contact logged`
            : `${pipelineStageLabel(sponsor.pipelineStage)} stage, last contact ${sinceContact} days ago`,
        dueOn: null,
      });
      continue;
    }
    if (sponsor.pipelineStage === "prospect" && !sponsor.lastContactOn) {
      consider(sponsor.id, {
        ...base(sponsor),
        kind: "not_contacted",
        reason: "Prospect you haven't contacted yet",
        dueOn: null,
      });
    }
  }

  const known = new Set(input.sponsors.map((sponsor) => sponsor.name.trim().toLowerCase()));
  for (const prospect of input.prospects ?? []) {
    if (prospect.status === "dismissed" || known.has(prospect.name.trim().toLowerCase())) continue;
    consider(`prospect:${prospect.id}`, {
      sponsorId: null,
      name: prospect.name,
      kind: "prospect_research",
      reason: prospect.fitScore > 0 ? `Saved prospect (fit ${prospect.fitScore}/100)` : "Saved prospect",
      dueOn: null,
      stage: null,
      contactName: null,
      recordedAmount: null,
      renewalRisk: null,
    });
  }

  return [...best.values()]
    .sort(
      (a, b) =>
        PRIORITY[a.kind] - PRIORITY[b.kind] ||
        (a.renewalRisk === "high" ? -1 : 0) - (b.renewalRisk === "high" ? -1 : 0) ||
        (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") ||
        a.name.localeCompare(b.name),
    )
    .slice(0, input.limit ?? 8);
}

/** Active sponsors whose renewal window opens in the next `days` days (not yet due). */
export function renewalsComingUp(sponsors: Sponsor[], now = new Date(), days = 45) {
  const today = dayMs(now.toISOString());
  const until = today + days * 86_400_000;
  return sponsors
    .filter((sponsor) => sponsor.status !== "declined" && sponsor.renewalDueOn)
    .filter((sponsor) => {
      const due = dayMs(sponsor.renewalDueOn!);
      return due > today && due <= until;
    })
    .sort((a, b) => a.renewalDueOn!.localeCompare(b.renewalDueOn!))
    .map((sponsor) => ({ sponsorId: sponsor.id, name: sponsor.name, renewalDueOn: sponsor.renewalDueOn! }));
}

/** The sponsor a message names ("Draft a renewal email to Acme"), by longest name match. */
export function sponsorNamedIn(message: string, sponsors: Sponsor[]): Sponsor | null {
  const text = message.toLowerCase();
  let found: Sponsor | null = null;
  for (const sponsor of sponsors) {
    const name = sponsor.name.trim().toLowerCase();
    if (name.length < 2 || !text.includes(name)) continue;
    if (!found || name.length > found.name.length) found = sponsor;
  }
  return found;
}

/** Which Writer draft kind an answer would be saved as. */
export function sponsorDraftKind(message: string): AiSkillDraftKind {
  if (/\b(renew|renewal)\b/i.test(message)) return "renewal";
  if (/\bthank(?:s| you|-you)?\b/i.test(message)) return "thank_you";
  if (/\b(cold|introduc|first email|reach out)\b/i.test(message)) return "cold_intro";
  return "sponsorship_ask";
}

export type MatchingGiftLine = { contactName: string; employer: string };

/** The plain lines the chat shows (and the model reads) for the Sponsorships skill. */
export function sponsorshipHighlights(input: {
  askNext: AskNextCandidate[];
  comingUp: Array<{ name: string; renewalDueOn: string }>;
  matches: MatchingGiftLine[];
  goal: { goalCents: number; actualCents: number } | null;
}): string[] {
  const lines: string[] = [];
  for (const candidate of input.askNext.slice(0, 5)) {
    const risk = candidate.renewalRisk === "high" ? " · renewal risk high" : "";
    lines.push(`Ask next: ${candidate.name} — ${candidate.reason}${risk}`);
  }
  if (input.comingUp.length) {
    lines.push(
      `Renewals coming up: ${input.comingUp
        .slice(0, 4)
        .map((row) => `${row.name} (${shortDate(row.renewalDueOn)})`)
        .join(", ")}`,
    );
  }
  if (input.matches.length) {
    const employers = [...new Set(input.matches.map((match) => match.employer))];
    lines.push(
      `Matching gifts: ${input.matches.length} contact${input.matches.length === 1 ? "" : "s"} work${input.matches.length === 1 ? "s" : ""} at ${employers.slice(0, 3).join(", ")}${employers.length > 3 ? " and more" : ""} — each has a matching-gift program on file`,
    );
  }
  const goal = input.goal;
  if (goal && goal.goalCents > 0) {
    lines.push(`Season goal: ${dollarsOrNull(goal.actualCents) ?? "$0"} raised of ${dollarsOrNull(goal.goalCents)}`);
  }
  return lines;
}
