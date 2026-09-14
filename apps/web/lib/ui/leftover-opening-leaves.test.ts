import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-more. Hub labels stay Playbook, Learning, Work, and Get unstuck.
 * leftover-product-chrome Playbook, leftover-learning-shot Learning,
 * leftover-schema-oauth Learning,
 * leftover-opening-more Opening Match sim, leftover-fmea Failure log,
 * leftover-pick-before Choose your team stay. Hub My Day / Schema A/B
 * stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/team/knowledge/knowledge-client.tsx",
  "app/learning/learning-client.tsx",
  "app/todos/todos-client.tsx",
  "app/troubleshoot/troubleshoot-client.tsx",
] as const;

describe("leftover student opening-leaves chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading…"/);
      expect(src, rel).not.toMatch(/title="Loading /);
    }
    const playbook = readFileSync(
      join(WEB, "app/team/knowledge/knowledge-client.tsx"),
      "utf8",
    );
    expect(playbook).toMatch(/Opening Playbook/);
    expect(playbook).toMatch(/feature="Playbook"/);
    expect(playbook).toMatch(/if \(!view\)/);
    expect(playbook).toMatch(/badge="Needs setup"/);
    expect(playbook).toMatch(/KNOWLEDGE_RELATED_INCLUDE/);
    const learning = readFileSync(join(WEB, "app/learning/learning-client.tsx"), "utf8");
    expect(learning).toMatch(/Opening Learning/);
    expect(learning).toMatch(/feature="Learning"/);
    expect(learning).toMatch(/Choose your team/);
    expect(learning).not.toMatch(/Setup required/);
    expect(learning).not.toMatch(/TBA\/Statbotics/);
    const work = readFileSync(join(WEB, "app/todos/todos-client.tsx"), "utf8");
    expect(work).toMatch(/Opening Work/);
    const unstuck = readFileSync(
      join(WEB, "app/troubleshoot/troubleshoot-client.tsx"),
      "utf8",
    );
    expect(unstuck).toMatch(/Opening Get unstuck/);
    expect(unstuck).toMatch(/title="Get unstuck"/);
    expect(unstuck).toMatch(/feature="Get unstuck"/);
  });
});
