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
    detail: "BYOK or custom OpenAI/Anthropic under Team Admin — no invented model output without a key.",
    href: "/team/admin",
  },
  {
    id: "budgets",
    label: "Review API budgets",
    detail: "Hard spend and token limits apply before every metered call.",
    href: "/ai?tab=budgets",
  },
  {
    id: "governance",
    label: "Check AI governance",
    detail: "Feature allowlists and approvals may block a call even when a key exists.",
    href: "/ai?tab=governance",
  },
];

function isProviderSetupError(error: unknown): boolean {
  if (error instanceof ChatProviderResolutionError) return true;
  if (!error || typeof error !== "object") return false;
  const name = "name" in error && typeof error.name === "string" ? error.name : "";
  if (name === "ChatProviderResolutionError") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /No AI provider key|No configured model|could not be decrypted|local desktop relay/i.test(
    message,
  );
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
    const message =
      error instanceof Error ? error.message : "No AI provider key is configured for this organization.";
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
