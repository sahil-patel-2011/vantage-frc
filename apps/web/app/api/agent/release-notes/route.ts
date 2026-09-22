import { z } from "zod";
import {
  assertReleaseAgentAuthorized,
  publishReleaseFromAgent,
} from "../../../../lib/release-notes/agent-publish";
import { composeReleaseNotes } from "@vantage/core";

export const runtime = "nodejs";

/**
 * Release notes for machines.
 *
 *   curl -X POST https://<host>/api/agent/release-notes \
 *     -H "Authorization: Bearer $RELEASE_AGENT_TOKEN" \
 *     -H "content-type: application/json" \
 *     -d '{"version":"2026.3","headline":"Scouting is faster on the field",
 *          "added":["Tap-based match scoring"],"fixed":["Team profiles no longer crash"]}'
 *
 * The caller supplies facts only. Wording, section order, and formatting come
 * from composeReleaseNotes, so every published note looks identical. Pass
 * "preview": true to see the rendered note without publishing, or "draft": true
 * to stage it for a human to publish from the admin console.
 */

const bulletList = z.array(z.string().trim().min(1).max(400)).max(24);

const schema = z.object({
  version: z.string().trim().min(1).max(40),
  headline: z.string().trim().min(3).max(300),
  added: bulletList.optional(),
  improved: bulletList.optional(),
  fixed: bulletList.optional(),
  draft: z.boolean().optional(),
  preview: z.boolean().optional(),
});

export async function POST(request: Request) {
  const denied = assertReleaseAgentAuthorized(request);
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "A JSON body is required" }, { status: 400 });
  }

  const body = schema.safeParse(raw);
  if (!body.success) {
    return Response.json(
      { error: "Invalid release payload.", details: body.error.flatten() },
      { status: 400 },
    );
  }

  const { preview, ...input } = body.data;

  try {
    if (preview) {
      const composed = composeReleaseNotes(input);
      return Response.json({ status: "preview", ...composed });
    }

    const result = await publishReleaseFromAgent(input);
    return Response.json({
      status: result.release.status === "published" ? "published" : "draft",
      created: result.created,
      release: {
        id: result.release.id,
        slug: result.release.slug,
        title: result.release.title,
        versionLabel: result.release.versionLabel,
        publishedAt: result.release.publishedAt,
        notesMarkdown: result.release.notesMarkdown,
      },
      url: `/whats-new#${result.release.slug}`,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Release publish failed" },
      { status: 400 },
    );
  }
}
