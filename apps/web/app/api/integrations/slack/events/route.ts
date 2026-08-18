import { requestPool } from "@vantage/db";
import { createRateLimiter, rateLimitedResponse } from "../../../../../lib/rate-limit";
import {
  slackEventShouldIngest,
  slackSetupStatus,
  verifySlackSignature,
} from "../../../../../lib/slack";

export const runtime = "nodejs";

const limiter = createRateLimiter({ limit: 120, windowMs: 60_000, namespace: "slack-events" });

type SlackEnvelope = {
  type?: string;
  challenge?: string;
  team_id?: string;
  event_id?: string;
  event?: {
    type?: string;
    subtype?: string;
    bot_id?: string;
    user?: string;
    text?: string;
    channel?: string;
    channel_type?: string;
    ts?: string;
    username?: string;
  };
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!(await limiter.allow(request.headers.get("x-forwarded-for") ?? "slack"))) {
    return rateLimitedResponse();
  }

  let payload: SlackEnvelope;
  try {
    payload = JSON.parse(rawBody) as SlackEnvelope;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload.type === "url_verification" && typeof payload.challenge === "string") {
    return Response.json({ challenge: payload.challenge });
  }

  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
  const signature = request.headers.get("x-slack-signature") ?? "";
  const teamId = payload.team_id?.trim() ?? "";

  const platformSecret = process.env.SLACK_SIGNING_SECRET?.trim() ?? "";
  let verified = platformSecret
    ? verifySlackSignature({ signingSecret: platformSecret, timestamp, rawBody, signature })
    : false;
  if (!verified && teamId) {
    const secretRow = await requestPool.query<{ secret: string | null }>(
      `SELECT slack_signing_secret_for_workspace($1) AS secret`,
      [teamId],
    );
    const orgSecret = secretRow.rows[0]?.secret?.trim() ?? "";
    if (orgSecret) {
      verified = verifySlackSignature({ signingSecret: orgSecret, timestamp, rawBody, signature });
    }
  }
  if (!verified) {
    if (!slackSetupStatus().configured && !teamId) {
      return Response.json({ error: "Slack signing is not configured" }, { status: 503 });
    }
    return Response.json({ error: "Invalid Slack signature" }, { status: 401 });
  }

  if (payload.type !== "event_callback") {
    return Response.json({ ok: true, ignored: true });
  }

  const event = payload.event;
  if (!slackEventShouldIngest(event)) {
    return Response.json({ ok: true, ignored: true });
  }

  const result = await requestPool.query<{ ingest: Record<string, unknown> }>(
    `SELECT ingest_slack_team_message($1,$2,$3,$4,$5,$6,$7) AS ingest`,
    [
      teamId,
      event?.channel ?? "",
      event?.user ?? "",
      payload.event_id ?? event?.ts ?? "",
      event?.ts ?? null,
      event?.text ?? "",
      event?.username ?? event?.user ?? "Slack",
    ],
  );
  return Response.json(result.rows[0]?.ingest ?? { ok: false });
}
