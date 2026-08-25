// Optional "Expand with AI" view-model — pure, shared by the surfaces that
// upgraded from a deterministic template to an opt-in metered AI path
// (AI insight panels, Season Report narrative, Match Debrief coach).
//
// The contract (learning_coach pattern): the deterministic text ALWAYS renders,
// labeled "Computed from your data". The AI expansion is an optional extra on
// top; when no adapter resolves (503 setup_required), when the run is cut off,
// or when the upstream fails, the surface degrades to the deterministic text —
// the AI badge only ever sits over a real metered model response.

export type AiExpansion = {
  text: string;
  generatedAt: string;
  provider: string;
  model: string;
  /** Origin the call actually went to (never a full URL); null when unreported. */
  baseUrlOrigin: string | null;
  /** Which key paid for the call (org/hosted/…); null when unreported. */
  keySource: string | null;
};

export type AiExpandState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; expansion: AiExpansion }
  | { status: "unavailable"; note: string };

export const AI_EXPAND_IDLE: AiExpandState = { status: "idle" };

export type ExpandedDisplay = {
  /** What the panel shows — never empty while deterministic text exists. */
  text: string;
  /** Label policy for the attribution chip under `text`. */
  kind: "computed" | "ai";
  /** Secondary AI paragraph to render under the deterministic text (ready only). */
  aiText: string | null;
  /** Setup/failure note to show without discarding the deterministic text. */
  note: string | null;
};

/**
 * Merge the deterministic text with the optional AI expansion. Degrades to the
 * deterministic text (kind "computed") in every non-ready state; an empty or
 * whitespace AI response also degrades rather than rendering a blank AI badge.
 */
export function expandedDisplay(deterministicText: string, state: AiExpandState): ExpandedDisplay {
  const base: ExpandedDisplay = {
    text: deterministicText,
    kind: "computed",
    aiText: null,
    note: null,
  };
  if (state.status === "ready") {
    const aiText = state.expansion.text.trim();
    if (!aiText) return base;
    return { ...base, kind: "ai", aiText };
  }
  if (state.status === "unavailable") {
    return { ...base, note: state.note };
  }
  return base;
}

/**
 * Map an expand-request failure to the state that keeps the deterministic text
 * on screen. 503/setup_required means "configure a model" — an optional extra,
 * never a failed feature.
 */
export function expandFailureState(input: {
  httpStatus: number;
  code?: string | null;
  error?: string | null;
}): AiExpandState {
  if (input.httpStatus === 503 || input.code === "setup_required") {
    return {
      status: "unavailable",
      note: "AI expansion needs a configured model (Team → AI API keys). Showing the computed summary.",
    };
  }
  const detail = input.error?.trim();
  return {
    status: "unavailable",
    note: detail
      ? `AI expansion unavailable (${detail}). Showing the computed summary.`
      : "AI expansion unavailable right now. Showing the computed summary.",
  };
}

/** Parse a successful expand response body into a ready state (or degrade). */
export function expandSuccessState(body: unknown): AiExpandState {
  if (!body || typeof body !== "object") {
    return expandFailureState({ httpStatus: 200, error: "empty response" });
  }
  const record = body as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) return expandFailureState({ httpStatus: 200, error: "empty response" });
  return {
    status: "ready",
    expansion: {
      text,
      generatedAt:
        typeof record.generatedAt === "string" && record.generatedAt
          ? record.generatedAt
          : new Date().toISOString(),
      provider: typeof record.provider === "string" ? record.provider : "unknown",
      model: typeof record.model === "string" ? record.model : "unknown",
      baseUrlOrigin:
        typeof record.baseUrlOrigin === "string" && record.baseUrlOrigin ? record.baseUrlOrigin : null,
      keySource: typeof record.keySource === "string" && record.keySource ? record.keySource : null,
    },
  };
}
