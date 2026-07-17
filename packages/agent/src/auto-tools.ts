export type PlannedToolCall = { name: string; input: unknown };

export type ChatToolPlanOptions = {
  selected?: { teamKey?: string; matchKey?: string };
  activeEventKey?: string | null;
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

function unique(values: string[]) {
  return [...new Set(values)];
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
 * registry tools. Does not invent data — tools return Neon/TBA/scout rows or empty.
 */
export function planChatToolCalls(message: string, options: ChatToolPlanOptions = {}): PlannedToolCall[] {
  const text = message.trim();
  if (!text) return [];

  const teamKeys = extractTeamKeys(text, options.selected);
  const matchKeys = extractMatchKeys(text, options);
  const wantsScout = SCOUT_RE.test(text);
  const wantsStrategy = STRATEGY_RE.test(text) || MATCH_INTENT_RE.test(text);
  const wantsMetrics = METRIC_RE.test(text) || TEAM_INTENT_RE.test(text);
  const wantsResearch = RESEARCH_RE.test(text);

  const calls: PlannedToolCall[] = [];
  const seen = new Set<string>();
  const add = (name: string, input: unknown) => {
    const key = `${name}:${JSON.stringify(input)}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push({ name, input });
  };

  for (const matchKey of matchKeys) {
    if (wantsStrategy || STRATEGY_RE.test(text) || matchKeys.length) {
      add("strategy.match", { matchKey });
    }
  }

  for (const teamKey of teamKeys) {
    if (wantsScout || (!wantsStrategy && !wantsResearch) || wantsMetrics) {
      if (wantsScout || wantsMetrics || TEAM_INTENT_RE.test(text)) {
        add("reference.team", { teamKey });
      }
    }
    if (wantsScout || TEAM_INTENT_RE.test(text) || (!matchKeys.length && !wantsResearch)) {
      add("scouting.team", { teamKey });
    }
    if (wantsResearch) add("research.findings", { teamKey });
  }

  // Strategy questions without an explicit match still benefit from selected match context.
  if (!matchKeys.length && options.selected?.matchKey && wantsStrategy) {
    add("strategy.match", { matchKey: options.selected.matchKey });
  }

  // Cap tool fan-out for a single chat turn.
  return calls.slice(0, 8);
}

export type AnnotatedToolOutput = {
  name: string;
  status: "ok" | "empty" | "setup_required";
  classification: "hard_metric" | "scout_observation" | "researched_claim" | "model_inference";
  summary: string;
  output: unknown;
  input?: unknown;
};

export function annotateToolOutput(name: string, output: unknown, input?: unknown): AnnotatedToolOutput {
  const classification =
    name === "scouting.team"
      ? ("scout_observation" as const)
      : name === "research.findings"
        ? ("researched_claim" as const)
        : name === "strategy.match"
          ? ("model_inference" as const)
          : ("hard_metric" as const);

  if (name === "strategy.match") {
    const row = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
    const hasPrediction = row.prediction != null;
    const hasStrategy = row.strategy != null;
    if (!hasPrediction && !hasStrategy) {
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
      ]
        .filter(Boolean)
        .join("; "),
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
              : "No reference metrics found for this team/event.",
        output,
        input,
      };
    }
    return {
      name,
      status: "ok",
      classification,
      summary: `${output.length} row${output.length === 1 ? "" : "s"}`,
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
    if (tool.status === "empty" || tool.status === "setup_required") {
      return `- ${tool.name}${target ? ` (${target})` : ""}: ${tool.summary}`;
    }
    return `- ${tool.name}${target ? ` (${target})` : ""} [${tool.classification}]: ${tool.summary}`;
  });
  const emptyOnly = tools.every((tool) => tool.status !== "ok");
  const lead = emptyOnly
    ? "I looked up your event-scoped sources and found no stored rows yet — nothing was invented."
    : "Grounded in authorized Vantage tools (Neon/TBA/scout). Sources are labeled below.";
  return `Vantage response: ${message.trim()}\n\n${lead}\n${lines.join("\n")}`;
}
