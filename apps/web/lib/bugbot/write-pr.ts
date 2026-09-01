/**
 * Human-approved Bugbot write-PR path.
 *
 * A proposed diff is not a push. This module prepares a pull request against
 * the repository+sha `resolveBugbotTarget` already chose — never the Code
 * Coach teaching sample or the editor textarea. Opening the PR still requires
 * an explicit `humanApproved` flag; without it the result stays proposal-only.
 */

import { lastScanFromReview, resolveBugbotTarget, type BugbotScanTarget } from "./grounding";

export type BugbotWritePrInput = {
  phase: "scan" | "fix" | "recheck";
  scanRepoRequested?: boolean;
  lastScan: BugbotScanTarget | null;
  humanApproved: boolean;
  unifiedDiff?: string | null;
  title?: string | null;
  body?: string | null;
};

export type BugbotWritePrPrepared = {
  ready: boolean;
  requiresHumanApproval: true;
  pushedToGitHub: false;
  executionState: "proposal_only" | "approved_ready";
  useRepo: true;
  repo: string;
  ref: string;
  baseSha: string;
  headBranch: string;
  title: string;
  body: string;
  paths: string[];
  unifiedDiff: string;
  compareUrl: string;
};

export type BugbotGitHubHttp = (path: string, init?: RequestInit) => Promise<Response>;

export function lastScanFromStoredReview(review: {
  githubRepo?: string | null;
  githubRef?: string | null;
  githubSha?: string | null;
} | null): BugbotScanTarget | null {
  return lastScanFromReview(review);
}

export function parseBugbotDiffPaths(unifiedDiff: string | null | undefined): string[] {
  if (!unifiedDiff?.trim()) return [];
  const paths = new Set<string>();
  for (const line of unifiedDiff.split("\n")) {
    const match = line.match(/^(?:--- a\/|\+\+\+ b\/)(.+)$/);
    const path = match?.[1]?.trim() ?? "";
    if (!path || path === "/dev/null" || path.includes("..") || path.startsWith("/")) continue;
    paths.add(path);
  }
  return [...paths];
}

function splitDiffByFile(unifiedDiff: string): Array<{ path: string; body: string }> {
  const sections: Array<{ path: string; body: string }> = [];
  const blocks = unifiedDiff.replace(/\r\n/g, "\n").split(/^diff --git /m);
  const raw = blocks.length > 1 ? blocks.slice(1).map((block) => `diff --git ${block}`) : [unifiedDiff];
  for (const block of raw) {
    const path = parseBugbotDiffPaths(block)[0];
    if (!path) continue;
    const hunkStart = block.search(/^@@ /m);
    sections.push({ path, body: hunkStart >= 0 ? block.slice(hunkStart) : block });
  }
  return sections;
}

