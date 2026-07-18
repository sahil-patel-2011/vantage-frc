import type { ContextItem } from "./index";

export type EngineeringBrief = {
  summary: string;
  requirements: string[];
  constraints: string[];
  scoringTasks: string[];
  assumptions: Array<{ name: string; value: string; needsConfirmation: boolean }>;
  risks: string[];
  acceptanceCriteria: string[];
  sourceRefs: Array<{ type: string; id: string; classification: string }>;
  disclaimer: string;
};

type ToolFact = {
  tool?: string;
  status?: "ok" | "empty" | "setup_required";
  classification?: string;
  summary?: string;
  input?: unknown;
  data?: unknown;
};

const DEFAULT_REQUIREMENTS = [
  "Translate the confirmed scoring objective into a serviceable mechanism",
  "Preserve access for inspection and repair",
];
const DEFAULT_CONSTRAINTS = [
  "Use only dimensions and weight values confirmed by the user",
  "Stay within configured manufacturing and API complexity limits",
];
const DEFAULT_SCORING = ["Confirm scoring task from kickoff or match strategy before freezing geometry"];
const DEFAULT_ASSUMPTIONS: EngineeringBrief["assumptions"] = [
  { name: "Envelope dimensions", value: "Not yet confirmed", needsConfirmation: true },
  { name: "Weight budget", value: "Not yet confirmed", needsConfirmation: true },
  { name: "Manufacturing process", value: "Not yet confirmed", needsConfirmation: true },
];
const DEFAULT_RISKS = [
  "Clearance and collision require geometry verification",
  "Loads, fasteners, wire routing, and unsupported cantilevers require human engineering review",
];
const DEFAULT_ACCEPTANCE = [
  "User confirms requirements and assumptions before mutation",
  "Every mutation produces topology and render verification",
  "Design review checklist is reviewed by a human",
];
const DISCLAIMER =
  "AI-generated design review suggestions are not engineering or safety certification.";

