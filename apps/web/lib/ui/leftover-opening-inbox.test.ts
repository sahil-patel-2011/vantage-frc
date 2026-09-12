import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-rest. Hub labels stay Chat and Files. leftover-invites no
 * Team admin, leftover-product-chrome Files, leftover-student-copy no
 * object storage, leftover-opening-rest Opening Task board,
 * leftover-opening-leaves Opening Playbook, leftover-fmea Failure log,
 * leftover-pick-before Choose your team stay. Hub My Day / Schema A/B
 * stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/messages/messages-ready-view.tsx",
  "app/files/files-panels.tsx",
] as const;

describe("leftover student opening-inbox chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading…"/);
      expect(src, rel).not.toMatch(/title="Loading /);
      expect(src, rel).not.toMatch(/Team admin/);
    }
    const chat = readFileSync(join(WEB, "app/messages/messages-ready-view.tsx"), "utf8");
    expect(chat).toMatch(/Opening Chat/);
    expect(chat).toMatch(/title="Chat"/);
    expect(chat).toMatch(/feature="Chat"/);
    const files = readFileSync(join(WEB, "app/files/files-panels.tsx"), "utf8");
    expect(files).toMatch(/Opening Files/);
    expect(files).toMatch(/Choose your team/);
    expect(files).not.toMatch(/\bobject storage\b/i);
    expect(files).not.toMatch(/\bsetup required\b/i);
  });
});
