/**
 * Model context for a Bugbot pass.
 *
 * The code route used to call the adapter with `context: []` — the file in the
 * user message and nothing else. This builder always returns at least one item
 * (scanned files, prior findings, team knowledge, FMEA, or an honest coverage
 * note) so a caller cannot meter a turn with an empty context array.
 *
 * Files are file-capped before they become `github_file` items.
 */

import type { ContextItem } from "@vantage/agent";
import type { PoolClient } from "@neondatabase/serverless";
import { assertBugbotFilesForModel, enforceBugbotFileCap } from "./file-cap";

export type BugbotContextFile = { path: string; content: string };

export type BugbotContextFinding = {
  filePath?: string | null;
  finding: string;
  evidence?: string | null;
  severity?: string | null;
};

export type BugbotContextFmea = {
  subsystem: string;
  title: string;
  failureMode?: string | null;
};

export type BugbotModelContextInput = {
  files?: BugbotContextFile[];
  priorFindings?: BugbotContextFinding[];
  knowledge?: string | null;
  fmea?: BugbotContextFmea[];
  githubRepo?: string | null;
  githubSha?: string | null;
  reviewedFiles?: string[];
  /** Written cockpit notes. Empty / missing is omitted — never a canned brief. */
  customInstructions?: string | null;
  /** Honest repo overview from README / WPILib prefs / tree paths. */
  repoOverview?: string | null;
};

const CONTEXT_FILE_CHARS = 8_000;
const CONTEXT_KNOWLEDGE_CHARS = 4_000;

function clip(value: string, max: number): string {
  const text = value.replace(/\r\n/g, "\n").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…(truncated)`;
}

function coverageNote(input: {
  included: number;
  deferred: number;
  cap: number;
  repo?: string | null;
  sha?: string | null;
  reviewedFiles?: string[];
}): string {
  const pin = [
    input.repo?.trim() ? `repo ${input.repo.trim()}` : null,
    input.sha ? `sha ${input.sha}` : null,
  ]
    .filter(Boolean)
    .join(" @ ");
  const reviewed = input.reviewedFiles?.filter(Boolean).slice(0, 24) ?? [];
  const lines = [
    "Bugbot coverage (authoritative — do not invent files or findings outside this pass):",
    pin ? `- Target: ${pin}` : "- Target: editor buffer (no repository pin)",
    `- Files in this context: ${input.included} (file-cap ${input.cap})`,
  ];
  if (input.deferred > 0) {
    lines.push(`- Deferred past the file-cap: ${input.deferred} robot-code file(s)`);
  }
  if (reviewed.length) {
    lines.push(`- Reviewed paths: ${reviewed.join(", ")}`);
  }
  if (input.included === 0) {
    lines.push("- No readable robot-code reached this pass. Do not invent DEMO bugs.");
  }
  return lines.join("\n");
}

function clipInstructions(value: string | null | undefined): string {
  return clip(value ?? "", 500);
}

/**
 * Build adapter context for a Bugbot turn. Never returns [].
 *
 * When there are files, they are capped first. When there is nothing else to
 * inject, the coverage note still occupies the array so `context: []` cannot
 * happen at this layer.
 */
export function buildBugbotModelContext(input: BugbotModelContextInput): ContextItem[] {
  const capped = enforceBugbotFileCap(input.files ?? []);
  const items: ContextItem[] = [];

  items.push({
    type: "module_data",
    id: "bugbot-coverage",
    content: coverageNote({
      included: capped.included.length,
      deferred: capped.deferred.length,
      cap: capped.cap,
      repo: input.githubRepo,
      sha: input.githubSha,
      reviewedFiles: input.reviewedFiles?.length ? input.reviewedFiles : capped.included.map((file) => file.path),
    }),
    importance: 980,
  });

  const instructions = clipInstructions(input.customInstructions);
  if (instructions) {
    items.push({
      type: "module_data",
      id: "bugbot-custom-instructions",
      content: `Team Bugbot instructions (follow these; do not invent extras):\n${instructions}`,
      importance: 960,
    });
  }

  const overview = clip(input.repoOverview ?? "", 1_200);
  if (overview) {
    items.push({
      type: "module_data",
      id: "bugbot-repo-overview",
      content: `What this repository looks like (from files the scan actually read — do not invent a year, team, or mechanism beyond this):\n${overview}`,
      importance: 940,
    });
  }

  for (const file of capped.included) {
    const body = clip(file.content, CONTEXT_FILE_CHARS);
    if (!body) continue;
    items.push({
      type: "github_file",
      id: `bugbot-file:${file.path}`,
      content: `[Bugbot file] ${file.path}\n\`\`\`\n${body}\n\`\`\``,
      importance: 900,
    });
  }

  const findings = (input.priorFindings ?? [])
    .filter((row) => row.finding.trim())
    .slice(0, 20)
    .map((row) => {
      const where = row.filePath?.trim() ? `${row.filePath.trim()}: ` : "";
      const evidence = row.evidence?.trim() ? ` (evidence: ${row.evidence.trim().slice(0, 200)})` : "";
      return `- ${row.severity ?? "medium"} ${where}${row.finding.trim()}${evidence}`;
    });
  if (findings.length) {
    items.push({
      type: "module_data",
      id: "bugbot-prior-findings",
      content: `Prior grounded Bugbot findings on this scope:\n${findings.join("\n")}`,
      importance: 850,
    });
  }

  const knowledge = clip(input.knowledge ?? "", CONTEXT_KNOWLEDGE_CHARS);
  if (knowledge) {
    items.push({
      type: "team_memory",
      id: "bugbot-team-knowledge",
      content: `Team knowledge (do not invent beyond this document):\n${knowledge}`,
      importance: 800,
    });
  }

  const fmea = (input.fmea ?? [])
    .filter((row) => row.title.trim() && row.subsystem.trim())
    .slice(0, 12)
    .map((row) => {
      const mode = row.failureMode?.trim() ? ` — ${row.failureMode.trim()}` : "";
      return `- ${row.subsystem.trim()}: ${row.title.trim()}${mode}`;
    });
  if (fmea.length) {
    items.push({
      type: "module_data",
      id: "bugbot-fmea",
      content: `Open FMEA failures for subsystems this code may control:\n${fmea.join("\n")}`,
      importance: 750,
    });
  }

  return assertBugbotModelContext(items);
}

