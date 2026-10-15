/**
 * The release this deployment is: what /api/web-release serves, and what the desktop app shows in
 * "Vantage has been updated".
 *
 * Every production deploy is a release. Its id is the deployed commit, so a new deploy is
 * always a new release; its notes are the hand-written entry for the merged pull request
 * (apps/web/release-notes.json) when there is one, and the pull request's title when there
 * is not, so a deploy never ships without a line saying what it is.
 */

export type ReleaseNote = { pr: number; date: string; headline: string; changes: string[] };
export type ReleaseNotesFile = { releases: ReleaseNote[] };
export type CurrentRelease = {
  id: string;
  headline: string;
  changes: string[];
  date: string | null;
  pr: number | null;
};

type ReleaseEnv = {
  VERCEL_GIT_COMMIT_SHA?: string;
  VERCEL_GIT_COMMIT_MESSAGE?: string;
  VANTAGE_RELEASE_SHA?: string;
};

/** "Merge pull request #2392 from owner/branch\n\nTitle" → 2392. */
export function pullRequestNumber(message: string): number | null {
  const match = /Merge pull request #(\d+)/.exec(message);
  return match ? Number(match[1]) : null;
}

/** The merged pull request's title (its second paragraph), or a plain commit's first line. */
export function releaseTitle(message: string): string | null {
  const parts = message.split(/\r?\n\s*\r?\n/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const first = parts[0]!.split(/\r?\n/)[0]!.trim();
  const title = /^Merge pull request #\d+/.test(first) ? parts[1]?.split(/\r?\n/)[0]?.trim() : first;
  return title ? title.slice(0, 160) : null;
}

export function currentRelease(env: ReleaseEnv, notes: ReleaseNotesFile): CurrentRelease {
  const sha = (env.VERCEL_GIT_COMMIT_SHA || env.VANTAGE_RELEASE_SHA || "").trim();
  const message = env.VERCEL_GIT_COMMIT_MESSAGE ?? "";
  const pr = pullRequestNumber(message);
  const entry = pr != null ? notes.releases.find((release) => release.pr === pr) ?? null : null;
  return {
    id: sha ? sha.slice(0, 12) : "local",
    headline: entry?.headline ?? releaseTitle(message) ?? "Vantage has been updated",
    changes: entry?.changes ?? [],
    date: entry?.date ?? null,
    pr,
  };
}
