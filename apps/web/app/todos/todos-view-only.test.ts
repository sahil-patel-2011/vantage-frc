import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A parent or guest (View only) saw "Mark done" on every task, and each tap was refused
 * (QA A3-18). The task board passes the page's View only state down to each card, which then
 * shows no Mark done, Reopen or edit controls.
 */
describe("task board for a parent or guest", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "todos-client.tsx"), "utf8");

  it("passes View only from the page to the board and from the board to each card", () => {
    expect(source).toMatch(/<Board[^>]*viewOnly=\{viewOnly\}/);
    expect(source).toMatch(/<TodoCard[\s\S]*?viewOnly=\{viewOnly\}/);
  });

  it("drops the card's write controls, Mark done included, for View only", () => {
    const card = source.slice(source.indexOf("function TodoCard("));
    const gate = card.indexOf("{viewOnly ? null : (");
    expect(gate).toBeGreaterThan(-1);
    // Every write the card offers (Mark done sets status "done") sits behind the gate.
    expect(card.slice(0, gate)).not.toContain('status: "done"');
    expect(card.slice(gate)).toContain('status: "done"');
    expect(card.indexOf('className="todos-card-controls"')).toBeGreaterThan(gate);
  });
});
