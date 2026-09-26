import { ChatProviderResolutionError } from "@vantage/agent";
import {
  classifyMeteredAiError,
  meteredAiErrorBody,
  meteredAiErrorResponse,
} from "@vantage/billing";

export type MeteredAiSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

const PROVIDER_SETUP_STEPS: MeteredAiSetupStep[] = [
  {
    id: "keys",
    label: "Add an AI provider key",
    detail: "Paste an OpenAI, Anthropic, or Google key, or a local OpenAI-compatible address, under Team → AI keys.",
    href: "/team/ai-keys",
  },
  {
    id: "budgets",
    label: "Review Chat limits",
    detail: "Spend and token limits apply before every Chat message.",
    href: "/ai?tab=budgets",
  },
  {
    id: "governance",
    label: "Check AI governance",
    detail: "Which tools Chat may use, and who must approve a costly call, can still block a message even when a key exists.",
    href: "/ai?tab=governance",
  },
];

function isProviderSetupError(error: unknown): boolean {
  if (error instanceof ChatProviderResolutionError) return true;
  if (!error || typeof error !== "object") return false;
  const name = "name" in error && typeof error.name === "string" ? error.name : "";
  if (name === "ChatProviderResolutionError") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /No AI provider key|No configured model|could not be decrypted|local desktop relay|API key was rejected|KMS setup|must configure a BYO AI key/i.test(
    message,
  );
}

/**
 * "AI is off for this team" in the words a student reads. The router's own message names
 * environment variables (OPENROUTER_API_KEY, AI_HORDE_POOL) and "BYO"; teams never see hosting
 * plumbing, so that version goes to the server log only. Key problems a team can fix themselves
 * ("could not be decrypted", "was rejected") keep their own message.
 */
export const AI_OFF_MESSAGE =
  "AI isn't on for your team yet. An owner or admin can turn it on under Team → AI keys; a free Google Gemini key takes about two minutes.";

function isAiOffError(message: string): boolean {
  return /No AI provider key|must configure a BYO AI key|local desktop relay/i.test(message);
}

/**
 * Shared fail mapper for metered AI routes (chat, CAD, writer, grants, kickoff, insights).
 * Prefer typed cutoff responses (402/403), then honest setup_required when providers/keys
 * are missing — never invent model output.
 */
export function failMeteredAi(
  error: unknown,
  fallbackMessage: string,
  fallbackStatus = 400,
): Response {
  const cutoff = meteredAiErrorResponse(error);
  if (cutoff) return cutoff;

  const classified = classifyMeteredAiError(error);
  if (classified) {
    return Response.json(meteredAiErrorBody(classified), { status: classified.status });
  }

  if (isProviderSetupError(error)) {
    const raw = error instanceof Error ? error.message : "No AI provider key is configured for this organization.";
    const aiOff = isAiOffError(raw);
    if (aiOff) console.warn("[metered-ai] AI is off for this team:", raw);
    const message = aiOff ? AI_OFF_MESSAGE : raw;
    return Response.json(
      {
        error: message,
        code: "setup_required",
        status: "setup_required",
        message,
        steps: PROVIDER_SETUP_STEPS,
      },
      { status: 503 },
    );
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  let status = fallbackStatus;
  if (/Authentication required|Unauthorized/i.test(message)) status = 401;
  else if (/access denied|membership required|forbidden/i.test(message)) status = 403;
  else if (/not found/i.test(message)) status = 404;

  return Response.json({ error: message }, { status });
}
