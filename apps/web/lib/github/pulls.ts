import { asCommitSha } from "../bugbot/grounding";
import { githubFailure, parseOwnerRepo } from "./api";

type GitHubHttp = (path: string, init?: RequestInit) => Promise<Response>;

export type GitHubPullSummary = {
  number: number;
  title: string;
  authorLogin: string | null;
  htmlUrl: string | null;
  headSha: string;
  headRef: string | null;
  baseRef: string | null;
  draft: boolean;
  updatedAt: string | null;
};

export type GitHubPullDetail = GitHubPullSummary & {
  additions: number;
  deletions: number;
  changedFiles: number;
};

export type GitHubPullFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  /** Unified diff hunks. GitHub leaves it out for binary files and very large diffs. */
  patch: string | null;
};

function repoPath(fullName: string): string {
  const { owner, repo } = parseOwnerRepo(fullName);
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function toSummary(raw: Record<string, unknown>): GitHubPullSummary | null {
  const number = typeof raw.number === "number" ? raw.number : NaN;
  const head = (raw.head ?? {}) as Record<string, unknown>;
  const base = (raw.base ?? {}) as Record<string, unknown>;
  const user = (raw.user ?? {}) as Record<string, unknown>;
  const headSha = asCommitSha(typeof head.sha === "string" ? head.sha : null);
  if (!Number.isInteger(number) || number <= 0 || !headSha) return null;
  return {
    number,
    title: typeof raw.title === "string" ? raw.title.slice(0, 300) : "",
    authorLogin: typeof user.login === "string" ? user.login : null,
    htmlUrl: typeof raw.html_url === "string" ? raw.html_url : null,
    headSha,
    headRef: typeof head.ref === "string" ? head.ref : null,
    baseRef: typeof base.ref === "string" ? base.ref : null,
    draft: raw.draft === true,
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
  };
}

async function providerMessage(response: Response): Promise<string | undefined> {
  const data = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return typeof data?.message === "string" ? data.message : undefined;
}

/** Open pull requests, most recently updated first. */
export async function listOpenPulls(http: GitHubHttp, fullName: string, limit = 20): Promise<GitHubPullSummary[]> {
  const response = await http(
    `${repoPath(fullName)}/pulls?state=open&sort=updated&direction=desc&per_page=${Math.min(Math.max(limit, 1), 50)}`,
  );
  if (!response.ok) throw githubFailure(response, await providerMessage(response), "Could not list pull requests");
  const data = (await response.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => (item && typeof item === "object" ? toSummary(item as Record<string, unknown>) : null))
    .filter((item): item is GitHubPullSummary => Boolean(item));
}

export async function fetchPull(http: GitHubHttp, fullName: string, number: number): Promise<GitHubPullDetail> {
  if (!Number.isInteger(number) || number <= 0) throw new Error("Pull request number must be a positive integer");
  const response = await http(`${repoPath(fullName)}/pulls/${number}`);
  if (!response.ok) throw githubFailure(response, await providerMessage(response), "Could not load the pull request");
  const raw = (await response.json()) as Record<string, unknown>;
  const summary = toSummary(raw);
  if (!summary) throw new Error("GitHub returned a pull request without a head commit");
  const count = (value: unknown) => (typeof value === "number" && value >= 0 ? Math.floor(value) : 0);
  return {
    ...summary,
    additions: count(raw.additions),
    deletions: count(raw.deletions),
    changedFiles: count(raw.changed_files),
  };
}

/** The files a pull request changes, with their diff hunks. GitHub returns at most 3,000. */
export async function fetchPullFiles(
  http: GitHubHttp,
  fullName: string,
  number: number,
  maxFiles = 100,
): Promise<GitHubPullFile[]> {
  const files: GitHubPullFile[] = [];
  for (let page = 1; files.length < maxFiles && page <= 5; page += 1) {
    const response = await http(`${repoPath(fullName)}/pulls/${number}/files?per_page=100&page=${page}`);
    if (!response.ok) throw githubFailure(response, await providerMessage(response), "Could not load the pull request's files");
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data) || data.length === 0) break;
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const raw = item as Record<string, unknown>;
      if (typeof raw.filename !== "string") continue;
      files.push({
        filename: raw.filename,
        status: typeof raw.status === "string" ? raw.status : "modified",
        additions: typeof raw.additions === "number" ? raw.additions : 0,
        deletions: typeof raw.deletions === "number" ? raw.deletions : 0,
        patch: typeof raw.patch === "string" ? raw.patch : null,
      });
    }
    if (data.length < 100) break;
  }
  return files.slice(0, maxFiles);
}

/**
 * Register the repo webhook that tells Vantage about new and updated pull requests and pushes.
 * Needs a token allowed to manage the repo's webhooks (OAuth `repo` scope, or a fine-grained
 * token with Webhooks: Read and write); a read-only token gets a clear error instead.
 */
export async function createRepoWebhook(
  http: GitHubHttp,
  fullName: string,
  input: { url: string; secret: string },
): Promise<{ id: number }> {
  const response = await http(`${repoPath(fullName)}/hooks`, {
    method: "POST",
    body: JSON.stringify({
      name: "web",
      active: true,
      events: ["pull_request", "push"],
      config: { url: input.url, content_type: "json", secret: input.secret, insecure_ssl: "0" },
    }),
  });
  if (response.status === 403 || response.status === 404) {
    throw new GitHubWebhookPermissionError(await providerMessage(response));
  }
  if (!response.ok) throw githubFailure(response, await providerMessage(response), "Could not create the GitHub webhook");
  const data = (await response.json()) as { id?: unknown };
  if (typeof data.id !== "number") throw new Error("GitHub did not return a webhook id");
  return { id: data.id };
}

/** Remove the webhook Vantage created. Already gone counts as done. */
export async function deleteRepoWebhook(http: GitHubHttp, fullName: string, id: number): Promise<void> {
  const response = await http(`${repoPath(fullName)}/hooks/${id}`, { method: "DELETE" });
  if (response.ok || response.status === 404) return;
  throw githubFailure(response, await providerMessage(response), "Could not remove the GitHub webhook");
}

/** The saved token may read the repo but not manage its webhooks. */
export class GitHubWebhookPermissionError extends Error {
  constructor(providerMessage?: string) {
    super(
      "The connected GitHub sign-in can read this repository but not add a webhook to it" +
        (providerMessage ? ` (${providerMessage})` : "") +
        ". Add the webhook by hand with the address and secret shown, or reconnect with a token that can manage webhooks.",
    );
    this.name = "GitHubWebhookPermissionError";
  }
}
