/**
 * Event Day Command pit flags — same evidence as Pit Command.
 *
 * Maps `loadPitBoard` (repairs / batteries / queue) onto Command `PitFlag[]`.
 * Empty until at least one of those flags is live. Turnaround minutes stay on
 * the Pit board and are never invented here (no DEMO 15-minute default).
 */

import type { PoolClient } from "@neondatabase/serverless";
import type { RepeatFailureAlert } from "../fmea/repeat-failures";
import {
  isPitBoardLive,
  loadPitBoard,
  type PitBatteryRow,
  type PitBoardFlags,
  type PitBoardGate,
  type PitBoardMember,
  type PitBoardPayload,
  type PitBoardStatus,
  type PitNextMatch,
  type PitQueueRow,
  type PitRepairRow,
  type PitTurnaround,
} from "../pit";
import type { PitFlag } from "./types";

export type CommandPitBoardInput = {
  status: PitBoardStatus;
  flags: PitBoardFlags;
  repairs: readonly PitRepairRow[];
  batteries: readonly PitBatteryRow[];
  queue: readonly PitQueueRow[];
  gate: PitBoardGate;
  turnaround: PitTurnaround | null;
  nextMatch: PitNextMatch | null;
  summary: {
    openIssues: number;
    overdueMaintenance: number;
    readyBatteries: number;
    activeBatteries: number;
  };
  repeatAlerts?: readonly RepeatFailureAlert[];
};

export type CommandPitFlagContext = {
  teamKey: string | null;
  teamNumber: number | null;
  orgId?: string;
};

function repairSeverity(severity: string): PitFlag["severity"] {
  if (severity === "safety" || severity === "disabled") return "critical";
  if (severity === "degraded") return "warning";
  return "info";
}

function repairTitle(repair: PitRepairRow): string {
  if (repair.severity === "safety") return `Safety issue · ${repair.subsystem}`;
  if (repair.severity === "disabled") return `Disabled · ${repair.subsystem}`;
  return `${repair.subsystem} repair open`;
}

function uniqueFlags(flags: PitFlag[]): PitFlag[] {
  const seen = new Set<string>();
  return flags.filter((flag) => {
    const key = `${flag.teamKey}:${flag.title}:${flag.severity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Pure adapter: Pit Command board → Event Day Command flags.
 * Returns [] when repairs / batteries / queue are all dark.
 */
export function pitFlagsFromPitBoard(
  board: CommandPitBoardInput,
  ctx: CommandPitFlagContext,
): PitFlag[] {
  if (board.status === "empty" || !isPitBoardLive(board.flags)) return [];

  const teamKey =
    ctx.teamKey ??
    (ctx.teamNumber != null ? `frc${ctx.teamNumber}` : ctx.orgId ? `org:${ctx.orgId}` : "org");
  const teamNumber = ctx.teamNumber;
  const flags: PitFlag[] = [];

  if (board.flags.repairs) {
    for (const repair of board.repairs) {
      flags.push({
        teamKey,
        teamNumber,
        severity: repairSeverity(repair.severity),
        title: repairTitle(repair),
        detail: repair.symptoms.trim() || `${repair.subsystem} is still open in Pit Command.`,
        evidence: [
          "Pit Command · robot_failures",
          repair.matchKey,
          repair.occurredAt,
        ]
          .filter((part): part is string => Boolean(part))
          .join(" · "),
        source: "pit",
      });
    }
  }

  if (board.flags.batteries) {
    const hrefEvidence = ctx.orgId
      ? `Pit Command · battery fleet · /batteries?orgId=${ctx.orgId}`
      : "Pit Command · battery fleet";
    if (!board.summary.activeBatteries) {
      flags.push({
        teamKey,
        teamNumber,
        severity: "critical",
        title: "No active battery on the rack",
        detail: "Every tracked pack is quarantined or retired — return a healthy pack to active before the next match.",
        evidence: hrefEvidence,
        source: "battery",
      });
    } else if (!board.summary.readyBatteries) {
      flags.push({
        teamKey,
        teamNumber,
        severity: "critical",
        title: "No match-ready battery",
        detail: "Active packs need a fresh reading before release.",
        evidence: hrefEvidence,
        source: "battery",
      });
    } else if (board.summary.readyBatteries === 1 && board.summary.activeBatteries > 1) {
      flags.push({
        teamKey,
        teamNumber,
        severity: "info",
        title: "Only one match-ready pack",
        detail: `${board.summary.readyBatteries} of ${board.summary.activeBatteries} active packs are in the ready band.`,
        evidence: hrefEvidence,
        source: "battery",
      });
    }

    const retireLabels = board.batteries
      .filter((pack) => pack.health === "retire")
      .map((pack) => pack.assetTag);
    if (retireLabels.length) {
      flags.push({
        teamKey,
        teamNumber,
        severity: "warning",
        title: `${retireLabels.length} pack${retireLabels.length === 1 ? "" : "s"} past retire threshold`,
        detail: `Internal resistance / wear on ${retireLabels.slice(0, 3).join(", ")}${retireLabels.length > 3 ? "…" : ""} — quarantine or replace before relying on them.`,
        evidence: hrefEvidence,
        source: "battery",
      });
    } else {
      const aging = board.batteries.filter((pack) => pack.health === "aging").length;
      if (aging > 0) {
        flags.push({
          teamKey,
          teamNumber,
          severity: "info",
          title: `${aging} aging pack${aging === 1 ? "" : "s"}`,
          detail: "Elevated IR, age, or cycles — prioritize fresher packs for match rotation.",
          evidence: hrefEvidence,
          source: "battery",
        });
      }
    }
  }

  if (board.flags.queue && board.summary.overdueMaintenance > 0) {
    const first = board.queue[0];
    flags.push({
      teamKey,
      teamNumber,
      severity: "warning",
      title: `${board.summary.overdueMaintenance} maintenance item${board.summary.overdueMaintenance === 1 ? "" : "s"} overdue`,
      detail: first ? `${first.subsystem}: ${first.task}` : "Pit Command has open queue items past due.",
      evidence: "Pit Command · maintenance_items",
      source: "maintenance",
    });
  }

  for (const alert of board.repeatAlerts ?? []) {
    flags.push({
      teamKey,
      teamNumber,
      severity: alert.level === "critical" || alert.level === "high" ? "critical" : "warning",
      title: alert.message,
      detail:
        alert.openCount > 0
          ? `${alert.openCount} still open in the FMEA log${alert.recentTitles[0] ? ` · ${alert.recentTitles[0]}` : ""}`
          : alert.recentTitles[0] ?? "Logged across events this season — confirm the root cause stuck.",
      evidence: `FMEA / failure log · ${alert.failureCount} entries · ${alert.href}`,
      source: "fmea_repeat",
    });
  }

  return uniqueFlags(flags).slice(0, 10);
}

/** One-function load for Event Day Command — delegates to `loadPitBoard`. */
export async function loadCommandPitFlags(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    member: PitBoardMember;
    teamKey?: string | null;
    now?: Date;
  },
): Promise<PitFlag[]> {
  const board: PitBoardPayload = await loadPitBoard(client, {
    orgId: input.orgId,
    userId: input.userId,
    member: input.member,
    now: input.now,
  });
  return pitFlagsFromPitBoard(board, {
    teamKey:
      input.teamKey ??
      (input.member.teamNumber != null ? `frc${input.member.teamNumber}` : `org:${input.orgId}`),
    teamNumber: input.member.teamNumber,
    orgId: input.orgId,
  });
}
