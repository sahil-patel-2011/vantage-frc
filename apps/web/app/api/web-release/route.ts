import notes from "../../../release-notes.json";
import { currentRelease, type ReleaseNotesFile } from "../../../lib/web-release/current-release";

export const dynamic = "force-dynamic";

/**
 * Which release this deployment is, and what changed in it. Public and read-only: it says
 * nothing about any team or account. The desktop app polls it to offer "Vantage has been
 * updated" with the notes before switching to a new deploy.
 */
export function GET() {
  return Response.json(currentRelease({
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    VERCEL_GIT_COMMIT_MESSAGE: process.env.VERCEL_GIT_COMMIT_MESSAGE,
    VANTAGE_RELEASE_SHA: process.env.VANTAGE_RELEASE_SHA,
  }, notes as ReleaseNotesFile), {
    headers: { "cache-control": "public, max-age=60, s-maxage=60" },
  });
}
