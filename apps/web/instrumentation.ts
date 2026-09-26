import type { Instrumentation } from "next";

/**
 * Every server error, as one structured log line (Vercel's runtime logs keep and search them),
 * and optionally posted to ERROR_WEBHOOK_URL (Slack, Discord or any collector) so someone hears
 * about it. Only the route, method, error name, a trimmed message and React's digest leave the
 * server: no headers, cookies, query strings or bodies, which can carry tokens and student data.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const error = err instanceof Error ? err : new Error(String(err));
  const digest =
    typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  const report = {
    level: "error",
    at: new Date().toISOString(),
    method: request.method,
    // The path only: query strings carry invite and display tokens.
    path: request.path.split("?")[0],
    route: context.routePath,
    routeType: context.routeType,
    name: error.name,
    message: error.message.slice(0, 300),
    digest,
  };
  console.error(JSON.stringify(report));

  const webhook = process.env.ERROR_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Slack and Discord both read `text` / `content`; other collectors get the fields.
      body: JSON.stringify({
        ...report,
        text: `Vantage server error on ${report.method} ${report.path}: ${report.name}: ${report.message}`,
        content: `Vantage server error on ${report.method} ${report.path}: ${report.name}: ${report.message}`,
      }),
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // Reporting must never turn one error into two.
  }
};
