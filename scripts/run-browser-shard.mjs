#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

export function reportCases(report) {
  const cases = [];
  const visit = (suite, parents = []) => {
    const titlePath = [...parents, suite.title ?? ""];
    for (const spec of suite.specs ?? []) {
      const file = resolve(report.config.rootDir, spec.file).replaceAll("\\", "/");
      for (const test of spec.tests ?? []) {
        cases.push({ file, key: JSON.stringify([file, spec.line, spec.column, ...titlePath, spec.title, test.projectId ?? test.projectName, test.repeatEachIndex ?? 0]) });
      }
    }
    for (const child of suite.suites ?? []) visit(child, titlePath);
  };
  for (const suite of report.suites ?? []) visit(suite);
  return cases;
}

export function verifyCoverage(planned, actual) {
  const expected = new Set(planned.map(entry => entry.key));
  const found = new Set(actual.map(entry => entry.key));
  if (expected.size !== planned.length || found.size !== actual.length) throw new Error("Duplicate browser test in planned or actual coverage");
  const missing = [...expected].filter(key => !found.has(key));
  const extra = [...found].filter(key => !expected.has(key));
  if (missing.length || extra.length) throw new Error(`Browser coverage mismatch: ${missing.length} missing, ${extra.length} unexpected`);
}

export function fileGroups(cases, maxFiles) {
  if (!Number.isInteger(maxFiles) || maxFiles < 1) throw new Error("Positive file-group size required");
  const files = [...new Set(cases.map(entry => entry.file))].sort();
  const groups = [];
  for (let index = 0; index < files.length; index += maxFiles) groups.push(files.slice(index, index + maxFiles));
  return groups;
}

function filePattern(file) { return `^${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`; }

async function runCli(args, env = process.env, capture = false) {
  const child = spawn(process.execPath, [require.resolve("@playwright/test/cli"), ...args], {
    env, stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
  });
  let output = "";
  if (capture) child.stdout.on("data", chunk => { output += chunk.toString(); });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const code = await new Promise((accept, reject) => {
      child.once("error", reject);
      child.once("exit", exitCode => accept(exitCode ?? 1));
    });
    return { code, output };
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

async function listCases(args) {
  const env = { ...process.env };
  delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  delete env.PLAYWRIGHT_JSON_OUTPUT_NAME;
  delete env.PLAYWRIGHT_JSON_OUTPUT_DIR;
  const result = await runCli(["test", ...args, "--list", "--reporter=json"], env, true);
  if (result.code) throw new Error(`Browser test listing failed (${result.code})`);
  const start = result.output.search(/(?:^|\n)\s*\{/);
  if (start < 0) throw new Error("Browser listing returned no JSON report");
  return reportCases(JSON.parse(result.output.slice(start).trim()));
}

export async function main(args = process.argv.slice(2)) {
  let shard = "1/1";
  let maxFiles = 6;
  const filters = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--shard") shard = args[++index];
    else if (args[index] === "--max-files") maxFiles = Number(args[++index]);
    else if (args[index].startsWith("--")) throw new Error(`Unsupported option ${args[index]}`);
    else filters.push(args[index]);
  }
  const match = /^(\d+)\/(\d+)$/.exec(shard ?? "");
  if (!match || Number(match[1]) < 1 || Number(match[1]) > Number(match[2])) throw new Error("Valid shard index/count required");
  const planned = await listCases([...filters, `--shard=${shard}`]);
  if (!planned.length) throw new Error("No browser tests selected");
  const groups = fileGroups(planned, maxFiles);
  // Verify whole-file grouping before any execution. Future parallel/shard
  // changes must fail here instead of silently dropping or duplicating cases.
  const grouped = [];
  for (const group of groups) grouped.push(...await listCases(group.map(filePattern)));
  verifyCoverage(planned, grouped);

  const stamp = `${match[1]}-${Date.now()}`;
  const blobDir = resolve("test-results", `browser-blobs-${stamp}`);
  const resultFile = resolve("test-results", `browser-merged-${stamp}.json`);
  await mkdir(blobDir, { recursive: true });
  console.log(`Browser shard ${shard}: ${planned.length} cases in ${groups.length} groups; all planned cases verified exactly once.`);
  let failed = false;
  for (let index = 0; index < groups.length; index++) {
    console.log(`Browser group ${index + 1}/${groups.length}: ${groups[index].length} files; fresh Playwright-managed development server.`);
    const result = await runCli(["test", ...groups[index].map(filePattern), "--reporter=line,blob", "--workers=1", `--output=test-results/browser-chunk-${stamp}-${index + 1}`], {
      ...process.env,
      VANTAGE_BROWSER_DIST_DIR: `.next/browser-tests/${stamp}-${index + 1}`,
      PLAYWRIGHT_BLOB_OUTPUT_FILE: resolve(blobDir, `chunk-${index + 1}.zip`),
    });
    failed ||= result.code !== 0;
  }
  const merged = await runCli(["merge-reports", "--reporter=line,html,json", blobDir], {
    ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: resultFile, PLAYWRIGHT_HTML_OPEN: "never",
  });
  if (merged.code) throw new Error(`Browser report merge failed (${merged.code})`);
  const report = JSON.parse(await readFile(resultFile, "utf8"));
  const actual = reportCases(report);
  verifyCoverage(planned, actual);
  await writeFile(resolve("test-results", `browser-coverage-${stamp}.json`), JSON.stringify({ shard, maxFiles, planned: planned.length, reported: actual.length, groups: groups.length, exactCoverage: true, result: failed ? "failed" : "passed", stats: report.stats }, null, 2));
  console.log(`Merged browser coverage verified: ${actual.length}/${planned.length}; failures, retries and explicit skips remain in the report.`);
  return failed ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
