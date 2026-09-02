/**
 * Regenerates packages/billing/src/tool-names.ts from the live tool registry.
 *
 *   npx tsx scripts/generate-known-tools.ts
 *
 * Billing cannot import @vantage/agent (agent depends on billing), so the governance
 * allowlist is a generated copy; packages/agent/test/tool-names.test.ts fails whenever
 * this file is stale.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { toolNames } from "../packages/agent/src/tools";

const target = resolve(process.cwd(), "packages/billing/src/tool-names.ts");
const names = toolNames();
const body = [
  "/**",
  " * GENERATED from packages/agent/src/tools.ts — do not edit by hand.",
  " *",
  " * Regenerate with `npx tsx scripts/generate-known-tools.ts`. The governance UI's tool",
  " * allowlist (/team/ai-policy) and isToolAllowed read this list; billing cannot import",
  " * @vantage/agent (agent depends on billing), so the registry's names are copied here and",
  " * packages/agent/test/tool-names.test.ts asserts the two lists are identical.",
  " */",
  "export const KNOWN_TOOLS = [",
  ...names.map((name) => `  "${name}",`),
  "] as const;",
  "",
  "export type KnownToolName = (typeof KNOWN_TOOLS)[number];",
  "",
].join("\n");
writeFileSync(target, body, "utf8");
console.log(`wrote ${names.length} tool names to ${target}`);