function parseToolFacts(context: ContextItem[]): ToolFact[] {
  const facts: ToolFact[] = [];
  for (const item of context) {
    if (item.type !== "module_fact") continue;
    try {
      facts.push(JSON.parse(item.content) as ToolFact);
    } catch {
      // ignore malformed tool context
    }
  }
  return facts;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringList(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function unique(values: string[], max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function fromStrategyMatch(data: unknown): {
  requirements: string[];
  risks: string[];
  scoringTasks: string[];
} {
  const row = asRecord(data);
  if (!row) return { requirements: [], risks: [], scoringTasks: [] };
  const strategy = asRecord(row.strategy);
  const plan = asRecord(strategy?.plan) ?? strategy;
  const prediction = asRecord(row.prediction);
  const requirements = unique([
    ...asStringList(plan?.priorities),
    ...asStringList(plan?.strengthsToProtect).map((name) => `Protect alliance strength: ${name}`),
  ]);
  const risks = unique([
    ...asStringList(plan?.risksToMitigate).map((name) => `Mitigate match risk: ${name}`),
    ...asStringList(prediction?.caveats),
    ...(Array.isArray(row.scoutTbaConflicts) && row.scoutTbaConflicts.length
      ? [`${row.scoutTbaConflicts.length} TBA-contradicted scout field(s) — do not trust those values`]
      : []),
  ]);
  const keyFactors = Array.isArray(prediction?.keyFactors) ? prediction!.keyFactors : [];
  const scoringTasks = unique(
    keyFactors
      .map((factor) => {
        const entry = asRecord(factor);
        const name = String(entry?.name ?? "").trim();
        return name ? `Support match factor: ${name}` : "";
      })
      .filter(Boolean),
  );
  return { requirements, risks, scoringTasks };
}

function fromStrategyDesign(data: unknown): { requirements: string[]; scoringTasks: string[] } {
  const row = asRecord(data);
  if (!row) return { requirements: [], scoringTasks: [] };
  const priorities = Array.isArray(row.priorities) ? row.priorities : [];
  const requirements = unique(
    priorities
      .map((priority) => {
        const entry = asRecord(priority);
        const capability = String(entry?.capability ?? "").trim();
        const status = String(entry?.status ?? "").trim();
        if (!capability || status === "cut") return "";
        const rationale = String(entry?.rationale ?? "").trim();
        return rationale ? `${capability} — ${rationale}` : capability;
      })
      .filter(Boolean),
  );
  const kickoff = asRecord(row.kickoffStrategy);
  const advice = asRecord(kickoff?.strategyAdvice) ?? asRecord(kickoff?.strategy_advice);
  const draft = Array.isArray(kickoff?.designPrioritiesDraft)
    ? kickoff!.designPrioritiesDraft
    : Array.isArray(advice?.designPriorities)
      ? advice!.designPriorities
      : [];
  for (const item of draft) {
    const entry = asRecord(item);
    const capability = String(entry?.capability ?? "").trim();
    if (capability) requirements.push(capability);
  }
  return { requirements: unique(requirements), scoringTasks: unique(asStringList(advice?.historicalPatterns)) };
}

function fromKickoffIntelligence(data: unknown): {
  requirements: string[];
  scoringTasks: string[];
  constraints: string[];
  risks: string[];
} {
  const row = asRecord(data);
  const record = asRecord(row?.record);
  if (!record) return { requirements: [], scoringTasks: [], constraints: [], risks: [] };
  const summary = asRecord(record.summary) ?? {};
  const strategyAdvice = asRecord(record.strategyAdvice) ?? asRecord(record.strategy_advice) ?? {};
  const draft = Array.isArray(record.designPrioritiesDraft)
    ? record.designPrioritiesDraft
    : Array.isArray(strategyAdvice.designPriorities)
      ? strategyAdvice.designPriorities
      : [];
  const requirements = unique([
    ...draft
      .map((item) => {
        const entry = asRecord(item);
        return String(entry?.capability ?? "").trim();
      })
      .filter(Boolean),
    ...asStringList(summary.howToPlay).map((step) => `Game plan: ${step}`),
  ]);
  const scoring = Array.isArray(summary.scoring) ? summary.scoring : [];
  const scoringTasks = unique(
    scoring
      .map((item) => {
        const entry = asRecord(item);
        const action = String(entry?.action ?? "").trim();
        if (!action) return "";
        const phase = String(entry?.phase ?? "").trim();
        const points = entry?.points;
        const pts = typeof points === "number" ? `~${points} pts` : null;
        return [action, phase || null, pts].filter(Boolean).join(", ");
      })
      .filter(Boolean),
  );
  return {
    requirements,
    scoringTasks,
    constraints: unique(asStringList(summary.constraints)),
    risks: unique(asStringList(summary.openQuestions).map((q) => `Open game question: ${q}`)),
  };
}

function fromKickoffRules(data: unknown): {
  constraints: string[];
  assumptions: EngineeringBrief["assumptions"];
  risks: string[];
} {
  const row = asRecord(data);
  const notes = Array.isArray(row?.ruleNotes) ? row!.ruleNotes : [];
  const constraints = [...asStringList(row?.constraints)];
  const assumptions: EngineeringBrief["assumptions"] = [];
  const risks: string[] = [];
  for (const note of notes.slice(0, 16)) {
    const entry = asRecord(note);
    if (!entry) continue;
    const question = String(entry.question ?? "").trim();
    const answer = String(entry.answer ?? "").trim();
    const ruleRef = String(entry.ruleRef ?? "").trim();
    const status = String(entry.status ?? "").trim();
    const label = ruleRef ? `${ruleRef}: ${question || answer}` : question || answer;
    if (!label) continue;
    if (status === "open" || !answer) {
      assumptions.push({
        name: ruleRef ? `Rule ${ruleRef}` : "Open game rule",
        value: question || "Needs mentor/manual confirmation",
        needsConfirmation: true,
      });
      risks.push(`Open game rule may change envelopes: ${question || label}`);
    } else {
      constraints.push(
        answer.length > 200 ? `${label.slice(0, 80)} — ${answer.slice(0, 160)}` : `${label} — ${answer}`,
      );
    }
  }
  return { constraints: unique(constraints), assumptions: assumptions.slice(0, 8), risks: unique(risks) };
}

function fromRulesCompliance(data: unknown): { constraints: string[]; risks: string[] } {
  const row = asRecord(data);
  if (!row) return { constraints: [], risks: [] };
  const findings = Array.isArray(row.findings) ? row.findings : [];
  const risks = unique(
    findings
      .map((item) => {
        const entry = asRecord(item);
        const detail = String(entry?.detail ?? entry?.message ?? entry?.constraint ?? "").trim();
        return detail ? `Compliance finding: ${detail}` : "";
      })
      .filter(Boolean),
  );
  const status = String(row.status ?? "").trim();
  const constraints =
    status && status !== "pass" ? [`Game-rule compliance status: ${status} — resolve before geometry freeze`] : [];
  return { constraints, risks };
}

function fromFmea(data: unknown, tool: string): { risks: string[]; constraints: string[] } {
  const row = asRecord(data);
  if (!row) return { risks: [], constraints: [] };
  if (tool === "fmea.repeat") {
    const alerts = Array.isArray(row.alerts) ? row.alerts : [];
    const risks = unique(
      alerts
        .map((item) => {
          const entry = asRecord(item);
          const msg = String(entry?.message ?? entry?.subsystemName ?? "").trim();
          return msg ? `Repeat FMEA: ${msg}` : "";
        })
        .filter(Boolean),
    );
    return {
      risks,
      constraints: risks.length ? ["Address repeat FMEA subsystems before freezing related geometry"] : [],
    };
  }
  const failures = Array.isArray(row.failures) ? row.failures : [];
  const risks = unique(
    failures
      .map((item) => {
        const entry = asRecord(item);
        if (!entry) return "";
        const subsystem = String(entry.subsystemName ?? "").trim();
        const title = String(entry.title ?? entry.failureMode ?? "").trim();
        const rpn = entry.rpn != null ? `RPN ${entry.rpn}` : null;
        const label = [subsystem, title, rpn].filter(Boolean).join(" — ");
        return label ? `Open FMEA: ${label}` : "";
      })
      .filter(Boolean),
  );
  return {
    risks,
    constraints: risks.length
      ? ["Address open high-RPN FMEA failures before freezing geometry on those subsystems"]
      : [],
  };
}

export type BriefFromToolsInput = {
  request: string;
  context: ContextItem[];
  sourceRefs?: EngineeringBrief["sourceRefs"];
  knowledgeNotes?: string[];
};

/** Deterministic CAD brief from orchestrator tool outputs — empty tools leave placeholders. */
export function buildEngineeringBriefFromTools(input: BriefFromToolsInput): EngineeringBrief {
  const facts = parseToolFacts(input.context);
  const requirements: string[] = [];
  const constraints: string[] = [
    ...(input.knowledgeNotes?.length
      ? input.knowledgeNotes.slice(0, 6).map((note) => `Team knowledge: ${note}`)
      : []),
  ];
  const scoringTasks: string[] = [];
  const risks: string[] = [];
  const assumptions = [...DEFAULT_ASSUMPTIONS];
  const sourceRefs: EngineeringBrief["sourceRefs"] = [...(input.sourceRefs ?? [])];

  for (const [index, fact] of facts.entries()) {
    const tool = String(fact.tool ?? "");
    if (!tool) continue;
    sourceRefs.push({
      type: "tool",
      id: `${tool}:${index}`,
      classification:
        fact.classification === "hard_metric" ||
        fact.classification === "scout_observation" ||
        fact.classification === "researched_claim" ||
        fact.classification === "model_inference"
          ? fact.classification
          : "model_inference",
    });
    if (fact.status !== "ok") continue;

    if (tool === "strategy.match") {
      const mapped = fromStrategyMatch(fact.data);
      requirements.push(...mapped.requirements);
      risks.push(...mapped.risks);
      scoringTasks.push(...mapped.scoringTasks);
    } else if (tool === "strategy.design") {
      const mapped = fromStrategyDesign(fact.data);
      requirements.push(...mapped.requirements);
      scoringTasks.push(...mapped.scoringTasks);
    } else if (tool === "kickoff.intelligence") {
      const mapped = fromKickoffIntelligence(fact.data);
      requirements.push(...mapped.requirements);
      scoringTasks.push(...mapped.scoringTasks);
      constraints.push(...mapped.constraints);
      risks.push(...mapped.risks);
    } else if (tool === "kickoff.rules") {
      const mapped = fromKickoffRules(fact.data);
      constraints.push(...mapped.constraints);
      risks.push(...mapped.risks);
      for (const assumption of mapped.assumptions) {
        if (!assumptions.some((row) => row.name === assumption.name && row.value === assumption.value)) {
          assumptions.push(assumption);
        }
      }
    } else if (tool === "rules.compliance") {
      const mapped = fromRulesCompliance(fact.data);
      constraints.push(...mapped.constraints);
      risks.push(...mapped.risks);
    } else if (tool === "fmea.open_risks" || tool === "fmea.repeat") {
      const mapped = fromFmea(fact.data, tool);
      risks.push(...mapped.risks);
      constraints.push(...mapped.constraints);
    }
  }

  const dedupedRefs: EngineeringBrief["sourceRefs"] = [];
  const seenRefs = new Set<string>();
  for (const ref of sourceRefs) {
    const key = `${ref.type}\0${ref.id}\0${ref.classification}`;
    if (seenRefs.has(key)) continue;
    seenRefs.add(key);
    dedupedRefs.push(ref);
    if (dedupedRefs.length >= 40) break;
  }

  return {
    summary: input.request.trim() || "CAD engineering brief from strategy and kickoff context",
    requirements: unique(requirements, 12).length ? unique(requirements, 12) : DEFAULT_REQUIREMENTS,
    constraints: unique(constraints, 12).length ? unique(constraints, 12) : DEFAULT_CONSTRAINTS,
    scoringTasks: unique(scoringTasks, 12).length ? unique(scoringTasks, 12) : DEFAULT_SCORING,
    assumptions: assumptions.slice(0, 12),
    risks: unique(risks, 12).length ? unique(risks, 12) : DEFAULT_RISKS,
    acceptanceCriteria: DEFAULT_ACCEPTANCE,
    sourceRefs: dedupedRefs,
    disclaimer: DISCLAIMER,
  };
}
