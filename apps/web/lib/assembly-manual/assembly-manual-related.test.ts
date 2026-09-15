import { describe, expect, it } from "vitest";
import { expectPlainCopy } from "../ui/copy-assertions";
import {
  ASSEMBLY_MANUAL_RELATED_INCLUDE,
  CONNECT_ONSHAPE,
  FUSION_CANNOT_FEED_BOOK,
  assemblyManualFromVaultHref,
  assemblyManualRelatedLinks,
  assemblyManualShellCopy,
  assemblyRunShowsLiveProgress,
  assemblyWorkerWaitingCopy,
  classifyAssemblyManualShell,
} from "./assembly-manual-related";

describe("assembly-manual start path copy", () => {
  it("no-org setup is Choose your team with a Needs setup badge", () => {
    expect(classifyAssemblyManualShell({ authBlocked: true })).toBe("setup");
    expect(classifyAssemblyManualShell({ status: "setup_required" })).toBe("setup");
    expect(classifyAssemblyManualShell({ status: "ok", orgId: null })).toBe("ready");
    expect(classifyAssemblyManualShell({ status: "ok", orgId: "org-1" })).toBe("ready");
    expect(assemblyManualShellCopy("setup").badge).toBe("Needs setup");
    expect(assemblyManualShellCopy("setup").title).toBe("Choose your team");
    expectPlainCopy(assemblyManualShellCopy("setup").title);
    expectPlainCopy(assemblyManualShellCopy("setup").description);
    expectPlainCopy(assemblyManualShellCopy("ready").description);
    expect(assemblyManualShellCopy("ready").description).toMatch(/Paste an Onshape assembly link/);
    expect(assemblyManualShellCopy("ready").description).toMatch(/Connect Onshape/);
  });

  it("Fusion cannot feed this book, and Connect Onshape is the OAuth CTA", () => {
    expect(FUSION_CANNOT_FEED_BOOK).toMatch(/Fusion cannot feed this book/);
    expect(FUSION_CANNOT_FEED_BOOK).toMatch(/Paste an Onshape assembly link/);
    expect(CONNECT_ONSHAPE).toBe("Connect Onshape");
    expectPlainCopy(FUSION_CANNOT_FEED_BOOK);
  });

  it("queued with no worker check-in is not live progress", () => {
    expect(
      assemblyRunShowsLiveProgress({ status: "queued", workerLastCheckIn: null }),
    ).toBe(false);
    expect(
      assemblyRunShowsLiveProgress({ status: "queued", workerLastCheckIn: "2026-09-15T00:00:00Z" }),
    ).toBe(true);
    expect(
      assemblyRunShowsLiveProgress({ status: "running", workerLastCheckIn: null }),
    ).toBe(true);
    expect(
      assemblyWorkerWaitingCopy(null, "No worker has picked up a run for your team yet."),
    ).toMatch(/No worker/);
    expect(assemblyWorkerWaitingCopy("2026-09-15T00:00:00Z", "seen")).toBeNull();
  });

  it("vault picker deep-link keeps the document id so the book starts without re-pasting", () => {
    expect(assemblyManualFromVaultHref("org-1", "doc-9")).toBe(
      "/assembly-manual?documentId=doc-9&orgId=org-1",
    );
    const links = assemblyManualRelatedLinks("org-1", { include: [...ASSEMBLY_MANUAL_RELATED_INCLUDE] });
    expect(links.map((link) => link.id)).toEqual(["cad-vault", "cad", "cad-learn"]);
  });
});
