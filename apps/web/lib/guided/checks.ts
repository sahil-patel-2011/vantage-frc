import type { CheckResult, FeatureExpectation, StepCheck } from "./types";

/** The part of an Onshape feature list a check reads. */
export type FeatureRow = { featureType: string; name?: string; suppressed?: boolean };

const plural = (n: number, one: string) => (n === 1 ? one : `${n} × ${one}`);

/**
 * Counts live (not suppressed) features by type and says which expectations are met. With
 * `anyOf`, one met expectation is enough.
 */
export function checkFeatures(features: readonly FeatureRow[], expect: readonly FeatureExpectation[], anyOf = false): CheckResult {
  const live = features.filter((feature) => !feature.suppressed);
  const count = (type: string) => live.filter((feature) => feature.featureType === type).length;
  const results = expect.map((wanted) => ({ wanted, have: count(wanted.featureType), need: wanted.min ?? 1 }));
  const met = results.filter((row) => row.have >= row.need);
  const passed = anyOf ? met.length > 0 : met.length === results.length;
  const evidence = [
    `${live.length} feature${live.length === 1 ? "" : "s"} in the Part Studio${features.length !== live.length ? ` (${features.length - live.length} suppressed, not counted)` : ""}`,
    ...results.map((row) => `${row.wanted.label}: found ${row.have}, need ${row.need}`),
  ];
  if (passed) {
    const found = met.map((row) => plural(row.have, row.wanted.label)).join(", ");
    return { passed, message: `Checked: found ${found}.`, evidence };
  }
  const missing = (anyOf ? results : results.filter((row) => row.have < row.need)).map((row) =>
    row.need === 1 ? row.wanted.label : `${row.need} × ${row.wanted.label} (found ${row.have})`,
  );
  return {
    passed,
    message: anyOf
      ? `Not yet: add ${missing.join(" or ")} to this Part Studio, then check again.`
      : `Not yet: this Part Studio still needs ${missing.join(" and ")}.`,
    evidence,
  };
}

/** Every pattern must appear in what was pasted; the first missing one is named. */
export function checkPaste(check: Extract<StepCheck, { kind: "paste" }>, text: string): CheckResult {
  const pasted = text.trim();
  if (!pasted) return { passed: false, message: "Paste the text first." };
  if (pasted.length > 60_000) return { passed: false, message: "That is too long to check. Paste only the part asked for." };
  const missing = check.must.filter((rule) => !new RegExp(rule.pattern, rule.flags ?? "i").test(pasted));
  if (missing.length === 0) {
    return {
      passed: true,
      message: "Checked: everything this step looks for is there.",
      evidence: check.must.map((rule) => `Found: ${rule.missing.replace(/^Missing:?\s*/i, "")}`),
    };
  }
  return {
    passed: false,
    message: `Not yet: ${missing[0]!.missing}`,
    evidence: missing.map((rule) => rule.missing),
  };
}

/** Numbers typed in, compared the way the step says. */
export function checkNumbers(check: Extract<StepCheck, { kind: "numbers" }>, values: Record<string, unknown>): CheckResult {
  const read = (id: string) => {
    const raw = values[id];
    const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : Number.NaN;
    return Number.isFinite(value) ? value : null;
  };
  const missing = check.fields.filter((field) => read(field.id) == null);
  if (missing.length) return { passed: false, message: `Type a number for ${missing.map((field) => field.label).join(" and ")}.` };
  const a = read(check.within.a)!;
  const b = read(check.within.b)!;
  const gap = Math.abs(a - b);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const evidence = [`Difference ${round(gap)} ${check.within.unit}; allowed ${check.within.tolerance} ${check.within.unit}`];
  return gap <= check.within.tolerance
    ? { passed: true, message: `Checked: ${round(gap)} ${check.within.unit} apart, inside ${check.within.tolerance} ${check.within.unit}.`, evidence }
    : {
        passed: false,
        message: `Not yet: ${round(gap)} ${check.within.unit} apart, more than ${check.within.tolerance} ${check.within.unit}. Fix it and measure again.`,
        evidence,
      };
}

export type GitHubRef =
  | { kind: "pr"; owner: string; repo: string; number: number }
  | { kind: "tag"; owner: string; repo: string; tag: string };

/** github.com/owner/repo/pull/12, …/releases/tag/v1.2, …/tree/v1.2 (tags only). */
export function parseGitHubUrl(input: string): GitHubRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const [owner, repo, kind, ...rest] = parts;
  const name = /^[A-Za-z0-9_.-]{1,100}$/;
  if (!owner || !repo || !name.test(owner) || !name.test(repo)) return null;
  if (kind === "pull" && rest[0] && /^\d{1,7}$/.test(rest[0])) return { kind: "pr", owner, repo, number: Number(rest[0]) };
  if (kind === "releases" && rest[0] === "tag" && rest[1]) return { kind: "tag", owner, repo, tag: decodeURIComponent(rest.slice(1).join("/")) };
  if (kind === "tree" && rest[0]) return { kind: "tag", owner, repo, tag: decodeURIComponent(rest.join("/")) };
  return null;
}
