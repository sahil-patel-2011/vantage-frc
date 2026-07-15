import { auth } from "@vantage/core";
import { buildDiffProposal, reviewFrcCode } from "@vantage/agent";
import { headers } from "next/headers";

async function current() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

const fail = (error: unknown) =>
  Response.json(
    { error: error instanceof Error ? error.message : "Code assistant request failed" },
    { status: 400 },
  );

/**
 * Deterministic FRC code review + proposal-only diffs.
 * Does not deploy code or call live LLM providers.
 */
export async function POST(request: Request) {
  try {
    await current();
    const body = (await request.json()) as {
      action?: "review" | "propose";
      path?: string;
      content?: string;
      summary?: string;
      unifiedDiff?: string;
    };
    const path = String(body.path ?? "Robot.java").slice(0, 260);
    const content = String(body.content ?? "");
    if (!content.trim()) throw new Error("content is required");
    if (content.length > 200_000) throw new Error("content exceeds the 200KB analysis limit");

    const review = reviewFrcCode({ path, content });
    if (body.action === "propose") {
      const proposal = buildDiffProposal({
        path,
        summary: String(body.summary ?? "Proposed safe change"),
        unifiedDiff: String(body.unifiedDiff ?? ""),
        review,
      });
      return Response.json({ review, proposal }, { status: 201 });
    }

    return Response.json({ review }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
