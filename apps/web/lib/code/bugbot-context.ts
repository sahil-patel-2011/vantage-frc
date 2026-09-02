/**
 * Bugbot context assembler.
 *
 * The model reviewing a chunk should know what THIS team already knows: the
 * FMEA failures that are still open (a finding that explains "brownout during
 * climb" is worth more than a style nit), the findings already on record for
 * the files in the pass, the ones the team dismissed as deliberate, the robot's
 * subsystem spec sheet, and the tuning constants they logged — so a literal in
 * code that disagrees with the logbook gets called out.
 *
 * `assembleBugbotContext` is pure and budgeted (~6k chars). `loadBugbotTeamContext`
 * is the one DB loader; it runs on the request PoolClient from withRls with
 * parameterized SQL, like every other product read.
 */
import type { PoolClient } from "@neondatabase/serverless";
import { calendarSeasonYear, type ContextItem } from "@vantage/agent";

export const BUGBOT_CONTEXT_MAX_CHARS = 6000;

export type BugbotPriorFinding = {
  filePath: string;
  rule: string;
  severity: string;
  finding: string;
  line: number;
  seenCount?: number;
};

export type BugbotDismissedFinding = {
  fingerprint: string;
  filePath: string | null;
  rule: string | null;
  reason: string;
};

export type BugbotFmeaFailure = {
  subsystemName: string;
  title: string;
  failureMode: string;
  status: string;
  context: string;
  occurrence: number;
  severity: number;
  detection: number;
  rootCause: string | null;
  fix: string | null;
};

export type BugbotTuningConstant = {
  subsystem: string;
  name: string;
  value: string;
  unit: string;
  category: string;
};

export type BugbotSubsystem = {
  name: string;
  category: string;
  motorType: string;
  motorCount: number | null;
  gearReduction: string | null;
  wheelDiameterIn: string | null;
};

export type BugbotTeamContext = {
  seasonYear: number;
  fmeaFailures: BugbotFmeaFailure[];
  tuningConstants: BugbotTuningConstant[];
  subsystems: BugbotSubsystem[];
};

export type BugbotContextInput = {
  /** Files in this pass — prior findings are only attached for these. */
  reviewedFiles: string[];
  priorFindings: BugbotPriorFinding[];
  dismissed: BugbotDismissedFinding[];
  fmeaFailures: BugbotFmeaFailure[];
  tuningConstants: BugbotTuningConstant[];
  subsystems: BugbotSubsystem[];
  seasonYear?: number | null;
};

const LINE_MAX = 180;

