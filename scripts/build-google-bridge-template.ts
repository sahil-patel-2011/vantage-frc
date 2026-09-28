import { writeFileSync } from "node:fs";
import { appsScriptSource } from "../apps/web/lib/google-sheets/apps-script-source";

const outputIndex = process.argv.indexOf("--output");
const output = outputIndex < 0 ? undefined : process.argv[outputIndex + 1];
if (!output) throw new Error("Supply --output for the operator's deployment template.");
// Contains a placeholder only. The operator supplies the existing secret separately.
const source = appsScriptSource("a".repeat(64));
if (!source.includes('request.action === "team.layout"')) throw new Error("The template is missing required layout verification.");
writeFileSync(output, source, { mode: 0o600 });
console.log("Google bridge template generated with required layout verification.");
