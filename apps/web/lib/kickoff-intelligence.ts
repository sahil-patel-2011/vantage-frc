// Kickoff game-release intelligence — pure structuring + pipeline helpers.
// No network, React, or DB clients here. The API meters AI and persists rows.

import { createHash } from "node:crypto";
import type { Phase } from "./kickoff";

export const KICKOFF_INTELLIGENCE_MODEL = "vantage-kickoff-intelligence-v1";
export const KICKOFF_ADVICE_LABEL = "MODEL" as const;

export type IntelligenceSourceKind = "manual" | "transcript" | "url";

export type GamePiece = { name: string; notes: string };
export type FieldElement = { name: string; notes: string };
export type ScoringDraft = {
  action: string;
  phase: Phase;
  points: number | null;
  notes: string;
};
export type DesignDirection = {
  capability: string;
  rationale: string;
  weight: number;
  adviceLabel: typeof KICKOFF_ADVICE_LABEL;
};

export type GameIntelligenceSummary = {
  gameName: string | null;
  seasonYear: number;
  overview: string;
  gamePieces: GamePiece[];
  fieldElements: FieldElement[];
  scoring: ScoringDraft[];
  howToPlay: string[];
  constraints: string[];
  openQuestions: string[];
  designDirections: DesignDirection[];
  provenance: {
    provider: string;
    model: string;
    sourceKinds: IntelligenceSourceKind[];
    adviceLabel: typeof KICKOFF_ADVICE_LABEL;
    disclaimer: string;
  };
};

export type StrategyAdviceBundle = {
  message: string;
  localText: string;
  designPriorities: DesignDirection[];
  historicalPatterns: string[];
  adviceLabel: typeof KICKOFF_ADVICE_LABEL;
};

export type CadBriefSeed = {
  title: string;
  request: string;
  sources: Array<{
    type:
      | "private_memory"
      | "team_memory"
      | "module_data"
      | "module_fact"
      | "artifact"
      | "task"
      | "github_file"
      | "vscode_selection";
    id: string;
    content: string;
    importance: number;
    classification: "researched_claim" | "model_inference" | "hard_metric" | "scout_observation";
  }>;
};

export type IntelligenceIngest = {
  seasonYear: number;
  manualText?: string | null;
  transcriptText?: string | null;
  sourceUrl?: string | null;
};

const DISCLAIMER =
  "Labeled MODEL advice grounded in the uploaded manual/transcript and historical priority patterns — not DEMO stats or fabricated match metrics.";

function cleanLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripBullet(line: string): string {
  return line.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "").trim();
}

function sectionBody(text: string, headings: string[]): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const headingRe = new RegExp(`^#{1,3}\\s*(${headings.join("|")})\\b`, "i");
  let collecting = false;
  const body: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#{1,3}\s+/.test(line)) {
      if (headingRe.test(line)) {
        collecting = true;
        continue;
      }
      if (collecting) break;
    }
    if (collecting && line) body.push(line);
  }
  return body.join("\n");
}

