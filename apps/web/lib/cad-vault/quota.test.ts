import { describe, expect, it } from "vitest";
import {
  MAX_CAD_FILE_BYTES,
  MAX_ORG_CAD_BYTES,
  MAX_VERSIONS_PER_DOCUMENT,
  evaluateCadQuota,
} from "./quota";

const emptyUsage = { orgBytes: 0, documentVersionCount: 0 };

describe("evaluateCadQuota", () => {
  it("accepts a normal upload", () => {
    expect(evaluateCadQuota(8 * 1024 * 1024, emptyUsage)).toEqual({ ok: true });
  });

  it("rejects empty files", () => {
    expect(evaluateCadQuota(0, emptyUsage).ok).toBe(false);
  });

  it("rejects a file over the 50 MB per-file cap with a clear message", () => {
    const verdict = evaluateCadQuota(MAX_CAD_FILE_BYTES + 1, emptyUsage);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("per-file limit is 50 MB");
  });

  it("accepts exactly the per-file cap", () => {
    expect(evaluateCadQuota(MAX_CAD_FILE_BYTES, emptyUsage)).toEqual({ ok: true });
  });

  it("rejects the 51st version of one document", () => {
    const verdict = evaluateCadQuota(1024, { orgBytes: 0, documentVersionCount: MAX_VERSIONS_PER_DOCUMENT });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("50 versions");
  });

  it("rejects when the upload would push the org over 2 GB", () => {
    const verdict = evaluateCadQuota(2 * 1024 * 1024, {
      orgBytes: MAX_ORG_CAD_BYTES - 1024 * 1024,
      documentVersionCount: 3,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("exceed the limit");
  });

  it("accepts an upload that lands exactly on the org cap", () => {
    expect(
      evaluateCadQuota(1024 * 1024, { orgBytes: MAX_ORG_CAD_BYTES - 1024 * 1024, documentVersionCount: 3 }),
    ).toEqual({ ok: true });
  });
});
