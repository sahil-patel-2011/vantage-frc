import { describe, expect, it } from "vitest";
import {
  canManageDriveRow,
  canReadDriveRow,
  canShareDriveRow,
  drivePreviewKind,
  formatDriveBytes,
  isDriveScope,
  isDriveShareToken,
  normalizeDriveContentType,
  normalizeShareEmail,
  ownerForScope,
  parseShareEmails,
  sanitizeDriveName,
} from "./validation";
import type { DriveActor, DriveRow } from "./validation";

const student: DriveActor = { userId: "student", role: "scout" };
const otherStudent: DriveActor = { userId: "other", role: "scout" };
const owner: DriveActor = { userId: "owner", role: "owner" };
const admin: DriveActor = { userId: "admin", role: "admin" };

const studentPersonal: DriveRow = {
  scope: "personal",
  ownerUserId: "student",
  authorUserId: "student",
};
const teamFileByStudent: DriveRow = {
  scope: "team",
  ownerUserId: null,
  authorUserId: "student",
};

describe("scope rules — personal space is private, including from the adults", () => {
  it("lets the owner of a personal file read it", () => {
    expect(canReadDriveRow(studentPersonal, student)).toBe(true);
  });

  it("does NOT let another student read it", () => {
    expect(canReadDriveRow(studentPersonal, otherStudent)).toBe(false);
  });

  it("does NOT let the team owner read it", () => {
    expect(canReadDriveRow(studentPersonal, owner)).toBe(false);
  });

  it("does NOT let a team admin read it", () => {
    expect(canReadDriveRow(studentPersonal, admin)).toBe(false);
  });

  it("does not let a lead manage or share it either", () => {
    expect(canManageDriveRow(studentPersonal, owner)).toBe(false);
    expect(canShareDriveRow(studentPersonal, admin)).toBe(false);
  });
});

describe("scope rules — team space is the team's", () => {
  it("lets any member read a team file", () => {
    expect(canReadDriveRow(teamFileByStudent, otherStudent)).toBe(true);
  });

  it("lets the uploader manage their own team file", () => {
    expect(canManageDriveRow(teamFileByStudent, student)).toBe(true);
  });

  it("does not let an unrelated member manage someone else's team file", () => {
    expect(canManageDriveRow(teamFileByStudent, otherStudent)).toBe(false);
  });

  it("lets owners and admins manage any team file", () => {
    expect(canManageDriveRow(teamFileByStudent, owner)).toBe(true);
    expect(canManageDriveRow(teamFileByStudent, admin)).toBe(true);
  });
});

describe("ownerForScope", () => {
  it("stamps the owner on personal rows and leaves team rows unowned", () => {
    expect(ownerForScope("personal", "student")).toBe("student");
    expect(ownerForScope("team", "student")).toBeNull();
  });
});

describe("sanitizeDriveName", () => {
  it("keeps only the leaf of a dropped folder path", () => {
    expect(sanitizeDriveName("subsystems/intake/plate.step")).toBe("plate.step");
    expect(sanitizeDriveName("C:\\Users\\me\\bumper.dxf")).toBe("bumper.dxf");
  });

  it("strips control characters that make two files look identical", () => {
    expect(sanitizeDriveName("plan\u0000\u001f.pdf")).toBe("plan.pdf");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeDriveName("  drive   plan .pdf ")).toBe("drive plan .pdf");
  });

  it("returns empty for unusable input so callers can reject it", () => {
    expect(sanitizeDriveName("   ")).toBe("");
    expect(sanitizeDriveName(42)).toBe("");
  });

  it("caps the length", () => {
    expect(sanitizeDriveName("a".repeat(400)).length).toBe(255);
  });
});

describe("normalizeDriveContentType", () => {
  it("accepts the formats FRC teams actually exchange", () => {
    expect(normalizeDriveContentType("model/step")).toBe("model/step");
    expect(normalizeDriveContentType("application/vnd.ms-pki.stl")).toBe("application/vnd.ms-pki.stl");
  });

  it("drops parameters and lowercases", () => {
    expect(normalizeDriveContentType("TEXT/Plain; charset=UTF-8")).toBe("text/plain");
  });

  it("falls back to octet-stream rather than storing junk", () => {
    expect(normalizeDriveContentType("not a mime type")).toBe("application/octet-stream");
    expect(normalizeDriveContentType(undefined)).toBe("application/octet-stream");
  });
});

describe("drivePreviewKind", () => {
  it("previews the formats a browser renders safely", () => {
    expect(drivePreviewKind("image/png")).toBe("image");
    expect(drivePreviewKind("video/mp4")).toBe("video");
    expect(drivePreviewKind("application/pdf")).toBe("pdf");
    expect(drivePreviewKind("text/csv")).toBe("text");
  });

  it("refuses to render SVG inline — an uploaded SVG is a script", () => {
    expect(drivePreviewKind("image/svg+xml")).toBeNull();
  });

  it("refuses to render uploaded HTML inline", () => {
    expect(drivePreviewKind("text/html")).toBeNull();
  });

  it("offers a download for anything else", () => {
    expect(drivePreviewKind("model/step")).toBeNull();
    expect(drivePreviewKind("application/zip")).toBeNull();
  });
});

describe("share tokens", () => {
  it("accepts exactly 32 lowercase hex characters", () => {
    expect(isDriveShareToken("a".repeat(32))).toBe(true);
    expect(isDriveShareToken("0123456789abcdef0123456789abcdef")).toBe(true);
  });

  it("rejects the wrong length, uppercase, and non-hex", () => {
    expect(isDriveShareToken("a".repeat(31))).toBe(false);
    expect(isDriveShareToken("a".repeat(33))).toBe(false);
    expect(isDriveShareToken("A".repeat(32))).toBe(false);
    expect(isDriveShareToken("g".repeat(32))).toBe(false);
    expect(isDriveShareToken(null)).toBe(false);
  });
});

describe("share email parsing", () => {
  it("splits a comma separated list and lowercases", () => {
    expect(parseShareEmails("A@Example.com, b@example.com").emails).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("de-duplicates", () => {
    expect(parseShareEmails("a@example.com a@example.com").emails).toEqual(["a@example.com"]);
  });

  it("reports what it rejected instead of silently dropping it", () => {
    const parsed = parseShareEmails("good@example.com, notanemail");
    expect(parsed.emails).toEqual(["good@example.com"]);
    expect(parsed.rejected).toEqual(["notanemail"]);
  });

  it("caps the batch and reports the overflow", () => {
    const many = Array.from({ length: 30 }, (_, index) => `p${index}@example.com`).join(",");
    const parsed = parseShareEmails(many, 25);
    expect(parsed.emails).toHaveLength(25);
    expect(parsed.rejected).toHaveLength(5);
  });

  it("normalizes a single address", () => {
    expect(normalizeShareEmail("  Coach@Team.ORG ")).toBe("coach@team.org");
    expect(normalizeShareEmail("nope")).toBe("");
  });
});

describe("misc", () => {
  it("recognizes the two scopes and nothing else", () => {
    expect(isDriveScope("team")).toBe(true);
    expect(isDriveScope("personal")).toBe(true);
    expect(isDriveScope("everyone")).toBe(false);
  });

  it("formats bytes without inventing precision", () => {
    expect(formatDriveBytes(0)).toBe("0 B");
    expect(formatDriveBytes(1024)).toBe("1 KB");
    expect(formatDriveBytes(1536)).toBe("1.5 KB");
    expect(formatDriveBytes(4 * 1024 * 1024)).toBe("4 MB");
    expect(formatDriveBytes(-1)).toBe("—");
  });
});
