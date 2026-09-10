/**
 * The only place a model touches this feature.
 *
 * It gets structured facts that were already derived from CAD and returns one
 * English sentence per step. It does not choose the order, it does not supply a
 * measurement, and it never sees the CAD. If it is unavailable, or it says
 * something the facts do not support, the deterministic sentence is used and
 * the step is marked `deterministic` so the reader knows.
 *
 * THE GROUNDING CHECK
 *
 * Every number in a generated sentence must appear verbatim in the facts that
 * were handed in. A model that writes "torque to 8 ft-lb" for a step whose
 * facts never mentioned 8 gets its sentence thrown away. This is a blunt rule
 * and it occasionally rejects a harmless sentence — which is the right trade,
 * because the alternative is a 15-year-old torquing to an invented spec.
 */

export type ChatLike = {
  provider: string;
  model: string;
  complete: (input: {
    message: string;
    context: never[];
    promptCachingEnabled?: boolean;
  }) => Promise<{
    text: string;
    promptTokens: number;
    completionTokens: number;
    costUsd?: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
    uncachedInputTokens?: number;
  }>;
};

export type StepWriteFacts = {
  stepNumber: number;
  primaryName: string;
  quantity: number;
  subassembly: string;
  /** Names of the parts this one mates to that are already on the bench. */
  attachesTo: string[];
  /** "4 × 10-32 x 1.00 SHCS" style summary lines. */
  hardware: string[];
  /** Fabrication line texts, already carrying their own caveats. */
  fabrication: string[];
  /** Feasibility notes worth mentioning in the sentence. */
  cautions: string[];
};

const MAX_SENTENCE = 320;

export function factSheet(facts: StepWriteFacts): string {
  const lines = [
    `step: ${facts.stepNumber}`,
    `part: ${facts.primaryName}`,
    `quantity: ${facts.quantity}`,
  ];
  if (facts.subassembly) lines.push(`sub-assembly: ${facts.subassembly}`);
  if (facts.attachesTo.length) lines.push(`attaches to: ${facts.attachesTo.join(", ")}`);
  for (const item of facts.hardware) lines.push(`hardware: ${item}`);
  for (const item of facts.fabrication) lines.push(`fabrication: ${item}`);
  for (const item of facts.cautions) lines.push(`caution: ${item}`);
  return lines.join("\n");
}

/**
 * The sentence used when there is no model, when the model is refused, and
 * whenever a generated sentence fails grounding. It is plain, and it is always
 * true, because it is assembled from the same facts.
 */
export function deterministicSentence(facts: StepWriteFacts): string {
  const count = facts.quantity > 1 ? `${facts.quantity} × ` : "";
  const attach = facts.attachesTo.length
    ? ` onto ${facts.attachesTo.slice(0, 3).join(", ")}${facts.attachesTo.length > 3 ? ` and ${facts.attachesTo.length - 3} more` : ""}`
    : "";
  const hardware = facts.hardware.length ? ` Secure with ${facts.hardware.join(", ")}.` : "";
  return `Fit ${count}${facts.primaryName}${attach}.${hardware}`.replace(/\s+/g, " ").trim();
}

/** Numeric tokens in a sentence, normalised for comparison. */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0]!);
}

/**
 * A sentence is grounded when every number it contains appears in the facts,
 * and it says nothing about torque, adhesive or lubricant — none of which any
 * CAD model in this pipeline carries, so any such instruction is invented.
 */
const INVENTED_PROCESS = /\b(torque|ft-?lbs?|n[·.]?m|loctite|thread\s?lock|grease|lubricat|adhesiv|epoxy)/gi;

export function sentenceIsGrounded(sentence: string, facts: StepWriteFacts): boolean {
  const sheet = factSheet(facts);
  const sheetLower = sheet.toLowerCase();

  // A process word the facts never mentioned is invented — CAD carries no
  // torque spec, no thread-locker and no lubricant. It is only allowed through
  // when the same word is in the facts, which happens when a team has named a
  // part "grease fitting" and would otherwise never be describable.
  for (const match of sentence.matchAll(INVENTED_PROCESS)) {
    if (!sheetLower.includes(match[0]!.toLowerCase())) return false;
  }

  const allowed = new Set([...numbersIn(sheet), String(facts.stepNumber), String(facts.quantity)]);
  return numbersIn(sentence).every((value) => allowed.has(value));
}

const SYSTEM = [
  "You write one short imperative sentence per assembly step for a printed FRC robot build manual.",
  "You are given facts already measured from the team's CAD. Use ONLY those facts.",
  "Never state a torque, a thread-locker, a lubricant, a tolerance, or any number that is not in the facts.",
  "Do not add safety boilerplate.",
  "Write like a person who has built one: 12-28 words, present imperative, no step number, no bullet.",
  'Reply with ONLY a JSON array of objects: [{"step": 1, "sentence": "..."}]. No prose, no code fence.',
].join("\n");

