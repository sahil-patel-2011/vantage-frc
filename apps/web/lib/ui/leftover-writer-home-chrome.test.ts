import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyHintFor } from "../../app/dashboard/widgets/widget-empty-copy";
import { aiKeysShellCopy, AI_KEYS_RELATED_INCLUDE } from "../ai-keys/ai-keys-related";
import { writerShellCopy } from "../writer/writer-related";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

/**
 * Writer, Home Ask AI, and API keys still talked like a paid-key product.
 * Students now pair Claude Code; templates stay usable without a key.
 */
const FILES = [
  "lib/writer/writer-related.ts",
  "app/writer/writer-client.tsx",
  "app/dashboard/widgets/widget-empty-copy.ts",
  "lib/ai-keys/ai-keys-related.ts",
  "app/team/ai-keys/ai-keys-chrome.tsx",
] as const;

describe("leftover Writer / Home Ask AI / API keys chrome", () => {
  it("does not print leftover Setup required or provider-key jargon", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/AI provider not configured/);
      expect(src, rel).not.toMatch(/envelope-encrypt/);
      expect(src, rel).not.toMatch(/\bKMS\b/);
      expect(src, rel).not.toMatch(/Configure an AI provider key/);
    }
  });

  it("setup copy is Needs setup and Home Ask AI opens Claude Code", () => {
    expect(writerShellCopy("setup").badge).toBe("Needs setup");
    expect(writerShellCopy("provider_setup").badge).toBe("Needs setup");
    expect(writerShellCopy("provider_setup").title).toBe("Connect Claude Code");
    expectPlainCopy(writerShellCopy("setup").description);
    expectPlainCopy(writerShellCopy("provider_setup").description);

    const ask = emptyHintFor("ask_ai");
    expect(ask.ctaHref).toBe("/team/ai-bridge");
    expect(ask.ctaLabel).toBe("Connect Claude Code");
    expect(ask.body).toMatch(/Claude Code/);

    expect(aiKeysShellCopy("setup").badge).toBe("Needs setup");
    expect(AI_KEYS_RELATED_INCLUDE).toEqual(["chat", "claude-code"]);
    const chrome = readFileSync(join(WEB, "app/team/ai-keys/ai-keys-chrome.tsx"), "utf8");
    expect(chrome).toMatch(/Connect Claude Code/);
    expect(chrome).toMatch(/variant="primary"/);
  });
});
