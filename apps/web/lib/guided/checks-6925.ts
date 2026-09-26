import { checkPaste } from "./checks";
import type { CheckResult, StepCheck } from "./types";

/**
 * Extra ways a guided step can check work, written for Team 6925's programming weeks but
 * usable by any track.
 *
 * They ride on the existing "paste" and "github-pr" checks (the step page already knows how to
 * ask for pasted text and a link), so a step opts in with `verify` on a paste check or `changes`
 * on a pull-request check:
 *
 * - `reads: "java"` removes comments before looking, so a commented-out line never counts, and can
 *   refuse APIs the team does not use (Phoenix 5 calls on a Phoenix 6 robot) or require an order
 *   (named commands registered before the auto chooser is built).
 * - `reads: "output"` reads build, deploy or terminal output and can refuse a line that means it
 *   failed ("BUILD FAILED").
 * - `reads: "vendordep"` parses a vendordeps JSON file and checks which library and season it is.
 * - `githubFile` also accepts a github.com link to the file; Vantage reads the file from GitHub
 *   (public repositories only) instead of trusting a paste.
 * - `changes` on a pull-request check asks GitHub which files the pull request changed.
 */

export type ForbiddenRule = { pattern: string; flags?: string; found: string };
export type OrderRule = { first: string; then: string; flags?: string; wrong: string };

export type PasteVerifier = {
  reads: "java" | "output" | "vendordep";
  mustNot?: ForbiddenRule[];
  order?: OrderRule[];
  vendordep?: { name: string; label: string; minFrcYear: number };
  githubFile?: boolean;
};

export type PrChangeRule = { pattern: string; label: string };

type PasteCheck = Extract<StepCheck, { kind: "paste" }>;
type GitHubGet = (path: string) => Promise<Response | null>;

const MAX_FILE_BYTES = 300_000;
const GITHUB_TIMEOUT_MS = 8_000;

/* ---------------------------------------------------------------- patterns */

/**
 * GradleRIO's deploy prints "Using <user>@<address>:<port> for target roborio" once it finds the
 * robot (wpilibsuite/deploy-utils TargetDiscoveryWorker). These are the addresses a 6925 roboRIO
 * answers on: mDNS name, the radio's static 10.TE.AM.2 address, and USB.
 */
export const DEPLOY_TO_6925 =
  "Using \\S+@(roborio-6925-frc(\\.[a-z-]+)*|10\\.69\\.25\\.2|172\\.22\\.11\\.2):\\d+ for target roborio";

/** Printed by WPILib when robot code has started (older years printed "Robot program starting"). */
export const ROBOT_PROGRAM_STARTED = "Robot program startup complete|Robot program starting";

/**
 * A non-zero number (or a named constant) inside a Phoenix 6 `withKS(...)`-style call; the swerve
 * generator ships `withKS(0)`, which is the value a SysId run replaces.
 */
export function nonZeroCall(method: string): string {
  return `${method}\\(\\s*(?:(?!-?0*\\.?0*\\s*\\))-?\\d*\\.?\\d+|[A-Za-z_][\\w.]*)\\s*\\)`;
}

/* ------------------------------------------------------------- Java source */

/**
 * Removes // and block comments from Java source, keeping string literals, character literals and
 * text blocks intact (a "//" inside a string is not a comment). Line breaks are kept so the
 * remaining code keeps its shape.
 */
