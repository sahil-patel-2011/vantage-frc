import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RELAYS_RELATED_INCLUDE,
  relaysRelatedLinks,
  relaysShellCopy,
} from "../relays/relays-related";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

/**
 * Student relays / freebuff chrome: paste the Pi token only. Freebuff ToS
 * (2026-09-02) forbids wrappers, extensions, and bookmarklets. Setup badge
 * is Needs setup, never Setup required.
 */
const FILES = [
  "app/team/relays/relays-client.tsx",
  "app/team/relays/relays-chrome.tsx",
  "lib/relays/relays-related.ts",
] as const;

describe("relays paste-token student chrome", () => {
  it("does not print leftover engineering copy or wrap Freebuff", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/chrome\.google\.com/);
      expect(src, rel).not.toMatch(/freebuff\.com/);
      expect(src, rel).not.toMatch(/Install the extension/);
      expect(src, rel).not.toMatch(/Add this bookmarklet/);
      expect(src, rel).not.toMatch(/reuse the live official Freebuff session/);
    }
  });

  it("student chrome is paste-token and setup badges stay Needs setup", () => {
    const client = readFileSync(join(WEB, "app/team/relays/relays-client.tsx"), "utf8");
    const chrome = readFileSync(join(WEB, "app/team/relays/relays-chrome.tsx"), "utf8");
    const related = readFileSync(join(WEB, "lib/relays/relays-related.ts"), "utf8");
    expect(client).toMatch(/Paste this token/);
    expect(chrome).toMatch(/Paste the token from the Pi/);
    expect(chrome).toMatch(/Save this token/);
    expect(chrome).toMatch(/aria-label="Paste the relay token"/);
    expect(related).toMatch(/Needs setup/);
    expect(relaysShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(relaysShellCopy("setup").description);
    expectPlainCopy(relaysShellCopy("empty").description);
    expect([...RELAYS_RELATED_INCLUDE]).toEqual(["connectors", "video", "storage"]);
    expect(
      relaysRelatedLinks("org-1", { include: [...RELAYS_RELATED_INCLUDE] }).map((link) => link.label),
    ).toEqual(["Connectors", "Video", "Storage"]);
  });

  it("student free-relay connector copy is paste-token, not a wrapper", () => {
    const catalog = readFileSync(join(WEB, "lib/connectors/catalog.ts"), "utf8");
    expect(catalog).toMatch(/Paste the token the team's Raspberry Pi prints/);
    expect(catalog).toMatch(/Never a Freebuff website cookie/);
    expect(catalog).toMatch(/browser extension, or a bookmarklet/);
  });
});
