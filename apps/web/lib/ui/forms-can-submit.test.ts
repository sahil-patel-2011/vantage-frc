import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The shared <Button> defaults to type="button" so a stray click never submits a form. A form
// whose only buttons are <Button>s without type="submit" therefore cannot be sent: "Save goal"
// and "Submit for approval" on Business did nothing at all, with no request and no message.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

describe("every form can be submitted", () => {
  it("has a submit button when it relies on the shared Button", () => {
    const root = join(__dirname, "..", "..");
    const offenders: string[] = [];
    for (const file of [...files(join(root, "app")), ...files(join(root, "components"))]) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<form\b[^>]*onSubmit[\s\S]*?<\/form>/g)) {
        const form = match[0];
        const canSubmit = /type="submit"|<button(?![^>]*type=)[^>]*>/.test(form);
        const untyped = [...form.matchAll(/<Button\b([^>]*)>/g)].some(
          (button) => !button[1]!.includes("type=") && !button[1]!.includes('as="a"'),
        );
        if (untyped && !canSubmit) offenders.push(`${file}:${source.slice(0, match.index).split("\n").length}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
