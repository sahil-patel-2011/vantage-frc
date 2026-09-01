/**
 * Morning standup digest — shapes only. No I/O.
 *
 * The digest is yesterday's (or a chosen day's) shop hours plus task movement
 * from the canonical work-item projection. Nothing here is invented: if a day
 * has no closed hours and no created/completed work, there is no digest.
 */

import type { WorkItemSource, WorkItemStatus } from "../work-items/types";

export type StandupMovementEvent = "completed" | "created" | "blocked";

export type StandupMovement = {
  id: string;
  source: WorkItemSource;
  title: string;
  grouping: string | null;
  status: WorkItemStatus;
  owners: string[];
  event: StandupMovementEvent;
  occurredAt: string;
  href: string;
};

export type StandupBlocker = {
  id: string;
  source: WorkItemSource;
  title: string;
  grouping: string | null;
  owners: string[];
  href: string;
  ageDays: number;
};

export type StandupHoursContributor = {
  userId: string;
  name: string;
  hours: number;
};

export type StandupHoursByKind = {
  kind: string;
  hours: number;
};

export type StandupHoursSummary = {
  totalHours: number;
  byKind: StandupHoursByKind[];
  contributors: StandupHoursContributor[];
};

export type StandupDigest = {
  digestDate: string;
  windowStart: string;
  windowEnd: string;
  hours: StandupHoursSummary;
  movement: StandupMovement[];
  blockers: StandupBlocker[];
  /** Null when the day has no hours and no movement — callers must not invent one. */
  headline: string | null;
};

export type StandupSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};
