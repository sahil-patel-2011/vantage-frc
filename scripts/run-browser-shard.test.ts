import { describe, expect, it } from "vitest";
import { fileGroups, reportCases, verifyCoverage } from "./run-browser-shard.mjs";

describe("bounded browser-run coverage", () => {
  const report = { config: { rootDir: "/workspace/tests" }, suites: [{ suites: [{ specs: [
    { file: "a.spec.ts", line: 3, column: 1, title: "same title", tests: [{ projectName: "chromium" }, { projectName: "webkit" }] },
    { file: "b.spec.ts", line: 9, column: 1, title: "same title", tests: [{ projectName: "chromium" }] },
  ] }] }] };

  it("includes nested suites and distinct browser projects", () => {
    const cases = reportCases(report);
    expect(cases).toHaveLength(3);
    expect(new Set(cases.map(entry => entry.key)).size).toBe(3);
    expect(fileGroups(cases, 1)).toHaveLength(2);
    expect(() => verifyCoverage(cases, [...cases].reverse())).not.toThrow();
  });

  it("rejects missing, extra and duplicated cases instead of reporting completion", () => {
    const cases = reportCases(report);
    expect(() => verifyCoverage(cases, cases.slice(1))).toThrow(/1 missing/);
    expect(() => verifyCoverage(cases.slice(1), cases)).toThrow(/1 unexpected/);
    expect(() => verifyCoverage(cases, [...cases, cases[0]!])).toThrow(/Duplicate/);
    expect(() => verifyCoverage([...cases, cases[0]!], cases)).toThrow(/Duplicate/);
    expect(() => fileGroups(cases, 0)).toThrow(/Positive/);
  });

  it("distinguishes generated cases with identical names and source lines in different suites", () => {
    const spec = { file: "shell.spec.ts", line: 19, column: 9, title: "same generated case", tests: [{ projectName: "chromium" }] };
    const cases = reportCases({ config: { rootDir: "/workspace/tests" }, suites: [{ title: "shell.spec.ts", suites: [
      { title: "phone", specs: [spec] }, { title: "tablet", specs: [spec] }, { title: "desktop", specs: [spec] },
    ] }] });
    expect(cases).toHaveLength(3);
    expect(() => verifyCoverage(cases, cases)).not.toThrow();
  });
});
