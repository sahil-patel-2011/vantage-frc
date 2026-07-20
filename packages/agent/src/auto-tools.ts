import { resolveActiveSeasonYear } from "./season-year";

export type PlannedToolCall = { name: string; input: unknown };

export type ChatToolPlanOptions = {
  selected?: { teamKey?: string; matchKey?: string };
  activeEventKey?: string | null;
  /** When set, planner can prefer CAD/finance tools for that surface. */
  capability?: "strategy" | "team_intel" | "research" | "prediction" | "cad" | "coding" | "maintenance" | "chat" | "writer";
  /** Org active season (events_ref.year). Prefer this over years mentioned in chat. */
  seasonYear?: number;
};

const TEAM_KEY_RE = /\bfrc\d{1,5}\b/gi;
const TEAM_NUMBER_RE = /\b(?:team\s*#?\s*|frc\s*)(\d{1,5})\b/gi;
const BARE_TEAM_RE = /\b(\d{2,5})\b/g;
const MATCH_KEY_RE = /\b\d{4}[a-z0-9]+_(?:qm|qf|sf|f)\d+(?:m\d+)?\b/gi;
const QUAL_MATCH_RE = /\b(?:qual(?:ification)?|qm)\s*#?\s*(\d{1,3})\b/gi;
const PLAYOFF_MATCH_RE = /\b(?:qf|sf|f|quarter|semi|final)s?\s*#?\s*(\d{1,2})(?:\s*m(?:atch)?\s*(\d))?\b/gi;

const SCOUT_RE = /\b(scout(?:ing)?|pit\s*scout|match\s*scout|observation|observed|defense|foul|climb|endgame|auto\s*cycle)\b/i;
const STRATEGY_RE = /\b(strateg(?:y|ies|ic)|matchup|prediction|win\s*prob|playbook|game\s*plan|alliance\s*plan)\b/i;
const METRIC_RE = /\b(epa|metric|stat(?:s|istics)?|rank(?:ing)?|opr|compare|capability|capabilities)\b/i;
const RESEARCH_RE = /\b(research|finding|article|source|cite|citation)\b/i;
const TEAM_INTENT_RE = /\b(team|opponent|alliance|robot)\b/i;
const MATCH_INTENT_RE = /\b(match|qual|qm|qf|sf|final)\b/i;
const MY_DAY_RE = /\b(my\s*day|next\s*match|bumper(?:s)?|on\s*deck|queue\s*time)\b/i;
const CALENDAR_UPCOMING_RE = /\b(upcoming\s+(?:events?|meetings?|practices?)|team\s*calendar)\b/i;
const FMEA_RE =
  /\b(fmea|failure\s*log|repeat(?:ed|ing)?\s*fail|fail(?:ed|ure)s?\s*(?:again|pattern|history)|most\s*failure|subsystem\s*reliab|root\s*cause|five\s*whys|RPN)\b/i;
const PIT_OPS_RE = /\b(pit\s*(?:board|command|crew)?|release\s*gate|robot\s*issue)\b/i;
const FINANCE_ORDERS_RE =
  /\b(purchase\s*requests?|purchase\s*orders?|open\s*orders?|ordering\s*requests?|budget\s*requests?|awaiting\s*approval|ready\s*to\s*buy|finance\s*assistant)\b/i;
const FINANCE_SUMMARY_RE =
  /\b(budget|spend(?:ing)?|expense|expenses|income|ledger|how\s+much\s+(?:have\s+we|did\s+we|we)\s+spend|remaining\s+budget|season\s+budget|fundraising\s+goal|category\s+limit|vendor\s+spend)\b/i;
const NEED_PART_RE =
  /\b(?:need|order|buy|purchase|request)\s+(?:a\s+|an\s+|the\s+)?(?:part|component|bolt|bearing|motor|gear|belt|shaft|sensor|pneumatic|cylinder|tube|plate|spacer)\b/i;
const NEED_PART_NAME_RE =
  /\b(?:need|order|buy|purchase|request)\s+(?:a\s+|an\s+|the\s+)?(?:part\s+)?["“]?([^"”\n,.!?]{2,80})["”]?/i;
const CAD_RE = /\b(cad|onshape|fusion|engineering\s*brief|design\s*brief|mechanism|extrude|sketch|geometry)\b/i;
const KNOWLEDGE_RE =
  /\b(wiki|knowledge\s*base|handoff|onboarding|institutional\s*knowledge|why\s+did\s+we|how\s+do\s+we|decision(?:\s+record)?s?|design\s*review|ADR|last\s+season|prior\s+season|cross[- ]season|convention(?:s)?|subsystem\s+guide)\b/i;
const WIKI_SLUG_RE = /\b(?:wiki|page)\s+([a-z0-9]+(?:-[a-z0-9]+)*)\b/i;

function unique(values: string[]) {
  return [...new Set(values)];
}

/** Lock kickoff/rules/design tools to the org active season — never a year from chat text. */
function resolveSeasonYear(_message: string, options: ChatToolPlanOptions) {
  return resolveActiveSeasonYear({
    seasonYear: options.seasonYear,
    activeEventKey: options.activeEventKey,
    matchKey: options.selected?.matchKey,
  });
}

function extractNeedPartTitle(message: string): string | null {
  const named = message.match(NEED_PART_NAME_RE);
  if (named?.[1]) {
    const cleaned = named[1].trim().replace(/^(part|component)\s+/i, "").slice(0, 120);
    if (cleaned.length >= 2) return cleaned;
  }
  return null;
}

export function extractTeamKeys(message: string, selected?: { teamKey?: string }) {
  const keys: string[] = [];
  if (selected?.teamKey && /^frc\d+$/i.test(selected.teamKey)) keys.push(selected.teamKey.toLowerCase());
  for (const match of message.matchAll(TEAM_KEY_RE)) keys.push(match[0]!.toLowerCase());
  for (const match of message.matchAll(TEAM_NUMBER_RE)) keys.push(`frc${match[1]}`);
  const wantsTeam =
    TEAM_INTENT_RE.test(message) || SCOUT_RE.test(message) || METRIC_RE.test(message) || RESEARCH_RE.test(message);
  if (wantsTeam) {
    for (const match of message.matchAll(BARE_TEAM_RE)) {
      const n = Number(match[1]);
      if (n >= 1 && n <= 99999) keys.push(`frc${n}`);
    }
  }
  return unique(keys).slice(0, 4);
}

export function extractMatchKeys(message: string, options?: ChatToolPlanOptions) {
  const keys: string[] = [];
  if (options?.selected?.matchKey?.trim()) keys.push(options.selected.matchKey.trim().toLowerCase());
  for (const match of message.matchAll(MATCH_KEY_RE)) keys.push(match[0]!.toLowerCase());
  const event = options?.activeEventKey?.trim().toLowerCase();
  if (event) {
    for (const match of message.matchAll(QUAL_MATCH_RE)) {
      keys.push(`${event}_qm${match[1]}`);
    }
    for (const match of message.matchAll(PLAYOFF_MATCH_RE)) {
      const kind = match[0]!.toLowerCase().startsWith("q")
        ? "qf"
        : match[0]!.toLowerCase().startsWith("s")
          ? "sf"
          : "f";
      const set = match[1]!;
      const game = match[2] ? `m${match[2]}` : "m1";
      keys.push(`${event}_${kind}${set}${game}`);
    }
  }
  return unique(keys).slice(0, 3);
}

/**
 * Deterministic chat tool planner: inspects the user message and selects authorized
 * registry tools. Does not invent data — tools return Neon/TBA/scout/finance rows or empty.
 */
export function planChatToolCalls(message: string, options: ChatToolPlanOptions = {}): PlannedToolCall[] {
  const text = message.trim();
  if (!text) return [];

  const teamKeys = extractTeamKeys(text, options.selected);
  const matchKeys = extractMatchKeys(text, options);
  const seasonYear = resolveSeasonYear(text, options);
  const isCadSurface = options.capability === "cad";
  const wantsScout = SCOUT_RE.test(text);
  const wantsStrategy = STRATEGY_RE.test(text) || MATCH_INTENT_RE.test(text);
  const wantsMetrics = METRIC_RE.test(text) || TEAM_INTENT_RE.test(text);
  const wantsResearch = RESEARCH_RE.test(text);
  const wantsFinanceList = FINANCE_ORDERS_RE.test(text);
  const wantsFinanceSummary = FINANCE_SUMMARY_RE.test(text);
  const wantsNeedPart =
    NEED_PART_RE.test(text) ||
    (isCadSurface && /\bneed\b/i.test(text) && /\b(part|buy|order|purchase)\b/i.test(text));
  const wantsCad = CAD_RE.test(text) || isCadSurface;
  const wantsFmea = FMEA_RE.test(text) || PIT_OPS_RE.test(text) || isCadSurface;
  const wantsKnowledge = KNOWLEDGE_RE.test(text) || isCadSurface;
  const wantsCreateBrief =
    /\b(create|draft|write|generate|start)\b.{0,40}\b(cad|engineering|design)\s*brief\b/i.test(text) ||
    /\b(cad|engineering|design)\s*brief\b.{0,40}\b(create|draft|write|generate|start)\b/i.test(text);
  const isStrategySurface = options.capability === "strategy";

  const calls: PlannedToolCall[] = [];
  const seen = new Set<string>();
  const add = (name: string, input: unknown) => {
    const key = `${name}:${JSON.stringify(input)}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push({ name, input });
  };

  if (wantsKnowledge) {
    const slugMatch = text.match(WIKI_SLUG_RE);
    if (slugMatch?.[1]) add("knowledge.get_page", { slug: slugMatch[1] });
    add("knowledge.search", { query: text.slice(0, 200), limit: isCadSurface ? 6 : 8 });
  }

  if (wantsFmea) {
    add("fmea.open_risks", { seasonYear, limit: 12 });
    add("fmea.repeat", { seasonYear });
  }
  const wantsMyDay =
    MY_DAY_RE.test(text) ||
    ((isStrategySurface || wantsStrategy) &&
      /\b(competition|event\s*day|alliance|on\s*field|queue)\b/i.test(text));
  if (wantsMyDay) {
    add("my_day.summary", {});
  }
  if (CALENDAR_UPCOMING_RE.test(text)) {
    add("calendar.upcoming", { limit: 8 });
  }

  if (wantsFinanceSummary) {
    add("finance.summary", { seasonYear });
  }

  if (wantsFinanceList || (isCadSurface && wantsNeedPart)) {
    add("finance.orders", { seasonYear });
  }

  if (wantsNeedPart) {
    const partTitle = extractNeedPartTitle(text) ?? (isCadSurface ? text.slice(0, 80) : null);
    if (partTitle) {
      add("finance.create_purchase_request", {
        title: partTitle,
        justification: isCadSurface
          ? `CAD need: ${text.slice(0, 500)}`
          : `Requested via assistant: ${text.slice(0, 500)}`,
        estimateUsd: 0,
        quantity: 1,
        seasonYear,
        source: isCadSurface ? "cad" : "assistant",
      });
    }
  }

  // Strategy ↔ CAD ↔ kickoff loop (shared Assistant/CAD/Strategy graph).
  const wantsKickoff =
    /\b(kickoff|game\s*manual|game\s*release|transcript|design\s*priorit|scoring\s*action|game\s*piece)\b/i.test(
      text,
    );
  const wantsRules =
    /\b(rule(?:s)?|compliance|legal|inspection|constraint|frame\s*perimeter|extension|weight\s*limit|G\d{2,4}|R\d{2,4})\b/i.test(
      text,
    );
  if (isCadSurface || wantsCad || wantsKickoff || wantsRules || isStrategySurface) {
    add("kickoff.intelligence", { seasonYear });
    add("strategy.design", { seasonYear });
    add("kickoff.rules", { seasonYear });
    if (isCadSurface || wantsRules || wantsCad) {
      add("rules.compliance", { proposal: text.slice(0, 8_000), seasonYear });
    }
  }

  if (isCadSurface || wantsCad) {
    add("cad.briefs", { limit: 6 });
  }

  // Pull trusted scouting early on CAD/strategy so the 12-tool cap does not drop it.
  for (const teamKey of teamKeys) {
    if (isCadSurface || isStrategySurface || wantsScout || TEAM_INTENT_RE.test(text)) {
      add("scouting.team", { teamKey });
    }
  }
  if (isCadSurface || isStrategySurface || wantsScout || /\b(scout(?:ing)?\s*form|form\s*builder|schema\s*field|custom\s*form)\b/i.test(text)) {
    add("scouting.schema", { seasonYear });
  }

  if (isCadSurface) {
    add("inventory.availability", { query: text.slice(0, 160), limit: 20 });
  }

  if (isStrategySurface) {
    add("cad.design_context", { matchKey: matchKeys[0] ?? options.selected?.matchKey ?? "", limit: 6 });
    if (!wantsKnowledge) {
      add("knowledge.search", { query: text.slice(0, 200), limit: 6 });
    }
    add("fmea.open_risks", { seasonYear, limit: 8 });
  }

  if (wantsCreateBrief && !isCadSurface) {
    add("cad.create_brief", {
      request: text.slice(0, 8_000),
      title: text.slice(0, 120),
      seasonYear,
      matchKey: matchKeys[0] ?? options.selected?.matchKey,
    });
  }

  for (const matchKey of matchKeys) {
    if (wantsStrategy || STRATEGY_RE.test(text) || matchKeys.length || isStrategySurface || isCadSurface) {
      add("strategy.match", { matchKey });
    }
  }

  for (const teamKey of teamKeys) {
    if (wantsScout || wantsMetrics || TEAM_INTENT_RE.test(text) || isStrategySurface || isCadSurface) {
      add("reference.team", { teamKey });
    }
    // Strategy + CAD cite scout validation + TBA trust strip (never invent observations).
    if (
      wantsScout ||
      TEAM_INTENT_RE.test(text) ||
      isStrategySurface ||
      isCadSurface ||
      (!matchKeys.length && !wantsResearch)
    ) {
      add("scouting.team", { teamKey });
    }
    if (wantsResearch) add("research.findings", { teamKey });
  }

  // Strategy questions without an explicit match still benefit from selected match context.
  if (!matchKeys.length && options.selected?.matchKey && (wantsStrategy || isStrategySurface || isCadSurface)) {
    add("strategy.match", { matchKey: options.selected.matchKey });
  }

  // Cap tool fan-out — slightly higher on CAD/strategy so the shared graph stays intact.
  const cap = isCadSurface || isStrategySurface ? 12 : 10;
  return calls.slice(0, cap);
}

export type ToolDataSourceAnnotation = {
  mode: "ok" | "degraded" | "unavailable" | "stale";
  usingLastGoodCache: boolean;
  message: string;
};

export type AnnotatedToolOutput = {
  name: string;
  status: "ok" | "empty" | "setup_required";
  classification: "hard_metric" | "scout_observation" | "researched_claim" | "model_inference";
  summary: string;
  output: unknown;
  input?: unknown;
  /** Present when TBA/Statbotics ingest is degraded/stale and tools still serve Neon cache. */
  dataSource?: ToolDataSourceAnnotation;
};

/** Stamp a shared data-source note onto tool outputs (reference/strategy tools only). */
export function attachDataSourceNote(
  tools: AnnotatedToolOutput[],
  note: ToolDataSourceAnnotation | null | undefined,
): AnnotatedToolOutput[] {
  if (!note || note.mode === "ok") return tools;
  return tools.map((tool) => {
    const usesReference =
      tool.name.startsWith("reference.") ||
      tool.name.startsWith("strategy.") ||
      tool.name === "scouting.team" ||
      tool.name === "research.findings";
    if (!usesReference || tool.status === "setup_required") return tool;
    return { ...tool, dataSource: note };
  });
}

export function annotateToolOutput(name: string, output: unknown, input?: unknown): AnnotatedToolOutput {
  const classification =
    name === "scouting.team"
      ? ("scout_observation" as const)
      : name === "scouting.schema"
        ? ("hard_metric" as const)
      : name === "research.findings" ||
          name === "kickoff.intelligence" ||
          name === "kickoff.rules" ||
          name === "web.search" ||
          name === "web.fetch"
        ? ("researched_claim" as const)
        : name === "strategy.match" ||
            name === "strategy.design" ||
            name === "cad.design_context" ||
            name === "cad.create_brief" ||
            name === "rules.compliance" ||
            name.startsWith("finance.") ||
            name.startsWith("knowledge.") ||
            name.startsWith("fmea.")
          ? ("model_inference" as const)
          : ("hard_metric" as const);

  if (name === "web.search") {
    const row = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
    if (row.status === "setup_required") {
      return {
        name,
        status: "setup_required",
        classification,
        summary: String(row.message ?? "Web search is not configured."),
        output,
        input,
      };
    }
    const results = Array.isArray(row.results) ? row.results : [];
    if (!results.length) {
      return {
        name,
        status: "empty",
        classification,
        summary: String(row.message ?? "No search results."),
        output,
        input,
      };
    }
    return {
      name,
      status: "ok",
      classification,
      summary: `${results.length} web search hit(s) via ${String(row.provider ?? "search")}`,
      output,
      input,
    };
  }

  if (name === "web.fetch") {
    const row = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
    if (row.status === "setup_required") {
      return {
        name,
        status: "setup_required",
        classification,
        summary: String(row.message ?? "Web browse is disabled."),
        output,
        input,
      };
    }
    if (row.status === "error" || !row.excerpt) {
      return {
        name,
        status: "empty",
        classification,
        summary: String(row.message ?? "Fetch failed or returned no excerpt."),
        output,
        input,
      };
    }
    return {
      name,
      status: "ok",
      classification,
      summary: row.truncated
        ? `Fetched truncated excerpt from ${String(row.finalUrl ?? row.url ?? "url")}`
        : `Fetched excerpt from ${String(row.finalUrl ?? row.url ?? "url")}`,
      output,
      input,
    };
  }

  if (name === "finance.summary") {
    const row = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
    if (row.denied || row.reason === "finance_in_ai.disabled") {
      return {
        name,
        status: "setup_required",
        classification,
        summary: String(row.message ?? "Finance-in-AI is disabled for this organization."),
        output,
        input,
      };
    }
    if (row.setup_required) {
      return {
        name,
        status: "setup_required",
        classification,
        summary: String(row.message ?? "Team finance data is not available yet."),
        output,
        input,
      };
    }
    const expense = Number(row.expenseUsd ?? 0);
    const income = Number(row.incomeUsd ?? 0);
    return {
      name,
      status: "ok",
      classification,
      summary: `Season finance: income $${income.toFixed(0)}, spend $${expense.toFixed(0)} (redacted summaries only).`,
      output,
      input,
    };
  }

  if (name === "finance.orders") {
    const row = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
    if (row.denied || row.reason === "finance_in_ai.disabled") {
      return {
        name,
        status: "setup_required",
        classification,
        summary: String(row.message ?? "Finance-in-AI is disabled for this organization."),
        output,
        input,
      };
    }
    if (row.setup_required) {
      return {
        name,
        status: "setup_required",
        classification,
        summary: "Purchase requests table not available yet.",
        output,
        input,
      };
    }
    const orders = Array.isArray(row.orders) ? row.orders : [];
    const ai = row.aiSummary && typeof row.aiSummary === "object" ? (row.aiSummary as { headline?: string }) : null;
    if (!orders.length) {
      return {
        name,
        status: "empty",
        classification,
        summary: "No open purchase requests for this season.",
        output,
        input,
      };
    }
    return {
      name,
      status: "ok",
      classification,
      summary: ai?.headline
        ? `${orders.length} open order(s). Finance AI: ${ai.headline}`
        : `${orders.length} open purchase request(s).`,
      output,
      input,
    };
  }

  if (name === "finance.create_purchase_request") {
    const row = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
    if (row.denied || row.reason === "finance_in_ai.disabled") {
      return {
        name,
        status: "setup_required",
        classification,
        summary: String(row.message ?? "Finance-in-AI is disabled for this organization."),
        output,
        input,
      };
    }
    if (row.setup_required || row.created === false) {
      return {
        name,
        status: "setup_required",
        classification,
        summary: String(row.error ?? "Could not create purchase request"),
        output,
        input,
      };
    }
    return {
      name,
      status: "ok",
      classification,
      summary: String(row.message ?? `Created purchase request ${row.orderId ?? ""}`.trim()),
      output,
      input,
    };
  }

  if (name === "strategy.match") {
    const row = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
    const hasPrediction = row.prediction != null;
    const hasStrategy = row.strategy != null;
    const conflicts = Array.isArray(row.scoutTbaConflicts) ? row.scoutTbaConflicts.length : 0;
    if (!hasPrediction && !hasStrategy && !conflicts) {
      return {
        name,
        status: "empty",
        classification,
        summary: "No stored prediction or strategy plan for this match yet.",
        output,
        input,
      };
    }
    return {
      name,
      status: "ok",
      classification,
      summary: [
        hasPrediction ? "prediction available" : null,
        hasStrategy ? "strategy plan available" : null,
        conflicts > 0
          ? `${conflicts} TBA-contradicted scout field(s) — do not trust those values`
          : "no TBA scout conflicts",
      ]
        .filter(Boolean)
        .join("; "),
      output,
      input,
    };
  }

  if (name === "kickoff.intelligence") {
    const row = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
    if (row.setup_required) {
      return { name, status: "setup_required", classification, summary: "Kickoff intelligence table not migrated yet.", output, input };
    }
    if (row.record == null) {
      return {
        name,
        status: "empty",
        classification,
        summary: "No game-release intelligence summary for this season yet — upload a manual/transcript on /kickoff.",
        output,
        input,
      };
    }
    return { name, status: "ok", classification, summary: "Kickoff intelligence summary available", output, input };
  }

  if (name === "kickoff.rules") {
    const row = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
    const notes = Array.isArray(row.ruleNotes) ? row.ruleNotes : [];
    const constraints = Array.isArray(row.constraints) ? row.constraints : [];
    if (!notes.length && !constraints.length) {
      return {
        name,
        status: "empty",
        classification,
        summary: "No rule notes or stored constraints for this season yet.",
        output,
        input,
      };
    }
    return {
      name,
      status: "ok",
      classification,
      summary: `${notes.length} rule note(s); ${constraints.length} constraint(s)`,
      output,
      input,
    };
  }

  if (name === "rules.compliance") {
    const row = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
    const constraintCount = Number(row.constraintCount ?? 0);
    const openRuleNotes = Number(row.openRuleNotes ?? 0);
    const findings = Array.isArray(row.findings) ? row.findings : [];
    if (!constraintCount && !openRuleNotes && !findings.length) {
      const seasonLabel = row.seasonYear != null ? ` for ${row.seasonYear}` : "";
      return {
        name,
        status: "empty",
        classification,
        summary: `No this-season game rules${seasonLabel} yet — add kickoff constraints or rule notes before compliance checks.`,
        output,
        input,
      };
    }
    const status = String(row.status ?? "pass");
    return {
      name,
      status: "ok",
      classification,
      summary: `Compliance ${status} (${findings.length} finding${findings.length === 1 ? "" : "s"}) · season ${row.seasonYear ?? "?"}`,
      output,
      input,
    };
  }

  if (name === "strategy.design") {
    const row = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
    const priorities = Array.isArray(row.priorities) ? row.priorities : [];
    if (!priorities.length && row.kickoffStrategy == null) {
      return {
        name,
        status: "empty",
        classification,
        summary: "No design priorities or kickoff strategy advice for this season yet.",
        output,
        input,
      };
    }
    return {
      name,
      status: "ok",
      classification,
      summary: `${priorities.length} design priorit${priorities.length === 1 ? "y" : "ies"}${row.kickoffStrategy ? "; kickoff strategy linked" : ""}`,
      output,
      input,
    };
  }

  if (name === "fmea.repeat") {
    const row = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
    if (row.setup_required) {
      return { name, status: "setup_required", classification: "hard_metric", summary: "Failure log not available yet.", output, input };
    }
    const alerts = Array.isArray(row.alerts) ? row.alerts : [];
    if (!alerts.length) {
      return {
        name,
        status: "empty",
        classification: "hard_metric",
        summary: "No repeat-failure patterns this season (threshold not met).",
        output,
        input,
      };
    }
    return {
      name,
      status: "ok",
      classification: "hard_metric",
      summary: `${alerts.length} subsystem(s) with repeat failures this season`,
      output,
      input,
    };
  }

  if (name === "my_day.summary") {
    const row = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
    if (row.setup_required) {
      return {
        name,
        status: "setup_required",
        classification: "hard_metric",
        summary: "My Day tables are not available yet.",
        output,
        input,
      };
    }
    const next = row.nextMatch && typeof row.nextMatch === "object" ? (row.nextMatch as { label?: string }) : null;
    if (!next) {
      return {
        name,
        status: "empty",
        classification: "hard_metric",
        summary: String(row.emptyReason ?? "No upcoming match queued for this team."),
        output,
        input,
      };
    }
    return {
      name,
      status: "ok",
      classification: "hard_metric",
      summary: `Next match ${next.label ?? ""} — see bumper/lodging cues`.trim(),
      output,
      input,
    };
  }

  if (Array.isArray(output)) {
    if (!output.length) {
      return {
        name,
        status: "empty",
        classification,
        summary:
          name === "scouting.team"
            ? "No match/pit scout entries for this team in the active event."
            : name === "research.findings"
              ? "No research findings stored for this team."
              : name === "knowledge.search"
                ? "No wiki pages, decisions, or design reviews matched that query."
                : "No reference metrics found for this team/event.",
        output,
        input,
      };
    }
    if (name === "scouting.team") {
      const conflictRows = output.filter(
        (row) =>
          row &&
          typeof row === "object" &&
          Number((row as { conflictCount?: number }).conflictCount ?? 0) > 0,
      ).length;
      const excluded = output.flatMap((row) =>
        row && typeof row === "object" && Array.isArray((row as { excludedFields?: string[] }).excludedFields)
          ? (row as { excludedFields: string[] }).excludedFields
          : [],
      );
      return {
        name,
        status: "ok",
        classification,
        summary:
          conflictRows > 0
            ? `${output.length} scout row${output.length === 1 ? "" : "s"}; ${conflictRows} with TBA conflicts (excluded: ${[...new Set(excluded)].join(", ") || "fields"}). Prefer trustedPayload.`
            : `${output.length} scout row${output.length === 1 ? "" : "s"} with TBA trust checks; use trustedPayload.`,
        output,
        input,
      };
    }
    return {
      name,
      status: "ok",
      classification,
      summary:
        name === "knowledge.search"
          ? `${output.length} knowledge hit${output.length === 1 ? "" : "s"} (wiki/decisions/reviews)`
          : `${output.length} row${output.length === 1 ? "" : "s"}`,
      output,
      input,
    };
  }

  return {
    name,
    status: output == null ? "empty" : "ok",
    classification,
    summary: output == null ? "No data" : "Object result",
    output,
    input,
  };
}

export function toolOutputsToContextContent(items: AnnotatedToolOutput[]) {
  return items.map((item, index) => ({
    type: "module_fact" as const,
    id: `${item.name}:${index}`,
    content: JSON.stringify({
      tool: item.name,
      status: item.status,
      classification: item.classification,
      summary: item.summary,
      input: item.input ?? null,
      data: item.output,
      dataSource: item.dataSource ?? null,
    }),
    importance: 1,
  }));
}

export function formatGroundedReply(message: string, tools: AnnotatedToolOutput[]) {
  if (!tools.length) {
    return `Vantage response: ${message.trim()} No authorized competition tools were needed for this turn.`;
  }
  const lines = tools.map((tool) => {
    const target =
      tool.input && typeof tool.input === "object"
        ? Object.entries(tool.input as Record<string, unknown>)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(" ")
        : "";
    const sourceNote =
      tool.dataSource && tool.dataSource.mode !== "ok"
        ? ` · data source ${tool.dataSource.mode}${tool.dataSource.usingLastGoodCache ? " (last-good Neon cache)" : ""}`
        : "";
    if (tool.status === "empty" || tool.status === "setup_required") {
      return `- ${tool.name}${target ? ` (${target})` : ""}: ${tool.summary}${sourceNote}`;
    }
    return `- ${tool.name}${target ? ` (${target})` : ""} [${tool.classification}]: ${tool.summary}${sourceNote}`;
  });
  const emptyOnly = tools.every((tool) => tool.status !== "ok");
  const degraded = tools.find((tool) => tool.dataSource && tool.dataSource.mode !== "ok")?.dataSource;
  const lead = degraded
    ? `Grounded in authorized Vantage tools using the last-good Neon cache — ${degraded.message}`
    : emptyOnly
      ? "I looked up your event-scoped sources and found no stored rows yet — nothing was invented."
      : "Grounded in authorized Vantage tools (Neon/TBA/scout/kickoff). Sources are labeled below.";
  return `Vantage response: ${message.trim()}\n\n${lead}\n${lines.join("\n")}`;
}
