// Pure readiness roll-up over LIVE counts from the four source systems.
// The counts are read at request time by compute-event-readiness.ts — nothing
// from those systems is ever copied into event_readiness tables (no consent or
// medical detail, only counts computed at read time).
//
// Honesty rule: a source with no rows reports "not set up yet" with a link to
// the owning tool — never 0%, never 0-of-0.

import { READINESS_SOURCE_HREFS, READINESS_SOURCE_LABELS, type RollupSource } from "./types";

export type InspectionCounts = { totalItems: number; passedItems: number; failedItems: number };
export type ConsentCounts = { requiredForms: number; peopleTracked: number; peopleComplete: number };
export type PackingCounts = { lists: number; totalItems: number; packedItems: number };
export type LogisticsCounts = { trips: number; travelLegs: number; roomAssignments: number };

export type ReadinessSourceCounts = {
  inspection: InspectionCounts | null;
  consent: ConsentCounts | null;
  packing: PackingCounts | null;
  logistics: LogisticsCounts | null;
};

export type SourceRollup = {
  source: RollupSource;
  label: string;
  /** Deep link to the tool that owns the data. */
  href: string;
  state: "not_set_up" | "live";
  detail: string;
  /** Only present when an honest fraction exists (total > 0). */
  fraction: { done: number; total: number } | null;
};

function notSetUp(source: RollupSource, detail: string): SourceRollup {
  return {
    source,
    label: READINESS_SOURCE_LABELS[source],
    href: READINESS_SOURCE_HREFS[source],
    state: "not_set_up",
    detail,
    fraction: null,
  };
}

function live(source: RollupSource, detail: string, fraction: { done: number; total: number } | null): SourceRollup {
  return {
    source,
    label: READINESS_SOURCE_LABELS[source],
    href: READINESS_SOURCE_HREFS[source],
    state: "live",
    detail,
    fraction: fraction && fraction.total > 0 ? fraction : null,
  };
}

export function readinessSummary(counts: ReadinessSourceCounts): SourceRollup[] {
  const rollups: SourceRollup[] = [];

  const inspection = counts.inspection;
  if (!inspection || inspection.totalItems === 0) {
    rollups.push(
      notSetUp("inspection", "No inspection checklist yet — seed the official self-check in Inspection."),
    );
  } else {
    const failing = inspection.failedItems > 0 ? `, ${inspection.failedItems} failing` : "";
    rollups.push(
      live(
        "inspection",
        `${inspection.passedItems} of ${inspection.totalItems} items passed${failing}.`,
        { done: inspection.passedItems, total: inspection.totalItems },
      ),
    );
  }

  const consent = counts.consent;
  if (!consent || consent.requiredForms === 0) {
    rollups.push(notSetUp("consent", "No required forms defined yet — add them in Consent."));
  } else if (consent.peopleTracked === 0) {
    rollups.push(
      notSetUp(
        "consent",
        `${consent.requiredForms} required form${consent.requiredForms === 1 ? "" : "s"} defined, but no submissions tracked yet — record them in Consent.`,
      ),
    );
  } else {
    rollups.push(
      live(
        "consent",
        `${consent.peopleComplete} of ${consent.peopleTracked} tracked members returned every required form.`,
        { done: consent.peopleComplete, total: consent.peopleTracked },
      ),
    );
  }

  const packing = counts.packing;
  if (!packing || packing.lists === 0) {
    rollups.push(notSetUp("packing", "No packing list linked to this event yet — create one in Packing."));
  } else if (packing.totalItems === 0) {
    rollups.push(
      live(
        "packing",
        `${packing.lists} packing list${packing.lists === 1 ? "" : "s"} linked, no items added yet.`,
        null,
      ),
    );
  } else {
    const lists = packing.lists === 1 ? "" : ` across ${packing.lists} lists`;
    rollups.push(
      live("packing", `${packing.packedItems} of ${packing.totalItems} items packed${lists}.`, {
        done: packing.packedItems,
        total: packing.totalItems,
      }),
    );
  }

  const logistics = counts.logistics;
  if (!logistics || logistics.trips === 0) {
    rollups.push(
      notSetUp("logistics", "No trip planned for this event yet — plan travel in Travel & Logistics."),
    );
  } else {
    const legs = `${logistics.travelLegs} travel leg${logistics.travelLegs === 1 ? "" : "s"}`;
    const rooms = `${logistics.roomAssignments} room assignment${logistics.roomAssignments === 1 ? "" : "s"}`;
    rollups.push(live("logistics", `Trip planned: ${legs}, ${rooms}.`, null));
  }

  return rollups;
}
