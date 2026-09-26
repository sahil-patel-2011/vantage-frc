import type { PoolClient } from "@neondatabase/serverless";
import { listOnshapeFeatures, readOnshapeMassProperties, resolveOnshapeBind } from "@vantage/cad";
import { acquireOnshape } from "../cad-learn/onshape-access";
import { checkFeatures, checkNumbers, checkPaste, parseGitHubUrl } from "./checks";
import { checkPullRequestChanges, runPasteVerifier } from "./checks-6925";
import { isOnshapeApiCheck, onshapeAccessMessage, onshapeLinkProblem, runOnshapeApiCheck } from "./checks-onshape";
import type { CheckResult, StepCheck } from "./types";

export type CheckInput = { url?: string; text?: string; values?: Record<string, unknown> };

const GITHUB_TIMEOUT_MS = 8_000;

async function github(path: string): Promise<Response | null> {
  try {
    return await fetch(`https://api.github.com${path}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "VantageFRC-guided-check" },
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

function githubTrouble(response: Response | null): CheckResult | null {
  if (!response) return { passed: false, message: "GitHub did not answer. Check your connection and try again." };
  if (response.status === 403 || response.status === 429) {
    return { passed: false, message: "GitHub is limiting checks right now. Try again in a few minutes." };
  }
  if (response.status === 404) {
    return {
      passed: false,
      message: "GitHub says that does not exist, or the repository is private. Checks can only read public repositories; ask a lead to sign this step off for a private one.",
    };
  }
  if (!response.ok) return { passed: false, message: `GitHub answered ${response.status}. Try again in a minute.` };
  return null;
}

/**
 * Runs one step's check for the signed-in student. Onshape reads use their own connection;
 * GitHub reads are public API calls; paste and number checks run here and never leave the server.
 * A lead sign-off is not something the student can run.
 */
export async function runGuidedCheck(
  client: PoolClient,
  who: { orgId: string; userId: string },
  check: StepCheck,
  input: CheckInput,
): Promise<CheckResult> {
  if (isOnshapeApiCheck(check)) {
    const problem = onshapeLinkProblem(String(input.url ?? ""));
    if (problem) return { passed: false, message: problem };
    const access = await acquireOnshape(client, who.orgId, who.userId);
    if (!access.ok) return { passed: false, message: onshapeAccessMessage(access.message) };
    return runOnshapeApiCheck(access.http, check, String(input.url));
  }
  switch (check.kind) {
    case "paste":
      return check.verify ? runPasteVerifier(check, String(input.text ?? "")) : checkPaste(check, String(input.text ?? ""));
    case "numbers":
      return checkNumbers(check, input.values ?? {});
    case "lead-signoff":
      // Software cannot see a band saw or a printed checklist. The student marks it after a lead
      // has checked it with them, and the page labels it that way, never as "checked by Vantage".
      return input.values?.confirmed === true
        ? { passed: true, message: "Marked done after a lead checked it with you." }
        : { passed: false, message: "Ask a team lead to check this with you, then mark it done." };
    case "github-pr":
    case "github-tag": {
      const ref = parseGitHubUrl(String(input.url ?? ""));
      if (!ref || (check.kind === "github-pr" && ref.kind !== "pr") || (check.kind === "github-tag" && ref.kind !== "tag")) {
        return {
          passed: false,
          message:
            check.kind === "github-pr"
              ? "Paste a pull request link, like https://github.com/owner/repo/pull/12."
              : "Paste a tag or release link, like https://github.com/owner/repo/releases/tag/week0.",
        };
      }
      if (ref.kind === "pr") {
        const response = await github(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`);
        const trouble = githubTrouble(response);
        if (trouble) return trouble;
        const pr = (await response!.json()) as { title?: string; comments?: number; review_comments?: number; state?: string };
        const discussion = (pr.comments ?? 0) + (pr.review_comments ?? 0);
        const evidence = [`Pull request #${ref.number}: “${pr.title ?? ""}” (${pr.state ?? "unknown"})`, `${discussion} comment${discussion === 1 ? "" : "s"} and review comments`];
        const need = check.kind === "github-pr" ? check.minComments ?? 0 : 0;
        if (discussion < need) {
          return { passed: false, message: "Not yet: the pull request has no review comments. Ask a lead to review it, answer their comment, then check again.", evidence };
        }
        if (check.kind === "github-pr" && check.changes) return checkPullRequestChanges(ref, check.changes, github, evidence);
        return { passed: true, message: `Checked: pull request #${ref.number} is on GitHub${need ? " with review discussion" : ""}.`, evidence };
      }
      const response = await github(`/repos/${ref.owner}/${ref.repo}/git/ref/tags/${encodeURIComponent(ref.tag)}`);
      const trouble = githubTrouble(response);
      if (trouble) return trouble;
      return { passed: true, message: `Checked: the tag ${ref.tag} is on GitHub.`, evidence: [`${ref.owner}/${ref.repo} tag ${ref.tag}`] };
    }
    case "onshape-connected": {
      const access = await acquireOnshape(client, who.orgId, who.userId);
      return access.ok
        ? { passed: true, message: "Checked: your Onshape account is connected." }
        : { passed: false, message: onshapeAccessMessage(access.message) };
    }
    case "onshape-features":
    case "onshape-mass": {
      const url = String(input.url ?? "").trim();
      if (!url) return { passed: false, message: "Paste the address of your Part Studio from the browser." };
      const access = await acquireOnshape(client, who.orgId, who.userId);
      if (!access.ok) return { passed: false, message: onshapeAccessMessage(access.message) };
      let bound;
      try {
        bound = await resolveOnshapeBind(url, access.http);
      } catch (error) {
        return {
          passed: false,
          message: error instanceof Error && error.message ? error.message : "That is not an Onshape Part Studio link. Copy it from the address bar while the Part Studio tab is open.",
        };
      }
      const ref = { documentId: bound.documentId, workspaceId: bound.workspaceId, elementId: bound.elementId };
      if (check.kind === "onshape-mass") {
        const read = await readOnshapeMassProperties(access.http, ref);
        if (!read.ok) return { passed: false, message: read.message };
        const pounds = read.value.massKg * 2.20462;
        return read.value.massKg > 0
          ? {
              passed: true,
              message: `Checked: Onshape reports ${pounds.toFixed(2)} lb (${read.value.massKg.toFixed(3)} kg).`,
              evidence: [`Mass read from ${bound.elementName ?? "the Part Studio"}`],
            }
          : { passed: false, message: "Onshape reports no mass. Assign a material to the part, then check again." };
      }
      let features;
      try {
        features = await listOnshapeFeatures(access.http, ref);
      } catch {
        return { passed: false, message: "Onshape did not return this Part Studio's features. Make sure the link is to a Part Studio you can open." };
      }
      if (check.expect.length === 0) {
        return {
          passed: true,
          message: `Checked: Vantage can read “${bound.elementName ?? "your Part Studio"}”${bound.documentName ? ` in ${bound.documentName}` : ""}.`,
        };
      }
      return checkFeatures(features, check.expect, check.anyOf === true);
    }
    default: {
      const exhaustive: never = check;
      return exhaustive;
    }
  }
}
