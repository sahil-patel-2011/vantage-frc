// The dated pre-event readiness template — PURE DATA, no I/O.
//
// Every offset is days BEFORE event_start_date. Rows that map to an existing
// system carry that system's source_kind so the roll-up can replace a manual
// checkbox with a live count read from the owning tool at request time.

import type { ReadinessCategory, ReadinessSourceKind } from "./types";

export type ReadinessTemplateRow = {
  category: ReadinessCategory;
  title: string;
  detail: string;
  /** Due this many days before event_start_date. */
  daysBefore: number;
  sourceKind: ReadinessSourceKind;
};

export const EVENT_READINESS_TEMPLATE: readonly ReadinessTemplateRow[] = [
  {
    category: "travel",
    title: "Travel legs and rooms confirmed",
    detail: "Departure times, hotel, and room assignments live in Travel & Logistics.",
    daysBefore: 14,
    sourceKind: "logistics",
  },
  {
    category: "roster",
    title: "Travel roster confirmed",
    detail: "Who is going, who drives, who chaperones — confirmed with mentors and families.",
    daysBefore: 10,
    sourceKind: "template",
  },
  {
    category: "consent",
    title: "Consent and permission forms collected",
    detail: "Every traveling member has returned each required form — tracked in Consent.",
    daysBefore: 7,
    sourceKind: "consent",
  },
  {
    category: "inspection",
    title: "Official inspection self-check passed",
    detail: "Run the FRC self-inspection checklist and weigh-in before the real inspector does.",
    daysBefore: 3,
    sourceKind: "inspection",
  },
  {
    category: "robot",
    title: "Spare parts boxed",
    detail: "Spares, fasteners, and pre-built replacement mechanisms boxed and labeled.",
    daysBefore: 2,
    sourceKind: "template",
  },
  {
    category: "pit",
    title: "Pit set-up kit staged",
    detail: "Banner, tools, chargers, extension cords, and pit display staged by the door.",
    daysBefore: 2,
    sourceKind: "template",
  },
  {
    category: "robot",
    title: "Batteries charged and labeled",
    detail: "Every competition battery charged, load-tested, and labeled with its rotation slot.",
    daysBefore: 1,
    sourceKind: "template",
  },
  {
    category: "packing",
    title: "Pack list packed and loaded",
    detail: "Every packing-list item checked off and loaded — tracked in Packing.",
    daysBefore: 1,
    sourceKind: "packing",
  },
];