/** Throws if a caller is about to send `context: []`. */
export function assertBugbotModelContext(items: ContextItem[] | null | undefined): ContextItem[] {
  if (!items?.length) {
    throw new Error("Bugbot refuses to send empty model context");
  }
  return items;
}

/**
 * Files that will become model context, after the file-cap. Empty after the
 * cap is a hard error — same rule as `assertBugbotFilesForModel`.
 */
export function cappedBugbotContextFiles(files: BugbotContextFile[]): BugbotContextFile[] {
  return assertBugbotFilesForModel(enforceBugbotFileCap(files));
}

export type BugbotLoadedContextSources = {
  knowledge: string | null;
  priorFindings: BugbotContextFinding[];
  fmea: BugbotContextFmea[];
};

/** Load real org rows that belong in Bugbot context. Skips empty / disabled sources. */
export async function loadBugbotContextSources(
  client: PoolClient,
  input: { orgId: string; scopeKey?: string | null },
): Promise<BugbotLoadedContextSources> {
  const knowledge = await client.query<{ content: string; enabled: boolean }>(
    `SELECT content, enabled FROM team_knowledge WHERE org_id = $1::uuid LIMIT 1`,
    [input.orgId],
  );
  const knowledgeText =
    knowledge.rows[0]?.enabled && knowledge.rows[0].content.trim() ? knowledge.rows[0].content : null;

  const priorFindings: BugbotContextFinding[] = [];
  if (input.scopeKey?.trim()) {
    const findings = await client.query<BugbotContextFinding>(
      `SELECT file_path AS "filePath", finding, evidence, severity
         FROM code_bugbot_findings
        WHERE org_id = $1::uuid AND scope_key = $2 AND resolved_at IS NULL
        ORDER BY last_seen_at DESC
        LIMIT 20`,
      [input.orgId, input.scopeKey.trim()],
    );
    priorFindings.push(...findings.rows);
  }

  const fmea = await client.query<BugbotContextFmea>(
    `SELECT subsystem_name AS subsystem, title, failure_mode AS "failureMode"
       FROM fmea_failures
      WHERE org_id = $1::uuid AND status IN ('open', 'fixing')
      ORDER BY occurred_at DESC
      LIMIT 12`,
    [input.orgId],
  );

  return {
    knowledge: knowledgeText,
    priorFindings,
    fmea: fmea.rows,
  };
}
