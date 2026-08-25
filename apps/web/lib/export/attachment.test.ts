import { describe, expect, it } from "vitest";
import { csvContentDisposition, sanitizeCsvFileName } from "./attachment";

describe("sanitizeCsvFileName", () => {
  it("keeps a well-formed name and normalises the extension to one .csv", () => {
    expect(sanitizeCsvFileName("scouting-entries-team-1234-2026-04-18.csv")).toBe(
      "scouting-entries-team-1234-2026-04-18.csv",
    );
    expect(sanitizeCsvFileName("rankings")).toBe("rankings.csv");
  });

  it("strips directory traversal", () => {
    expect(sanitizeCsvFileName("../../etc/passwd")).toBe("passwd.csv");
    expect(sanitizeCsvFileName("C:\\Windows\\system32\\config")).toBe("config.csv");
  });

  it("strips CR/LF so a filename cannot inject a response header", () => {
    expect(sanitizeCsvFileName('a.csv"\r\nSet-Cookie: x=1')).toBe("a.csv-Set-Cookie-x-1.csv");
  });

  it("falls back when nothing usable survives", () => {
    expect(sanitizeCsvFileName("...")).toBe("vantage-export.csv");
    expect(sanitizeCsvFileName(undefined)).toBe("vantage-export.csv");
    expect(sanitizeCsvFileName(42)).toBe("vantage-export.csv");
  });

  it("collapses non-ASCII into separators rather than emitting raw bytes in a header", () => {
    expect(sanitizeCsvFileName("équipe québec.csv")).toBe("quipe-qu-bec.csv");
  });
});

describe("csvContentDisposition", () => {
  it("marks the response as an attachment with both filename forms", () => {
    expect(csvContentDisposition("rankings-2026-04-18.csv")).toBe(
      "attachment; filename=\"rankings-2026-04-18.csv\"; filename*=UTF-8''rankings-2026-04-18.csv",
    );
  });
});