function applyFileDiff(original: string, fileDiff: string): string {
  const normalized = original.replace(/\r\n/g, "\n");
  const trailed = normalized.endsWith("\n");
  const result = (trailed ? normalized.slice(0, -1) : normalized).split("\n");
  const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
  const lines = fileDiff.replace(/\r\n/g, "\n").split("\n");
  const hunks: Array<{ oldStart: number; expected: string[]; replacement: string[] }> = [];
  let current: { oldStart: number; expected: string[]; replacement: string[] } | null = null;
  for (const line of lines) {
    const header = line.match(hunkHeader);
    if (header) {
      current = { oldStart: Number(header[1]), expected: [], replacement: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("\\")) continue;
    if (line.startsWith("-")) {
      current.expected.push(line.slice(1));
      continue;
    }
    if (line.startsWith("+")) {
      current.replacement.push(line.slice(1));
      continue;
    }
    const ctx = line.startsWith(" ") ? line.slice(1) : line;
    current.expected.push(ctx);
    current.replacement.push(ctx);
  }
  if (!hunks.length) throw new Error("unified diff has no hunks to apply");
  for (const hunk of [...hunks].reverse()) {
    const start = Math.max(0, hunk.oldStart - 1);
    const slice = result.slice(start, start + hunk.expected.length);
    if (slice.join("\n") !== hunk.expected.join("\n")) {
      throw new Error("diff does not apply to the file at the scanned commit");
    }
    result.splice(start, hunk.expected.length, ...hunk.replacement);
  }
  const next = result.join("\n");
  return trailed ? `${next}\n` : next;
}

/**
 * Apply a grounded unified diff onto files loaded from the scanned commit.
 * Paths that are not in `originals` are refused — that is the textarea leak.
 */
export function applyBugbotDiffToFiles(
  originals: Array<{ path: string; content: string }>,
  unifiedDiff: string,
): Array<{ path: string; content: string }> {
  const byPath = new Map(originals.map((file) => [file.path.replace(/\\/g, "/"), file.content]));
  const sections = splitDiffByFile(unifiedDiff);
  if (!sections.length) throw new Error("unified diff has no file hunks");
  return sections.map((section) => {
    if (!byPath.has(section.path)) {
      throw new Error(`diff path ${section.path} was not loaded from the scanned commit`);
    }
    return { path: section.path, content: applyFileDiff(byPath.get(section.path)!, section.body) };
  });
}

function parseOwnerRepo(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  if (!owner?.trim() || !repo?.trim() || fullName.includes("..") || fullName.split("/").length !== 2) {
    throw new Error("Invalid repository full name (expected owner/repo)");
  }
  return { owner: owner.trim(), repo: repo.trim() };
}

function bugbotHeadBranch(sha: string): string {
  return `vantage/bugbot-${sha.slice(0, 7)}`;
}

function defaultTitle(paths: string[]): string {
  if (paths.length === 1) return `fix: Bugbot proposal for ${paths[0]}`;
  return `fix: Bugbot proposal (${paths.length || "robot-code"} files)`;
}

function defaultBody(input: { repo: string; sha: string; paths: string[] }): string {
  return [
    "Human-approved Bugbot proposal.",
    "",
    `Grounded to ${input.repo}@${input.sha} — not the editor buffer.`,
    input.paths.length ? `Files: ${input.paths.join(", ")}` : "No file paths parsed from the diff.",
    "",
    "Vantage does not merge or deploy this branch.",
  ].join("\n");
}

/**
 * Prepare a write-PR against the scanned repo+sha. Buffer / sample scans throw.
 * Without `humanApproved` the payload stays `proposal_only`.
 */
export function prepareBugbotWritePr(input: BugbotWritePrInput): BugbotWritePrPrepared {
  if (input.phase !== "fix") {
    throw new Error("write-PR is only available for a human-approved fix");
  }
  const target = resolveBugbotTarget({
    phase: input.phase,
    scanRepoRequested: Boolean(input.scanRepoRequested),
    lastScan: input.lastScan,
  });
  if (!target.useRepo || !target.repo?.trim()) {
    throw new Error("write-PR requires a repository scan target (repo + sha), not the editor buffer");
  }
  const sha = target.pinnedSha;
  if (!sha) {
    throw new Error("write-PR requires the scanned commit sha from resolveBugbotTarget");
  }
  const unifiedDiff = input.unifiedDiff?.trim() ?? "";
  if (!unifiedDiff) {
    throw new Error("write-PR requires a grounded unified diff");
  }
  const repo = target.repo.trim();
  const ref = target.ref?.trim() || "main";
  const paths = parseBugbotDiffPaths(unifiedDiff);
  const headBranch = bugbotHeadBranch(sha);
  const title = input.title?.trim() || defaultTitle(paths);
  const body = input.body?.trim() || defaultBody({ repo, sha, paths });
  const compareUrl = `https://github.com/${repo}/compare/${encodeURIComponent(ref)}...${encodeURIComponent(headBranch)}?quick_pull=1`;
  return {
    ready: Boolean(input.humanApproved),
    requiresHumanApproval: true,
    pushedToGitHub: false,
    executionState: input.humanApproved ? "approved_ready" : "proposal_only",
    useRepo: true,
    repo,
    ref,
    baseSha: sha,
    headBranch,
    title,
    body,
    paths,
    unifiedDiff,
    compareUrl,
  };
}

async function readGitHubJson(response: Response, fallback: string): Promise<Record<string, unknown>> {
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.message ?? fallback));
  }
  return data;
}

/**
 * Open the prepared PR. Refuses unless `prepareBugbotWritePr` returned
 * `approved_ready`. Files must already be the scanned-commit contents with the
 * grounded diff applied — never a textarea snapshot.
 */
export async function submitApprovedBugbotPullRequest(
  http: BugbotGitHubHttp,
  prepared: BugbotWritePrPrepared,
  files: Array<{ path: string; content: string }>,
): Promise<{ htmlUrl: string; number: number; headBranch: string; openedPullRequest: true }> {
  if (!prepared.ready || prepared.executionState !== "approved_ready") {
    throw new Error("write-PR is proposal-only until a human approves it");
  }
  if (!files.length) {
    throw new Error("write-PR has no grounded files to commit");
  }
  for (const file of files) {
    if (prepared.paths.length && !prepared.paths.includes(file.path)) {
      throw new Error(`write-PR file ${file.path} is not in the grounded diff`);
    }
  }
  const { owner, repo } = parseOwnerRepo(prepared.repo);
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const createRef = await http(`${repoPath}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${prepared.headBranch}`, sha: prepared.baseSha }),
  });
  if (!createRef.ok && createRef.status !== 422) {
    await readGitHubJson(createRef, "Could not create the Bugbot pull-request branch");
  }

  for (const file of files) {
    const encodedPath = file.path
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const existing = await http(
      `${repoPath}/contents/${encodedPath}?ref=${encodeURIComponent(prepared.headBranch)}`,
    );
    const existingJson = existing.ok ? ((await existing.json()) as { sha?: string }) : {};
    const put = await http(`${repoPath}/contents/${encodedPath}`, {
      method: "PUT",
      body: JSON.stringify({
        message: prepared.title,
        content: Buffer.from(file.content, "utf8").toString("base64"),
        branch: prepared.headBranch,
        sha: typeof existingJson.sha === "string" ? existingJson.sha : undefined,
      }),
    });
    await readGitHubJson(put, `Could not write ${file.path} on the Bugbot branch`);
  }

  const pull = await http(`${repoPath}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: prepared.title,
      head: prepared.headBranch,
      base: prepared.ref,
      body: prepared.body,
    }),
  });
  const opened = await readGitHubJson(pull, "Could not open the Bugbot pull request");
  const htmlUrl = typeof opened.html_url === "string" ? opened.html_url : "";
  const number = typeof opened.number === "number" ? opened.number : 0;
  if (!htmlUrl.startsWith("https://") || number < 1) {
    throw new Error("GitHub did not return a pull request URL");
  }
  return { htmlUrl, number, headBranch: prepared.headBranch, openedPullRequest: true };
}
