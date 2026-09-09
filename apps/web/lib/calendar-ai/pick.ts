// Turning a suggested slot into a create-event draft.
//
// This is the seam where model-shaped output meets a form that the create API
// validates strictly. `kind` arrives as a string and `subteamId` as an id that
// was resolved server-side; both have to be reconciled against what this
// browser is actually holding, because a value the form accepts silently and
// the API then rejects is worse than a value we correct here and show.
//
// Nothing in here writes anything. The result is a draft the person still has
// to read and submit.

import { SUBTEAM_EVENT_KINDS, type SubteamEventKind } from "../subteam-calendar";

export type SchedulerPick = {
  startsAt: string;
  endsAt: string;
  title: string;
  kind: string;
  subteamId: string | null;
};

export type EventDraft = {
  title: string;
  kind: SubteamEventKind;
  /** `datetime-local` wall-clock text, not an instant. */
  startsAt: string;
  endsAt: string;
  subteamId: string | null;
};

/** `datetime-local` wants local wall-clock text, not the stored instant. */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Build the draft. `subteamIds` is what this team really has: a suggestion that
 * names a subteam this browser doesn't know about becomes "Whole team", which
 * is visible in the form, rather than an id the create call would reject.
 */
export function pickToDraft(pick: SchedulerPick, subteamIds: readonly string[]): EventDraft {
  const kind: SubteamEventKind = (SUBTEAM_EVENT_KINDS as readonly string[]).includes(pick.kind)
    ? (pick.kind as SubteamEventKind)
    : "meeting";

  const title = pick.title.trim();

  return {
    // An empty title would make the form's submit button dead with no
    // explanation, so fall back to something the person can edit.
    title: title || "Team session",
    kind,
    startsAt: toLocalInputValue(pick.startsAt),
    // An unparseable end is left blank rather than guessed: the create form
    // treats a blank end as open-ended, which is honest about not knowing.
    endsAt: toLocalInputValue(pick.endsAt),
    subteamId: pick.subteamId && subteamIds.includes(pick.subteamId) ? pick.subteamId : null,
  };
}
