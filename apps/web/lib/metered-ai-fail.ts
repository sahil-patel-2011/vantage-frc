import {
  classifyMeteredAiError,
  meteredAiErrorBody,
  meteredAiErrorResponse,
} from "@vantage/billing";

/**
 * Shared fail mapper for metered AI routes (chat, CAD, writer, grants, kickoff, insights).
 * Prefer typed cutoff responses (402/403) before falling back to the route's default status.
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

  const message = error instanceof Error ? error.message : fallbackMessage;
  let status = fallbackStatus;
  if (/Authentication required|Unauthorized/i.test(message)) status = 401;
  else if (/access denied|membership required|forbidden/i.test(message)) status = 403;
  else if (/not found/i.test(message)) status = 404;

  return Response.json({ error: message }, { status });
}
