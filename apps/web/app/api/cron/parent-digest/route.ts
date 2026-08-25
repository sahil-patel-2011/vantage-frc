import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";
import { runParentDigest } from "../../../../lib/parent-comms/run-parent-digest";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Weekly parent digest: one-way, org -> parent contacts (never users rows).
 * Empty weeks send nothing; unconfigured email logs 'setup_required'; every
 * attempted delivery lands in parent_digest_sends. See run-parent-digest.ts.
 */
export async function GET(request: Request) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  return run();
}

export async function POST(request: Request) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  return run();
}

async function run() {
  try {
    const summary = await runParentDigest();
    return Response.json({ ok: true, summary });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Parent digest failed",
      },
      { status: 500 },
    );
  }
}