export function stripJavaComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2;
      out += " ";
      continue;
    }
    if (c === '"' && source.startsWith('"""', i)) {
      const end = source.indexOf('"""', i + 3);
      const stop = end === -1 ? n : end + 3;
      out += source.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      out += source.slice(i, Math.min(j + 1, n));
      i = j + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/* ------------------------------------------------------------- vendordeps */

type Vendordep = { name?: unknown; version?: unknown; frcYear?: unknown; javaDependencies?: unknown };

function checkVendordep(rule: NonNullable<PasteVerifier["vendordep"]>, text: string): CheckResult {
  let parsed: Vendordep;
  try {
    parsed = JSON.parse(text) as Vendordep;
  } catch {
    return {
      passed: false,
      message: `Not yet: that is not a vendordeps file. Open the vendordeps folder, open the ${rule.label} file and paste all of it.`,
    };
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.name !== "string") {
    return { passed: false, message: `Not yet: that file has no library name. Paste the whole ${rule.label} file from the vendordeps folder.` };
  }
  const evidence = [`Library: ${parsed.name}`, `Version: ${String(parsed.version ?? "none")}`, `Season: ${String(parsed.frcYear ?? "none")}`];
  if (!new RegExp(rule.name, "i").test(parsed.name)) {
    return { passed: false, message: `Not yet: that is the ${parsed.name} file. This step wants the ${rule.label} file.`, evidence };
  }
  const year = Number.parseInt(String(parsed.frcYear ?? ""), 10);
  if (!Number.isFinite(year) || year < rule.minFrcYear) {
    return {
      passed: false,
      message: `Not yet: ${rule.label} is for the ${Number.isFinite(year) ? year : "unknown"} season. Install the ${rule.minFrcYear} version (WPILib: Manage Vendor Libraries) so it matches WPILib.`,
      evidence,
    };
  }
  if (typeof parsed.version !== "string" || !parsed.version.trim()) {
    return { passed: false, message: `Not yet: that ${rule.label} file has no version. Reinstall it from the vendor's online file.`, evidence };
  }
  return { passed: true, message: `Checked: ${rule.label} ${parsed.version} for the ${year} season.`, evidence };
}

/* ------------------------------------------------------------------ paste */

function firstIndex(text: string, pattern: string, flags: string): number {
  const match = new RegExp(pattern, flags.replace("g", "")).exec(text);
  return match ? match.index : -1;
}

function lastIndex(text: string, pattern: string, flags: string): number {
  const re = new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`);
  let last = -1;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    last = match.index;
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return last;
}

/** Runs a paste check that has a `verify` block on text already in hand. */
export function evaluatePaste(check: PasteCheck, raw: string): CheckResult {
  const verify = check.verify;
  if (!verify) return checkPaste(check, raw);
  const text = raw.trim();
  if (!text) return { passed: false, message: "Paste the text first." };
  if (text.length > 60_000 && verify.reads !== "vendordep") {
    return { passed: false, message: "That is too long to check. Paste only the part asked for." };
  }

  if (verify.reads === "vendordep" && verify.vendordep) {
    const result = checkVendordep(verify.vendordep, text);
    if (!result.passed || check.must.length === 0) return result;
    const rest = checkPaste(check, text);
    return rest.passed ? { ...result, evidence: [...(result.evidence ?? []), ...(rest.evidence ?? [])] } : rest;
  }

  const body = verify.reads === "java" ? stripJavaComments(text) : text;
  if (verify.reads === "java" && !body.trim()) {
    return { passed: false, message: "Not yet: everything pasted is a comment. Paste the code itself." };
  }

  const found = checkPaste(check, body);
  if (!found.passed) {
    if (verify.reads === "java" && checkPaste(check, text).passed) {
      return {
        passed: false,
        message: `Not yet: ${found.message.replace(/^Not yet:\s*/, "")} (Only code counts. The part you pasted is inside a comment.)`,
        evidence: found.evidence,
      };
    }
    return found;
  }

  for (const rule of verify.mustNot ?? []) {
    if (new RegExp(rule.pattern, rule.flags ?? "i").test(body)) {
      return { passed: false, message: `Not yet: ${rule.found}`, evidence: [rule.found] };
    }
  }

  for (const rule of verify.order ?? []) {
    const flags = rule.flags ?? "i";
    const last = lastIndex(body, rule.first, flags);
    const then = firstIndex(body, rule.then, flags);
    if (last !== -1 && then !== -1 && last > then) {
      return { passed: false, message: `Not yet: ${rule.wrong}`, evidence: [rule.wrong] };
    }
  }

  const evidence = [...(found.evidence ?? [])];
  if (verify.reads === "java") evidence.push("Comments were skipped, so commented-out code did not count.");
  if (verify.mustNot?.length) evidence.push(`None of the ${verify.mustNot.length} things this step refuses were there.`);
  if (verify.order?.length) evidence.push("Things that must happen in order were in order.");
  return { passed: true, message: found.message, evidence };
}

/* --------------------------------------------------------- GitHub file link */

export type GitHubFileRef = { owner: string; repo: string; refAndPath: string; raw: string };

/** github.com/owner/repo/blob/<branch or commit>/<path>, turned into its raw file address. */
export function parseGitHubFileUrl(input: string): GitHubFileRef | null {
  const trimmed = input.trim();
  if (/\s/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || (url.hostname !== "github.com" && url.hostname !== "www.github.com")) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const [owner, repo, kind, ...rest] = parts;
  const name = /^[A-Za-z0-9_.-]{1,100}$/;
  if (!owner || !repo || !name.test(owner) || !name.test(repo) || kind !== "blob" || rest.length < 2) return null;
  let decoded: string[];
  try {
    decoded = rest.map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  const unsafe = (segment: string) => segment.includes("\\") || [...segment].some((ch) => ch.charCodeAt(0) < 0x20);
  if (decoded.some((segment) => !segment || segment === "." || segment === ".." || unsafe(segment))) return null;
  const refAndPath = decoded.join("/");
  return {
    owner,
    repo,
    refAndPath,
    raw: `https://raw.githubusercontent.com/${owner}/${repo}/${decoded.map(encodeURIComponent).join("/")}`,
  };
}

