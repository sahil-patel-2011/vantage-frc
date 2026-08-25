import { describe, expect, it } from "vitest";
import {
  LIBRARY_DB_CAP_BYTES,
  contentDispositionFor,
  isInlinePreviewable,
  normalizeContentType,
  normalizeGrantUserIds,
  normalizeTags,
  parseTagInput,
  sanitizeFileName,
  titleFromFileName,
  validateFileMetadata,
  validateLinkInput,
} from "./validation";

const SHA = "a".repeat(64);

describe("validateFileMetadata", () => {
  const base = {
    fileName: "swerve-module.step",
    byteSize: 1024,
    sha256: SHA,
    contentType: "application/octet-stream",
  };

  it("accepts ANY content type — CAD files have no useful MIME type", () => {
    for (const contentType of [
      "application/octet-stream",
      "model/step",
      "image/vnd.dxf",
      "application/zip",
      "text/x-java",
    ]) {
      const result = validateFileMetadata({ ...base, contentType });
      expect(result.ok, contentType).toBe(true);
    }
  });

  it("rejects empty files", () => {
    const result = validateFileMetadata({ ...base, byteSize: 0 });
    expect(result).toEqual({ ok: false, error: "Empty files cannot be uploaded." });
  });

  it("rejects over-cap files naming the real size and the real cap", () => {
    const result = validateFileMetadata({ ...base, byteSize: LIBRARY_DB_CAP_BYTES + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("100.0 MB");
      expect(result.error).toContain("storage node");
    }
  });

  it("rejects a malformed sha256", () => {
    expect(validateFileMetadata({ ...base, sha256: "nope" }).ok).toBe(false);
  });

  it("derives the title from the file name when none is given", () => {
    const result = validateFileMetadata(base);
    expect(result.ok && result.value.title).toBe("swerve-module");
    expect(result.ok && result.value.fileName).toBe("swerve-module.step");
  });

  it("normalizes tags and keeps grants only when restricted", () => {
    const open = validateFileMetadata({
      ...base,
      tags: [" Swerve ", "swerve", "CAD"],
      visibility: "team",
      grantUserIds: ["u1"],
    });
    expect(open.ok && open.value.tags).toEqual(["swerve", "cad"]);
    expect(open.ok && open.value.grantUserIds).toEqual([]);

    const restricted = validateFileMetadata({
      ...base,
      visibility: "restricted",
      grantUserIds: ["u1", "u1", " u2 "],
    });
    expect(restricted.ok && restricted.value.visibility).toBe("restricted");
    expect(restricted.ok && restricted.value.grantUserIds).toEqual(["u1", "u2"]);
  });

  it("falls back to octet-stream for junk content types", () => {
    const result = validateFileMetadata({ ...base, contentType: "not a mime" });
    expect(result.ok && result.value.contentType).toBe("application/octet-stream");
  });
});

describe("validateLinkInput", () => {
  it("accepts http(s) URLs and defaults the title to the hostname", () => {
    const result = validateLinkInput({ url: "https://www.andymark.com/products/x" });
    expect(result.ok && result.value.title).toBe("www.andymark.com");
  });

  it("rejects non-http schemes", () => {
    for (const url of ["javascript:alert(1)", "ftp://x", "file:///etc/passwd", ""]) {
      expect(validateLinkInput({ url, title: "t" }).ok, url).toBe(false);
    }
  });

  it("keeps the caller's title and notes", () => {
    const result = validateLinkInput({
      url: "http://example.com/manual",
      title: "Vendor manual",
      notes: " page 4 has the torque spec ",
    });
    expect(result.ok && result.value.title).toBe("Vendor manual");
    expect(result.ok && result.value.notes).toBe("page 4 has the torque spec");
  });
});

describe("file-name and content-type hygiene", () => {
  it("strips directory components from file names", () => {
    expect(sanitizeFileName("C:\\Users\\me\\intake.sldprt")).toBe("intake.sldprt");
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("   ")).toBe("file");
  });

  it("normalizes content types and strips parameters", () => {
    expect(normalizeContentType("Text/Plain; charset=utf-8")).toBe("text/plain");
    expect(normalizeContentType(undefined)).toBe("application/octet-stream");
    expect(normalizeContentType("weird")).toBe("application/octet-stream");
  });

  it("derives titles from file names", () => {
    expect(titleFromFileName("robot manual.pdf")).toBe("robot manual");
    expect(titleFromFileName(".gitignore")).toBe(".gitignore");
  });
});

describe("tags and grants normalization", () => {
  it("splits comma/newline tag input", () => {
    expect(parseTagInput("swerve, 2024\nDrivetrain,,swerve")).toEqual([
      "swerve",
      "2024",
      "drivetrain",
    ]);
  });

  it("caps tag count at 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(normalizeTags(many)).toHaveLength(20);
  });

  it("ignores non-string grant ids", () => {
    expect(normalizeGrantUserIds(["u1", 42, null, "u1"])).toEqual(["u1"]);
    expect(normalizeGrantUserIds("u1")).toEqual([]);
  });
});

describe("serving helpers", () => {
  it("builds a safe Content-Disposition with an ASCII fallback", () => {
    const header = contentDispositionFor('bracket "v2" étude.step', false);
    expect(header.startsWith("attachment; ")).toBe(true);
    expect(header).toContain('filename="bracket _v2_ _tude.step"');
    expect(header).toContain("filename*=UTF-8''bracket%20%22v2%22%20%C3%A9tude.step");
  });

  it("previews images inline but never SVG or non-images", () => {
    expect(isInlinePreviewable("image/png")).toBe(true);
    expect(isInlinePreviewable("image/jpeg")).toBe(true);
    expect(isInlinePreviewable("image/svg+xml")).toBe(false);
    expect(isInlinePreviewable("application/pdf")).toBe(false);
    expect(isInlinePreviewable(null)).toBe(false);
  });
});