function parseSentences(raw: string): Map<number, string> {
  const out = new Map<number, string>();
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end <= start) return out;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return out;
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as { step?: unknown; sentence?: unknown };
      const step = Number(record.step);
      const sentence = typeof record.sentence === "string" ? record.sentence.trim() : "";
      if (Number.isInteger(step) && sentence) out.set(step, sentence.slice(0, MAX_SENTENCE));
    }
  } catch {
    return out;
  }
  return out;
}

export type WrittenStep = {
  stepNumber: number;
  sentence: string;
  source: "model" | "deterministic";
};

export type WriteBatchResult = {
  steps: WrittenStep[];
  /** Why the model was not used, when it was not. Printed in the run report. */
  note: string;
  modelCalls: number;
  rejected: number;
};

export type MeteredInvoke = (input: {
  prompt: string;
  estimatedCompletionTokens: number;
}) => Promise<string>;

/**
 * Write sentences for a batch of steps.
 *
 * `invoke` is supplied by the caller so the request path can wrap it in
 * `meteredAI` and the worker can use the free-relay adapter — the writing logic
 * and its grounding check are identical either way. Passing null means "no
 * model available": every sentence is deterministic and the manual still
 * completes, which is the whole point of having a deterministic writer.
 */
export async function writeStepSentences(
  batch: StepWriteFacts[],
  invoke: MeteredInvoke | null,
): Promise<WriteBatchResult> {
  if (!batch.length) return { steps: [], note: "", modelCalls: 0, rejected: 0 };

  const fallback = (): WrittenStep[] =>
    batch.map((facts) => ({
      stepNumber: facts.stepNumber,
      sentence: deterministicSentence(facts),
      source: "deterministic" as const,
    }));

  if (!invoke) {
    return {
      steps: fallback(),
      note: "No AI model was available for this run, so every step sentence is the plain generated one. Every measurement is unaffected — none of them come from the model.",
      modelCalls: 0,
      rejected: 0,
    };
  }

  const prompt = [SYSTEM, "", "FACTS:", batch.map((facts) => factSheet(facts)).join("\n---\n")].join("\n");

  let raw: string;
  try {
    raw = await invoke({ prompt, estimatedCompletionTokens: Math.min(1200, batch.length * 40) });
  } catch (error) {
    return {
      steps: fallback(),
      note: `The model could not be reached (${error instanceof Error ? error.message : "unknown error"}), so these step sentences are the plain generated ones.`,
      modelCalls: 1,
      rejected: 0,
    };
  }

  const written = parseSentences(raw);
  let rejected = 0;
  const steps = batch.map((facts) => {
    const candidate = written.get(facts.stepNumber);
    if (candidate && sentenceIsGrounded(candidate, facts)) {
      return { stepNumber: facts.stepNumber, sentence: candidate, source: "model" as const };
    }
    if (candidate) rejected += 1;
    return {
      stepNumber: facts.stepNumber,
      sentence: deterministicSentence(facts),
      source: "deterministic" as const,
    };
  });

  return {
    steps,
    note: rejected
      ? `${rejected} model-written sentence(s) mentioned something the CAD facts do not support and were replaced with the plain generated sentence.`
      : "",
    modelCalls: 1,
    rejected,
  };
}

/**
 * Name a sub-assembly from the parts in it. Same rule: the model may only
 * rearrange words it was given, so a name containing a token that appears in no
 * member part name is rejected in favour of the largest member's own name.
 */
export async function nameSubAssembly(
  memberNames: string[],
  fallbackName: string,
  invoke: MeteredInvoke | null,
): Promise<{ name: string; source: "model" | "deterministic" }> {
  if (!invoke || !memberNames.length) return { name: fallbackName, source: "deterministic" };
  const prompt = [
    "Name this FRC robot sub-assembly in at most four words, using only words that appear in the part names below.",
    "Reply with ONLY the name. No punctuation, no quotes, no explanation.",
    "",
    ...memberNames.slice(0, 40).map((name) => `- ${name}`),
  ].join("\n");

  let raw: string;
  try {
    raw = await invoke({ prompt, estimatedCompletionTokens: 16 });
  } catch {
    return { name: fallbackName, source: "deterministic" };
  }
  const candidate = raw.trim().split("\n")[0]?.replace(/["'.]/g, "").trim() ?? "";
  if (!candidate || candidate.length > 48) return { name: fallbackName, source: "deterministic" };

  const vocabulary = new Set(
    memberNames
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  const words = candidate.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length || words.length > 4) return { name: fallbackName, source: "deterministic" };
  if (!words.every((word) => vocabulary.has(word))) return { name: fallbackName, source: "deterministic" };
  return { name: candidate, source: "model" };
}