async function readGitHubFile(ref: GitHubFileRef, fetchImpl: typeof fetch): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  let response: Response;
  try {
    response = await fetchImpl(ref.raw, {
      headers: { "user-agent": "VantageFRC-guided-check" },
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, message: "GitHub did not answer. Check your connection and try again, or paste the code instead." };
  }
  if (response.status === 404) {
    return {
      ok: false,
      message: "GitHub says that file does not exist, or the repository is private. Paste the code instead.",
    };
  }
  if (!response.ok) return { ok: false, message: `GitHub answered ${response.status}. Try again in a minute, or paste the code instead.` };
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_FILE_BYTES) return { ok: false, message: "That file is too big to check. Paste only the part asked for." };
  const text = await response.text();
  if (text.length > MAX_FILE_BYTES) return { ok: false, message: "That file is too big to check. Paste only the part asked for." };
  return { ok: true, text };
}

/**
 * A paste check with `verify`. When the step allows it and the student pasted only a github.com
 * file link, the file is read from GitHub and checked instead of the paste.
 */
export async function runPasteVerifier(check: PasteCheck, text: string, fetchImpl: typeof fetch = fetch): Promise<CheckResult> {
  const link = check.verify?.githubFile ? parseGitHubFileUrl(text) : null;
  if (!link) {
    if (/^https?:\/\/\S+$/i.test(text.trim())) {
      return {
        passed: false,
        message: check.verify?.githubFile
          ? "That link is not a file on GitHub. Open the file on github.com and copy the address, or paste the code itself."
          : "This step needs the text itself, not a link. Copy the lines it asks for and paste them here.",
      };
    }
    return evaluatePaste(check, text);
  }
  const read = await readGitHubFile(link, fetchImpl);
  if (!read.ok) return { passed: false, message: read.message };
  const result = evaluatePaste(check, read.text);
  const source = `Read from GitHub: ${link.owner}/${link.repo}, ${link.refAndPath}`;
  const message = result.passed
    ? result.message
    : `${result.message} (This was read from the file on GitHub: push your change first, and link the file on your own branch.)`;
  return { ...result, message, evidence: [source, ...(result.evidence ?? [])] };
}

/* ------------------------------------------------ pull request file changes */

/** Which changed files match the rule. */
export function checkChangedFiles(filenames: readonly string[], rule: PrChangeRule): CheckResult {
  const re = new RegExp(rule.pattern, "i");
  const matching = filenames.filter((file) => re.test(file));
  const evidence = [
    `${filenames.length} file${filenames.length === 1 ? "" : "s"} changed`,
    ...matching.slice(0, 5).map((file) => `Changed: ${file}`),
  ];
  return matching.length
    ? { passed: true, message: `Checked: the pull request changes ${rule.label}.`, evidence }
    : { passed: false, message: `Not yet: the pull request does not change ${rule.label}. Push that change to the same branch, then check again.`, evidence };
}

/** Asks GitHub for the files a pull request changed (first 300) and applies the rule. */
export async function checkPullRequestChanges(
  ref: { owner: string; repo: string; number: number },
  rule: PrChangeRule,
  github: GitHubGet,
  before: string[] = [],
): Promise<CheckResult> {
  const response = await github(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files?per_page=100`);
  if (!response) return { passed: false, message: "GitHub did not answer. Check your connection and try again.", evidence: before };
  if (response.status === 403 || response.status === 429) {
    return { passed: false, message: "GitHub is limiting checks right now. Try again in a few minutes.", evidence: before };
  }
  if (!response.ok) return { passed: false, message: `GitHub answered ${response.status}. Try again in a minute.`, evidence: before };
  const rows = (await response.json().catch(() => [])) as Array<{ filename?: unknown }>;
  const filenames = Array.isArray(rows) ? rows.map((row) => String(row.filename ?? "")).filter(Boolean) : [];
  const result = checkChangedFiles(filenames, rule);
  return { ...result, evidence: [...before, ...(result.evidence ?? [])] };
}
