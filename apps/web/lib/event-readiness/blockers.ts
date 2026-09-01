// Remaining blockers for ONE event date, projected from the four owning modules.
//
// Consent, packing, logistics, and inspection already know their own statuses
// (`summarizeConsent`, `packProgress`, `countLodgingGaps`, `inspectionProgress`,
// `weightStatus`). This file does not re-count them — it calls those functions
// and folds the four answers into one remaining number for the event start date.
//
// Honesty: remaining is a number only when every source can report one.
// A missing checklist, an empty pack list, or a trip with no rooms is unknown,
// not remaining=0.

import { summarizeConsent, type RecordStatus } from "../consent";
import {
  DEFAULT_WEIGHT_LIMIT_LBS,
  inspectionProgress,
  weightStatus,
  type InspectionItem,
  type InspectionStatus,
  type RobotWeight,
} from "../inspection";
import { countLodgingGaps } from "../logistics";
import { packProgress, type PackingItem } from "../packing";
import { READINESS_SOURCE_HREFS, READINESS_SOURCE_LABELS, type RollupSource } from "./types";

export type ConsentSnapshot = {
  forms: Array<{ id: string; required: boolean }>;
  records: Array<{ formId: string; personName: string; status: RecordStatus }>;
};

export type PackingSnapshot = {
  lists: number;
  items: Array<{ packed: boolean }>;
};

export type InspectionSnapshot = {
  items: Array<{ status: InspectionStatus }>;
  weights?: Array<{ totalLbs: number; weighedAt: string }>;
  weightLimitLbs?: number | null;
};

export type LogisticsSnapshot = {
  trips: number;
  travelLegs: number;
  rooms: Array<{ occupantUserId: string | null; occupantName: string }>;
};

export type EventSourceSnapshots = {
  consent: ConsentSnapshot;
  packing: PackingSnapshot;
  inspection: InspectionSnapshot;
  logistics: LogisticsSnapshot;
};

export type SourceBlockers = {
  source: RollupSource;
  label: string;
  href: string;
  state: "not_set_up" | "live";
  /** Remaining work from that module. Null when the module cannot honestly count. */
  remaining: number | null;
  detail: string;
};

export type EventBlockers = {
  eventStartDate: string;
  /**
   * Combined remaining for this event date. Null when any source is unknown —
   * never invented as 0.
   */
  remaining: number | null;
  /** True only when remaining is 0 — all four sources live and clear. */
  ready: boolean;
  unknownSources: RollupSource[];
  sources: SourceBlockers[];
};

function sourceCard(
  source: RollupSource,
  state: SourceBlockers["state"],
  remaining: number | null,
  detail: string,
): SourceBlockers {
  return {
    source,
    label: READINESS_SOURCE_LABELS[source],
    href: READINESS_SOURCE_HREFS[source],
    state,
    remaining,
    detail,
  };
}

function notSetUp(source: RollupSource, detail: string): SourceBlockers {
  return sourceCard(source, "not_set_up", null, detail);
}

export function projectConsentBlockers(input: ConsentSnapshot): SourceBlockers {
  const summary = summarizeConsent(input);
  if (summary.requiredForms === 0) {
    return notSetUp("consent", "No required forms defined yet — add them in Consent.");
  }
  if (summary.peopleTracked === 0) {
    return notSetUp(
      "consent",
      `${summary.requiredForms} required form${summary.requiredForms === 1 ? "" : "s"} defined, but no submissions tracked yet — record them in Consent.`,
    );
  }
  return sourceCard(
    "consent",
    "live",
    summary.outstanding,
    summary.outstanding === 0
      ? `${summary.fullyComplete} tracked members returned every required form.`
      : `${summary.outstanding} of ${summary.peopleTracked} tracked members still missing a required form.`,
  );
}

export function projectPackingBlockers(input: PackingSnapshot): SourceBlockers {
  if (input.lists <= 0) {
    return notSetUp("packing", "No packing list linked to this event yet — create one in Packing.");
  }
  const progress = packProgress(input.items as PackingItem[]);
  if (progress.total === 0) {
    return sourceCard(
      "packing",
      "live",
      null,
      `${input.lists} packing list${input.lists === 1 ? "" : "s"} linked, no items added yet.`,
    );
  }
  const remaining = progress.total - progress.packed;
  return sourceCard(
    "packing",
    "live",
    remaining,
    remaining === 0
      ? `${progress.packed} of ${progress.total} items packed.`
      : `${remaining} of ${progress.total} items still unpacked${input.lists === 1 ? "" : ` across ${input.lists} lists`}.`,
  );
}

