/**
 * Vercel Workflow runs are opt-in: VANTAGE_DURABLE_WORKFLOWS=1.
 *
 * Off (the default), a background job (team setup, the Google Sheets hub sync, a recovery export)
 * runs its same steps right after the response, in the function that answered the request, so
 * Vercel hosts only the website and bills no Workflow runs or events. What that gives up is the
 * Workflow's automatic step retries; each job already records its progress and offers
 * "Retry to resume". Turn it on when a job outgrows one function's time limit.
 */
export function durableWorkflowsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|on|yes)$/i.test(env.VANTAGE_DURABLE_WORKFLOWS?.trim() ?? "");
}
