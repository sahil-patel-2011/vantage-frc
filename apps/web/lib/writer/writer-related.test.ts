import { describe, expect, it } from "vitest";
import {
  classifyWriterShell,
  writerRelatedLinks,
  writerShellCopy,
  WRITER_RELATED_INCLUDE,
} from "./writer-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("writerRelated Soft-UI helpers", () => {
  it("returns no links without an org", () => {
    expect(writerRelatedLinks(null)).toEqual([]);
    expect(writerRelatedLinks(undefined)).toEqual([]);
  });

  it("builds Grants / Awards / Knowledge via hubHref / withOrgHref", () => {
    const links = writerRelatedLinks("org-1", { include: WRITER_RELATED_INCLUDE });
    expect(links.map((l) => l.id)).toEqual(["grants", "awards", "knowledge"]);
    expect(links.find((l) => l.id === "grants")?.href).toBe("/business?tab=grants&orgId=org-1");
    expect(links.find((l) => l.id === "awards")?.href).toBe("/team/awards?orgId=org-1");
    expect(links.find((l) => l.id === "knowledge")?.href).toBe("/team?tab=knowledge&orgId=org-1");
  });

  it("includes AI neighbor links when requested", () => {
    const links = writerRelatedLinks("org-1", { include: ["chat", "budgets", "usage"] });
    expect(links.find((l) => l.id === "chat")?.href).toBe("/ai?tab=chat&orgId=org-1");
    expect(links.find((l) => l.id === "budgets")?.href).toBe("/ai?tab=budgets&orgId=org-1");
    expect(links.find((l) => l.id === "usage")?.href).toBe("/ai?tab=usage&orgId=org-1");
  });

  it("classifies shells without inventing DEMO copy", () => {
    expect(classifyWriterShell({ loading: true, fetchFailed: false, setupRequired: false, providerSetup: false, draftCount: 0 })).toBe(
      "loading",
    );
    expect(classifyWriterShell({ loading: false, fetchFailed: true, setupRequired: false, providerSetup: false, draftCount: 0 })).toBe(
      "error",
    );
    expect(classifyWriterShell({ loading: false, fetchFailed: false, setupRequired: true, providerSetup: false, draftCount: 0 })).toBe(
      "setup",
    );
    expect(
      classifyWriterShell({ loading: false, fetchFailed: false, setupRequired: false, providerSetup: true, draftCount: 0 }),
    ).toBe("provider_setup");
    expect(classifyWriterShell({ loading: false, fetchFailed: false, setupRequired: false, providerSetup: false, draftCount: 0 })).toBe(
      "empty",
    );
    expect(classifyWriterShell({ loading: false, fetchFailed: false, setupRequired: false, providerSetup: false, draftCount: 2 })).toBe(
      "ready",
    );

    for (const kind of ["loading", "error", "setup", "provider_setup", "empty", "ready"] as const) {
      const copy = writerShellCopy(kind);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      // Copy may mention “never DEMO …” as an honesty guard — never invent rows/metrics.
      if (kind === "empty" || kind === "setup" || kind === "provider_setup") {
        expectPlainCopy(`${copy.title} ${copy.description}`);
      }
    }
  });
});