function bulletsFrom(text: string, max = 24): string[] {
  const out: string[] = [];
  for (const line of cleanLines(text)) {
    const item = stripBullet(line);
    if (!item || item.length < 3) continue;
    if (/^#{1,3}\s/.test(line)) continue;
    out.push(item.slice(0, 400));
    if (out.length >= max) break;
  }
  return out;
}

function detectPhase(text: string): Phase {
  const lower = text.toLowerCase();
  if (/\b(end\s*game|endgame|climb|hang|park)\b/.test(lower)) return "endgame";
  if (/\b(auto|autonomous|auton)\b/.test(lower)) return "auto";
  return "teleop";
}

function parsePoints(text: string): number | null {
  const match = text.match(/\b(\d{1,3}(?:\.\d)?)\s*(?:pts?|points?)\b/i) ?? text.match(/\b(?:worth|scores?|awards?)\s+(\d{1,3}(?:\.\d)?)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0 || value > 1000) return null;
  return Math.round(value * 10) / 10;
}

function parseNamedItems(text: string, max = 16): Array<{ name: string; notes: string }> {
  const items: Array<{ name: string; notes: string }> = [];
  for (const line of bulletsFrom(text, max * 2)) {
    const split = line.match(/^([^:—-]{2,80})\s*[:—-]\s*(.+)$/);
    if (split) {
      items.push({ name: split[1]!.trim().slice(0, 80), notes: split[2]!.trim().slice(0, 300) });
    } else {
      items.push({ name: line.slice(0, 80), notes: "" });
    }
    if (items.length >= max) break;
  }
  return items;
}

function parseScoring(text: string, max = 24): ScoringDraft[] {
  const drafts: ScoringDraft[] = [];
  for (const line of bulletsFrom(text, max * 2)) {
    const points = parsePoints(line);
    const action = line
      .replace(/\b\d{1,3}(?:\.\d)?\s*(?:pts?|points?)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/^[-–—:]\s*/, "")
      .trim()
      .slice(0, 160);
    if (!action) continue;
    drafts.push({
      action,
      phase: detectPhase(line),
      points,
      notes: points == null ? "Points not stated in source — confirm in the manual." : "",
    });
    if (drafts.length >= max) break;
  }
  return drafts;
}

function extractQuestions(combined: string, max = 16): string[] {
  const questions: string[] = [];
  const fromSection = bulletsFrom(sectionBody(combined, ["open questions", "questions", "rules questions", "q&a"]), max);
  for (const item of fromSection) {
    questions.push(item.endsWith("?") ? item : `${item}?`);
    if (questions.length >= max) return questions;
  }
  for (const line of cleanLines(combined)) {
    const item = stripBullet(line);
    if (!item.endsWith("?") || item.length < 12) continue;
    if (questions.some((q) => q.toLowerCase() === item.toLowerCase())) continue;
    questions.push(item.slice(0, 500));
    if (questions.length >= max) break;
  }
  return questions;
}

function inferDesignDirections(summary: Omit<GameIntelligenceSummary, "designDirections" | "provenance">): DesignDirection[] {
  const directions: DesignDirection[] = [];
  const push = (capability: string, rationale: string, weight: number) => {
    if (directions.some((d) => d.capability.toLowerCase() === capability.toLowerCase())) return;
    directions.push({
      capability: capability.slice(0, 160),
      rationale: rationale.slice(0, 500),
      weight: Math.min(5, Math.max(1, weight)),
      adviceLabel: KICKOFF_ADVICE_LABEL,
    });
  };

  for (const piece of summary.gamePieces.slice(0, 4)) {
    push(
      `${piece.name} acquisition / handling`,
      `Game piece "${piece.name}" appears in the release materials${piece.notes ? `: ${piece.notes}` : ""}. Reliable pickup and control usually gates every scoring cycle.`,
      5,
    );
  }

  const scored = [...summary.scoring].sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
  for (const row of scored.slice(0, 5)) {
    const weight = row.points != null && row.points >= 5 ? 5 : row.phase === "endgame" ? 4 : 3;
    push(
      `Score: ${row.action}`,
      row.points != null
        ? `Source lists ~${row.points} points in ${row.phase}. Treat as a candidate commit until cycle-time estimates are filled in.`
        : `Scoring path called out in ${row.phase}; confirm point value and cycle time before locking CAD.`,
      weight,
    );
  }

  for (const constraint of summary.constraints.slice(0, 4)) {
    push(
      `Respect constraint: ${constraint.slice(0, 80)}`,
      "Hard rule/constraint from the manual or kickoff — design envelopes and mechanisms around this before optimizing score rate.",
      4,
    );
  }

  if (!directions.length) {
    push(
      "Read the scoring table end-to-end",
      "No explicit scoring lines were extracted yet — walk the manual scoring page and enter actions before committing mechanisms.",
      3,
    );
  }

  return directions.slice(0, 12);
}

function overviewFrom(manual: string, transcript: string, seasonYear: number): string {
  const overviewSection =
    sectionBody(manual, ["overview", "game overview", "the game", "introduction"]) ||
    sectionBody(transcript, ["overview", "game overview", "the game", "introduction"]);
  if (overviewSection) {
    return bulletsFrom(overviewSection, 6).join(" ").slice(0, 1200) || overviewSection.slice(0, 1200);
  }
  const firstManual = cleanLines(manual).slice(0, 4).join(" ");
  const firstTranscript = cleanLines(transcript).slice(0, 4).join(" ");
  const parts = [
    firstManual || firstTranscript
      ? (firstManual || firstTranscript).slice(0, 700)
      : `No overview paragraph was found in the ${seasonYear} materials yet.`,
  ];
  if (firstManual && firstTranscript) parts.push(`Kickoff transcript adds: ${firstTranscript.slice(0, 400)}`);
  return parts.join(" ").slice(0, 1200);
}

function detectGameName(manual: string, transcript: string, seasonYear: number): string | null {
  const hay = `${manual}\n${transcript}`;
  const named = hay.match(/\b(?:game|challenge)\s*(?:name|title)?\s*[:—-]\s*([A-Z][A-Za-z0-9 '-]{2,60})/);
  if (named?.[1]) return named[1].trim();
  const quoted = hay.match(/\b(?:called|named)\s+[“"]([^”"]{3,60})[”"]/i);
  if (quoted?.[1]) return quoted[1].trim();
  const unquoted = hay.match(/\b(?:called|named)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3})\b/);
  if (unquoted?.[1]) return unquoted[1].trim();
  const emdash = hay.match(/Game Manual\s*[—-]\s*([A-Z][A-Za-z0-9 '-]{2,60})/i);
  if (emdash?.[1]) return emdash[1].trim();
  const yearLine = cleanLines(hay).find((line) => new RegExp(String(seasonYear)).test(line) && /frc|game|manual/i.test(line));
  return yearLine ? yearLine.slice(0, 80) : null;
}

/** SHA-256 of normalized source text for provenance / dedupe. */
export function sourceChecksum(input: IntelligenceIngest): string {
  const payload = [
    `year:${input.seasonYear}`,
    `manual:${(input.manualText ?? "").trim()}`,
    `transcript:${(input.transcriptText ?? "").trim()}`,
    `url:${(input.sourceUrl ?? "").trim()}`,
  ].join("\n");
  return createHash("sha256").update(payload).digest("hex");
}

export function hasIntelligenceSource(input: IntelligenceIngest): boolean {
  return Boolean(
    (input.manualText && input.manualText.trim()) ||
      (input.transcriptText && input.transcriptText.trim()) ||
      (input.sourceUrl && input.sourceUrl.trim()),
  );
}

/**
 * Deterministic structured summary from manual + kickoff transcript text.
 * Safe for unit tests (no network). Points/metrics only when present in source text.
 */
export function structureGameIntelligence(input: IntelligenceIngest): GameIntelligenceSummary {
  const manual = (input.manualText ?? "").trim();
  const transcript = (input.transcriptText ?? "").trim();
  const combined = [manual, transcript].filter(Boolean).join("\n\n");
  const sourceKinds: IntelligenceSourceKind[] = [];
  if (manual) sourceKinds.push("manual");
  if (transcript) sourceKinds.push("transcript");
  if (input.sourceUrl?.trim()) sourceKinds.push("url");

  const scoringSection =
    sectionBody(combined, ["scoring", "score", "points", "point values"]) ||
    combined
      .split("\n")
      .filter((line) => /\b(point|pts|score)\b/i.test(line))
      .join("\n");

  const piecesSection =
    sectionBody(combined, ["game pieces", "game piece", "objects", "elements", "scoring objects"]) ||
    combined
      .split("\n")
      .filter((line) => /\b(game piece|coral|algae|note|cone|cube|ring|ball|tube)\b/i.test(line))
      .join("\n");

  const fieldSection = sectionBody(combined, ["field", "field elements", "arena", "zones"]);
  const howSection = sectionBody(combined, ["how to play", "gameplay", "match play", "teleop", "autonomous"]);
  const constraintSection =
    sectionBody(combined, ["constraints", "rules", "robot rules", "limitations", "inspection"]) ||
    combined
      .split("\n")
      .filter((line) => /\b(must not|may not|cannot|weight|size|extension|foul)\b/i.test(line))
      .join("\n");

  const base = {
    gameName: detectGameName(manual, transcript, input.seasonYear),
    seasonYear: input.seasonYear,
    overview: overviewFrom(manual, transcript, input.seasonYear),
    gamePieces: parseNamedItems(piecesSection, 12),
    fieldElements: parseNamedItems(fieldSection, 12),
    scoring: parseScoring(scoringSection, 24),
    howToPlay: bulletsFrom(howSection || transcript || manual, 12),
    constraints: bulletsFrom(constraintSection, 16),
    openQuestions: extractQuestions(combined, 16),
  };

  const designDirections = inferDesignDirections(base);

  return {
    ...base,
    designDirections,
    provenance: {
      provider: "local",
      model: KICKOFF_INTELLIGENCE_MODEL,
      sourceKinds,
      adviceLabel: KICKOFF_ADVICE_LABEL,
      disclaimer: DISCLAIMER,
    },
  };
}

/**
 * Strategy bundle for the kickoff→design handoff.
 * Uses the structured summary plus optional prior-season priority labels (real org data only).
 */
export function buildStrategyFromIntelligence(input: {
  summary: GameIntelligenceSummary;
  priorCapabilities?: string[];
}): StrategyAdviceBundle {
  const { summary } = input;
  const designPriorities = summary.designDirections;
  const historicalPatterns: string[] = [];
  const prior = (input.priorCapabilities ?? []).map((value) => value.trim()).filter(Boolean);

  if (prior.length) {
    const overlap = designPriorities.filter((direction) =>
      prior.some((capability) => capability.toLowerCase().includes(direction.capability.toLowerCase().slice(0, 24))),
    );
    historicalPatterns.push(
      `Prior seasons in this workspace emphasized: ${prior.slice(0, 8).join("; ")}.`,
    );
    if (overlap.length) {
      historicalPatterns.push(
        `Recurring themes vs this release: ${overlap.map((item) => item.capability).join("; ")}. Reuse what worked; do not assume old point values still apply.`,
      );
    } else {
      historicalPatterns.push(
        "This release’s extracted directions do not closely match prior capability labels — treat past mechanisms as optional references, not carry-over scores.",
      );
    }
  } else {
    historicalPatterns.push(
      "No prior design_priorities rows were available for pattern matching — advice is grounded only in this season’s release materials.",
    );
  }

  const topScoring = [...summary.scoring]
    .filter((row) => row.points != null)
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    .slice(0, 3);
  const lines: string[] = [];
  lines.push(
    summary.gameName
      ? `${summary.seasonYear} “${summary.gameName}” — design priorities from release materials (${KICKOFF_ADVICE_LABEL}).`
      : `${summary.seasonYear} game release — design priorities from release materials (${KICKOFF_ADVICE_LABEL}).`,
  );
  if (topScoring.length) {
    lines.push(
      `Highest stated point actions: ${topScoring.map((row) => `${row.action} (~${row.points})`).join("; ")}. Fill cycle-time estimates next so pts/sec can rank them.`,
    );
  } else {
    lines.push("No numeric point values were extracted — enter scoring actions manually before locking commits.");
  }
  if (summary.gamePieces.length) {
    lines.push(`Primary objects: ${summary.gamePieces.map((piece) => piece.name).join(", ")}.`);
  }
  if (summary.constraints.length) {
    lines.push(`Hard constraints to respect early: ${summary.constraints.slice(0, 3).join("; ")}.`);
  }
  if (summary.openQuestions.length) {
    lines.push(`Open questions still blocking certainty: ${summary.openQuestions.slice(0, 3).join(" ")}`);
  }
  lines.push(...historicalPatterns);
  lines.push(
    `Suggested first commits: ${designPriorities
      .slice(0, 5)
      .map((direction) => `${direction.capability} (w${direction.weight})`)
      .join("; ")}.`,
  );

  return {
    message: `Act as a kickoff strategist for ${summary.seasonYear}: convert the release summary into design priorities and CAD directions without inventing match stats.`,
    localText: lines.join(" "),
    designPriorities,
    historicalPatterns,
    adviceLabel: KICKOFF_ADVICE_LABEL,
  };
}

/** CAD module brief seed — Onshape/Fusion paths consume this via createBriefJob. */
export function buildCadBriefFromIntelligence(input: {
  summary: GameIntelligenceSummary;
  strategy: StrategyAdviceBundle;
  intelligenceId?: string;
}): CadBriefSeed {
  const { summary, strategy } = input;
  const title = summary.gameName
    ? `${summary.seasonYear} ${summary.gameName} — kickoff design brief`
    : `${summary.seasonYear} kickoff design brief`;

  const requirements = strategy.designPriorities.slice(0, 8).map((direction) => direction.capability);
  const constraints = summary.constraints.slice(0, 8);
  const scoringTasks = summary.scoring.slice(0, 8).map((row) =>
    row.points != null ? `${row.action} (${row.phase}, ~${row.points} pts)` : `${row.action} (${row.phase})`,
  );

  const request = [
    `${title} [${KICKOFF_ADVICE_LABEL}]`,
    "",
    "Overview:",
    summary.overview,
    "",
    "Best design directions (from release summary + historical priority patterns):",
    ...strategy.designPriorities.slice(0, 8).map((direction, index) => `${index + 1}. ${direction.capability} — ${direction.rationale}`),
    "",
    "Scoring tasks to support:",
    ...scoringTasks.map((task) => `- ${task}`),
    "",
    "Constraints:",
    ...(constraints.length ? constraints.map((item) => `- ${item}`) : ["- Confirm robot rules from the official manual before freezing envelopes."]),
    "",
    "Open questions:",
    ...(summary.openQuestions.length
      ? summary.openQuestions.slice(0, 6).map((item) => `- ${item}`)
      : ["- None extracted — still verify ambiguous rules with mentors."]),
    "",
    DISCLAIMER,
  ].join("\n");

  const sources: CadBriefSeed["sources"] = [
    {
      type: "module_data",
      id: input.intelligenceId ? `kickoff-intel:${input.intelligenceId}` : `kickoff-intel:${summary.seasonYear}`,
      content: JSON.stringify({
        gameName: summary.gameName,
        overview: summary.overview,
        gamePieces: summary.gamePieces,
        scoring: summary.scoring,
        constraints: summary.constraints,
        adviceLabel: KICKOFF_ADVICE_LABEL,
      }),
      importance: 1,
      classification: "researched_claim",
    },
    {
      type: "module_data",
      id: `kickoff-strategy:${summary.seasonYear}`,
      content: strategy.localText,
      importance: 0.9,
      classification: "model_inference",
    },
    ...requirements.slice(0, 6).map((capability, index) => ({
      type: "module_data" as const,
      id: `kickoff-direction:${index}`,
      content: capability,
      importance: 0.8,
      classification: "model_inference" as const,
    })),
  ];

  return { title, request, sources };
}

export function excerpt(text: string | null | undefined, max = 8_000): string {
  const value = (text ?? "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`;
}

// ---------------------------------------------------------------------------
// Action parsing for the intelligence API
// ---------------------------------------------------------------------------

function requiredText(value: unknown, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value: unknown, max: number) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new Error(`Value must be ${max} characters or fewer`);
  return text;
}

function uuid(value: unknown, label: string) {
  const text = requiredText(value, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function yearValue(value: unknown) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1992 || year > 2100) {
    throw new Error("Season year must be a whole number between 1992 and 2100");
  }
  return year;
}

export type KickoffIntelligenceAction =
  | {
      action: "analyze";
      orgId: string;
      seasonYear: number;
      manualText: string | null;
      transcriptText: string | null;
      sourceUrl: string | null;
      createCadBrief: boolean;
      applyDrafts: boolean;
    }
  | { action: "apply"; orgId: string; id: string }
  | { action: "create_cad_brief"; orgId: string; id: string }
  | { action: "delete"; orgId: string; id: string };

export function parseKickoffIntelligenceAction(input: unknown): KickoffIntelligenceAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid kickoff intelligence action");
  }
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "analyze": {
      const manualText = optionalText(body.manualText, 120_000);
      const transcriptText = optionalText(body.transcriptText, 120_000);
      const sourceUrl = optionalText(body.sourceUrl, 2_000);
      if (!manualText && !transcriptText && !sourceUrl) {
        throw new Error("Paste a game manual excerpt, kickoff transcript, or source URL before generating a summary");
      }
      return {
        action,
        orgId,
        seasonYear: yearValue(body.seasonYear),
        manualText,
        transcriptText,
        sourceUrl,
        createCadBrief: body.createCadBrief !== false,
        applyDrafts: body.applyDrafts !== false,
      };
    }
    case "apply":
    case "create_cad_brief":
    case "delete":
      return { action, orgId, id: uuid(body.id, "Intelligence record") };
    default:
      throw new Error("Unsupported kickoff intelligence action");
  }
}

export type KickoffIntelligenceRecord = {
  id: string;
  seasonYear: number;
  status: "empty" | "ready" | "applied" | "setup_required";
  title: string;
  summary: GameIntelligenceSummary;
  strategyAdvice: StrategyAdviceBundle;
  designPrioritiesDraft: DesignDirection[];
  cadBriefRequest: string;
  cadJobId: string | null;
  aiRunId: string | null;
  provider: string;
  model: string;
  sourceUrl: string | null;
  sourceChecksum: string;
  adviceLabel: typeof KICKOFF_ADVICE_LABEL;
  createdAt: string;
  appliedAt: string | null;
};