function clip(value: string | null | undefined, max = LINE_MAX): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function normalisePath(path: string | null | undefined): string {
  return String(path ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .toLowerCase();
}

type Section = {
  id: string;
  importance: number;
  header: string;
  lines: string[];
};

function fmeaSection(failures: BugbotFmeaFailure[], seasonYear: number | null | undefined): Section | null {
  if (!failures.length) return null;
  const ranked = [...failures].sort(
    (a, b) => b.occurrence * b.severity * b.detection - a.occurrence * a.severity * a.detection,
  );
  return {
    id: "bugbot:fmea-open-failures",
    importance: 0.95,
    header: `Known OPEN robot failures from this team's FMEA log${seasonYear ? ` (season ${seasonYear})` : ""}. A code finding that explains or contradicts one of these is HIGH priority — name the failure:`,
    lines: ranked.map((item) => {
      const rpn = item.occurrence * item.severity * item.detection;
      const parts = [
        `[RPN ${rpn}] ${clip(item.subsystemName, 40)} · "${clip(item.title, 80)}"`,
        item.failureMode ? `mode: ${clip(item.failureMode, 80)}` : null,
        `status: ${item.status}`,
        item.context ? `seen: ${item.context}` : null,
        item.rootCause ? `root cause: ${clip(item.rootCause, 100)}` : null,
      ].filter(Boolean);
      return `- ${parts.join(" · ")}`;
    }),
  };
}

function priorFindingsSection(findings: BugbotPriorFinding[], reviewedFiles: string[]): Section | null {
  const reviewed = new Set(reviewedFiles.map(normalisePath));
  const relevant = findings.filter((item) => reviewed.has(normalisePath(item.filePath)));
  if (!relevant.length) return null;
  return {
    id: "bugbot:prior-open-findings",
    importance: 0.9,
    header:
      "Open Bugbot findings already on record for the files in this pass. Say whether each is still present; do not re-derive them as new:",
    lines: relevant.map(
      (item) =>
        `- ${item.filePath}:${item.line} ${item.rule} (${item.severity}${item.seenCount && item.seenCount > 1 ? `, seen ${item.seenCount}×` : ""}): ${clip(item.finding, 110)}`,
    ),
  };
}

function dismissedSection(dismissed: BugbotDismissedFinding[]): Section | null {
  if (!dismissed.length) return null;
  return {
    id: "bugbot:dismissed-findings",
    importance: 0.85,
    header: "Findings the team dismissed as deliberate — do NOT re-report these:",
    lines: dismissed.map(
      (item) =>
        `- ${item.filePath ?? "(any file)"} · ${item.rule ?? "model finding"} · reason: ${clip(item.reason, 100)}`,
    ),
  };
}

function subsystemsSection(subsystems: BugbotSubsystem[]): Section | null {
  if (!subsystems.length) return null;
  return {
    id: "bugbot:robot-subsystems",
    importance: 0.6,
    header: "Robot subsystems (team spec sheet) — check motor counts, reductions, and wheel sizes in code against these:",
    lines: subsystems.map((item) => {
      const parts = [
        `${clip(item.name, 40)} (${item.category})`,
        item.motorCount != null || item.motorType
          ? `${item.motorCount != null ? `${item.motorCount}× ` : ""}${clip(item.motorType, 30) || "motor"}`
          : null,
        item.gearReduction ? `${item.gearReduction}:1` : null,
        item.wheelDiameterIn ? `${item.wheelDiameterIn} in wheels` : null,
      ].filter(Boolean);
      return `- ${parts.join(" · ")}`;
    }),
  };
}

function tuningSection(constants: BugbotTuningConstant[]): Section | null {
  if (!constants.length) return null;
  return {
    id: "bugbot:tuning-constants",
    importance: 0.5,
    header: "Logged tuning constants — flag code literals that disagree with the logbook:",
    lines: constants.map(
      (item) =>
        `- ${item.subsystem ? `${clip(item.subsystem, 30)}/` : ""}${clip(item.name, 40)} = ${clip(item.value, 30)}${item.unit ? ` ${item.unit}` : ""} (${item.category})`,
    ),
  };
}

/**
 * Build the context items for one Bugbot pass. Sections are added in priority
 * order and lines are dropped from the tail once the character budget is
 * spent — never silently, a section that was cut says how many more it had.
 */
export function assembleBugbotContext(
  input: BugbotContextInput,
  options?: { maxChars?: number },
): ContextItem[] {
  const maxChars = Math.max(400, options?.maxChars ?? BUGBOT_CONTEXT_MAX_CHARS);
  const sections = [
    fmeaSection(input.fmeaFailures, input.seasonYear),
    priorFindingsSection(input.priorFindings, input.reviewedFiles),
    dismissedSection(input.dismissed),
    subsystemsSection(input.subsystems),
    tuningSection(input.tuningConstants),
  ].filter((section): section is Section => section != null);

  const items: ContextItem[] = [];
  let used = 0;
  for (const section of sections) {
    const remaining = maxChars - used;
    // Header plus at least one line, or the section is not worth attaching.
    if (remaining < section.header.length + 40) continue;
    const kept: string[] = [];
    let size = section.header.length + 1;
    for (const line of section.lines) {
      if (size + line.length + 1 > remaining - 24) break;
      kept.push(line);
      size += line.length + 1;
    }
    if (!kept.length) continue;
    const dropped = section.lines.length - kept.length;
    const content = [section.header, ...kept, ...(dropped > 0 ? [`(and ${dropped} more not shown)`] : [])].join(
      "\n",
    );
    items.push({ type: "module_data", id: section.id, content, importance: section.importance });
    used += content.length;
  }
  return items;
}

/** Total characters a context list will add to the prompt. */
export function bugbotContextChars(items: ContextItem[]): number {
  return items.reduce((sum, item) => sum + item.content.length, 0);
}

/**
 * The org's season from its active event, else the calendar FRC season.
 * Every read below is scoped to that season so last year's robot does not
 * explain this year's code.
 */
async function resolveOrgSeasonYear(client: PoolClient, orgId: string): Promise<number> {
  const result = await client.query<{ year: number | null }>(
    `SELECT e.year
       FROM org_active_context c
       LEFT JOIN events_ref e ON e.event_key = c.active_event_key
      WHERE c.org_id = $1::uuid
      LIMIT 1`,
    [orgId],
  );
  const year = result.rows[0]?.year;
  return typeof year === "number" && year >= 1992 && year <= 2100 ? year : calendarSeasonYear();
}

/** The one DB loader: open FMEA failures, tuning constants, and subsystems for the org's season. */
export async function loadBugbotTeamContext(client: PoolClient, orgId: string): Promise<BugbotTeamContext> {
  const seasonYear = await resolveOrgSeasonYear(client, orgId);
  const [fmea, tuning, subsystems] = await Promise.all([
    client.query<BugbotFmeaFailure>(
      `SELECT subsystem_name AS "subsystemName", title, failure_mode AS "failureMode", status, context,
              occurrence, severity, detection, root_cause AS "rootCause", fix
         FROM fmea_failures
        WHERE org_id = $1::uuid AND season_year = $2::int AND status = ANY($3::text[])
        ORDER BY (occurrence * severity * detection) DESC, occurred_at DESC
        LIMIT 12`,
      [orgId, seasonYear, ["open", "fixing"]],
    ),
    client.query<BugbotTuningConstant>(
      `SELECT subsystem, name, value, unit, category
         FROM tuning_constants
        WHERE org_id = $1::uuid AND season_year = $2::int
        ORDER BY subsystem, category, name
        LIMIT 40`,
      [orgId, seasonYear],
    ),
    client.query<BugbotSubsystem>(
      `SELECT name, category, motor_type AS "motorType", motor_count AS "motorCount",
              gear_reduction::text AS "gearReduction", wheel_diameter_in::text AS "wheelDiameterIn"
         FROM robot_subsystems
        WHERE org_id = $1::uuid AND season_year = $2::int
        ORDER BY category, name
        LIMIT 16`,
      [orgId, seasonYear],
    ),
  ]);
  return {
    seasonYear,
    fmeaFailures: fmea.rows,
    tuningConstants: tuning.rows,
    subsystems: subsystems.rows,
  };
}
