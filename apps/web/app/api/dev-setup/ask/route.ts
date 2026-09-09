import { randomUUID } from "node:crypto";
import { auth } from "@vantage/core";
import { meteredAI } from "@vantage/billing";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { getOrgPromptCachingEnabled, resolveOrgChatAdapter } from "@vantage/agent";
import { createBridgeTransport } from "../../../../lib/ai-bridge/transport";
import { failMeteredAi } from "../../../../lib/metered-ai-fail";
import { TRACK } from "../../../../lib/dev-setup/track";

/**
 * The assistant inside the setup guide.
 *
 * Context sharing is the whole point: a student stuck on step three should not
 * have to explain which step, which platform, or what their team's repo is. The
 * request carries the step id and platform, and the server assembles the rest —
 * the step's own instructions, and the team's own resources for that step.
 *
 * The team material is read through `withRls`, so a student on one team can
 * never pull another team's notes into their prompt, and there is no org
 * parameter in the request to forge.
 *
 * Metered through the normal billing path, so this counts against the team's
 * AI allowance like every other model call. It is deliberately capped small:
 * this answers "why is brew not found", not "write my subsystem".
 */

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function fail(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  // Credit caps, provider outages and BYOK problems all surface here and each
  // needs its own sentence — a generic 400 would tell a student their question
  // was malformed when the team has simply run out of AI allowance.
  return failMeteredAi(error, "Could not answer that right now.");
}

const MAX_QUESTION = 1200;

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");

    const body = (await request.json()) as { question?: string; stepId?: string; os?: string };
    const question = (body.question ?? "").trim().slice(0, MAX_QUESTION);
    if (!question) throw new HttpError(400, "Ask a question first");
    const os = body.os === "mac" ? "mac" : "windows";

    const step = TRACK.flatMap((stage) => stage.steps).find((s) => s.id === body.stepId);

    const answer = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{ orgId: string; orgName: string }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName"
           FROM memberships m JOIN organizations o ON o.id = m.org_id
          WHERE m.user_id = $1::uuid ORDER BY o.name LIMIT 1`,
        [session.user.id],
      );
      const org = membership.rows[0];
      if (!org) throw new HttpError(403, "Organization membership required");

      // The team's own material for this step. RLS scopes it to their org.
      const resources = await client.query<{ title: string; url: string | null; body: string }>(
        `SELECT title, url, body FROM team_resources
          WHERE org_id = $1::uuid AND (step_id = $2 OR step_id IS NULL)
          ORDER BY step_id NULLS LAST, created_at DESC
          LIMIT 12`,
        [org.orgId, body.stepId ?? null],
      );

      const teamContext = resources.rows.length
        ? resources.rows
            .map((r) => `- ${r.title}${r.url ? ` (${r.url})` : ""}${r.body ? `: ${r.body}` : ""}`)
            .join("\n")
        : "(this team has not added any of its own notes for this step yet)";

      const stepContext = step
        ? [
            `STEP THEY ARE ON: ${step.title}`,
            `WHY IT MATTERS: ${step.why}`,
            `INSTRUCTIONS THEY ARE FOLLOWING:\n${step.install.map((l) => `  - ${l}`).join("\n")}`,
            step.commands?.[os] ? `COMMANDS FOR THEIR PLATFORM:\n${step.commands[os]!.join("\n")}` : "",
            `HOW THEY KNOW IT WORKED: ${step.verify}`,
          ]
            .filter(Boolean)
            .join("\n")
        : "They are looking at the guide generally, not one specific step.";

      const prompt = [
        "You are helping a high-school student on an FRC robotics team set up their laptop for programming.",
        "They may be 14 and this may be their first time using a terminal. Be concrete and kind. Never condescending.",
        "",
        `PLATFORM: ${os === "mac" ? "macOS" : "Windows"}. Only give instructions for this platform.`,
        `TEAM: ${org.orgName}`,
        "",
        stepContext,
        "",
        "THEIR TEAM'S OWN NOTES (prefer these over generic advice — they are specific to this team):",
        teamContext,
        "",
        `THEIR QUESTION: ${question}`,
        "",
        "Rules for your answer:",
        "- Answer in under 150 words unless they asked for a walkthrough.",
        "- Give exact commands they can paste, and say what each one does.",
        "- If the answer is in their team's notes above, use it and say it came from their team.",
        "- If you are not sure, say so and tell them who to ask, rather than guessing at a command.",
        "- Never invent a download URL. If you do not know the link, tell them to use the download button on this page.",
      ].join("\n");

      const promptCachingEnabled = await getOrgPromptCachingEnabled(client, org.orgId);
      const adapter = await resolveOrgChatAdapter(client, {
        orgId: org.orgId,
        userId: session.user.id,
        promptCachingEnabled,
        feature: "dev_setup_help",
        bridgeTransport: createBridgeTransport(),
      });

      const text = await meteredAI({
        client,
        orgId: org.orgId,
        userId: session.user.id,
        feature: "dev_setup_help",
        requestId: randomUUID(),
        estimatedCostUsd: 0.003,
        estimatedPromptTokens: Math.ceil(prompt.length / 4),
        estimatedCompletionTokens: 200,
        provider: adapter.provider,
        model: adapter.model,
        metadata: {
          action: "dev_setup_help",
          stepId: step?.id ?? null,
          os,
          teamNotesUsed: resources.rows.length,
        },
        invoke: async () => {
          const completion = await adapter.complete({
            message: prompt,
            context: [],
            promptCachingEnabled,
          });
          return {
            value: completion.text,
            promptTokens: completion.promptTokens,
            completionTokens: completion.completionTokens,
            costUsd: completion.costUsd,
            model: adapter.model,
            provider: adapter.provider,
            cacheReadInputTokens: completion.cacheReadInputTokens,
            cacheWriteInputTokens: completion.cacheWriteInputTokens,
            uncachedInputTokens: completion.uncachedInputTokens,
          };
        },
      });

      return { text: text.trim(), usedTeamNotes: resources.rows.length };
    });

    if (!answer.text) {
      return Response.json({ error: "The model returned nothing. Try rephrasing." }, { status: 502 });
    }
    return Response.json(answer);
  } catch (error) {
    return fail(error);
  }
}