export function projectInspectionBlockers(input: InspectionSnapshot): SourceBlockers {
  const progress = inspectionProgress(input.items as InspectionItem[]);
  const weights: RobotWeight[] = (input.weights ?? []).map((row, index) => ({
    id: String(index),
    robotLabel: "",
    totalLbs: row.totalLbs,
    config: "",
    note: "",
    weighedAt: row.weighedAt,
    recordedByName: null,
  }));
  const weight = weightStatus(weights, input.weightLimitLbs ?? DEFAULT_WEIGHT_LIMIT_LBS);
  const overweight = weight.over ? 1 : 0;

  if (progress.total === 0) {
    if (overweight) {
      return sourceCard(
        "inspection",
        "live",
        1,
        `Robot is ${Math.abs(weight.marginLbs ?? 0)} lb over the weigh-in limit.`,
      );
    }
    return notSetUp("inspection", "No inspection checklist yet — seed the official self-check in Inspection.");
  }

  const remaining = progress.fail + progress.pending + overweight;
  const failing = progress.fail > 0 ? `, ${progress.fail} failing` : "";
  const pending = progress.pending > 0 ? `, ${progress.pending} pending` : "";
  const weightNote = overweight
    ? ` Weigh-in is ${Math.abs(weight.marginLbs ?? 0)} lb over the limit.`
    : "";
  return sourceCard(
    "inspection",
    "live",
    remaining,
    remaining === 0
      ? `${progress.pass + progress.na} of ${progress.total} items resolved (pass or n/a).`
      : `${remaining} inspection item${remaining === 1 ? "" : "s"} still open${failing}${pending}.${weightNote}`,
  );
}

export function projectLogisticsBlockers(input: LogisticsSnapshot): SourceBlockers {
  if (input.trips <= 0) {
    return notSetUp("logistics", "No trip planned for this event yet — plan travel in Travel & Logistics.");
  }
  const lodgingRemaining = input.rooms.length > 0 ? countLodgingGaps(input.rooms) : null;
  if (lodgingRemaining == null && input.travelLegs <= 0) {
    return notSetUp(
      "logistics",
      "Trip exists but has no travel legs or rooms yet — finish it in Travel & Logistics.",
    );
  }
  if (lodgingRemaining == null) {
    return sourceCard(
      "logistics",
      "live",
      null,
      `Trip planned with ${input.travelLegs} travel leg${input.travelLegs === 1 ? "" : "s"}, but no rooms assigned yet.`,
    );
  }
  const travelBlocker = input.travelLegs <= 0 ? 1 : 0;
  const remaining = lodgingRemaining + travelBlocker;
  const lodging =
    lodgingRemaining === 0
      ? `${input.rooms.length} room${input.rooms.length === 1 ? "" : "s"} assigned`
      : `${lodgingRemaining} room${lodgingRemaining === 1 ? "" : "s"} still need an occupant`;
  const travel =
    travelBlocker === 0
      ? `${input.travelLegs} travel leg${input.travelLegs === 1 ? "" : "s"} published`
      : "no travel legs published";
  return sourceCard("logistics", "live", remaining, `Trip planned: ${lodging}, ${travel}.`);
}

/**
 * One remaining-blockers answer for one event start date.
 * Remaining is 0 only when every source is live and reports 0.
 */
export function projectEventBlockers(input: EventSourceSnapshots & { eventStartDate: string }): EventBlockers {
  const sources = [
    projectInspectionBlockers(input.inspection),
    projectConsentBlockers(input.consent),
    projectPackingBlockers(input.packing),
    projectLogisticsBlockers(input.logistics),
  ];
  const unknownSources = sources.filter((source) => source.remaining == null).map((source) => source.source);
  const remaining = unknownSources.length > 0 ? null : sources.reduce((sum, source) => sum + (source.remaining ?? 0), 0);
  return {
    eventStartDate: input.eventStartDate,
    remaining,
    ready: remaining === 0,
    unknownSources,
    sources,
  };
}
