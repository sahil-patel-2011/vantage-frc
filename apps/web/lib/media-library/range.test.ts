import { describe, expect, it } from "vitest";
import {
  contentRangeHeader,
  parseRangeHeader,
  rangeLength,
  unsatisfiableContentRange,
} from "./range";

describe("parseRangeHeader", () => {
  const SIZE = 1000;

  it("serves full when no header is present", () => {
    expect(parseRangeHeader(null, SIZE)).toEqual({ kind: "full" });
    expect(parseRangeHeader(undefined, SIZE)).toEqual({ kind: "full" });
    expect(parseRangeHeader("", SIZE)).toEqual({ kind: "full" });
  });

  it("parses a closed range", () => {
    expect(parseRangeHeader("bytes=0-499", SIZE)).toEqual({
      kind: "range",
      range: { start: 0, end: 499 },
    });
    expect(parseRangeHeader("bytes=500-999", SIZE)).toEqual({
      kind: "range",
      range: { start: 500, end: 999 },
    });
  });

  it("clamps an end beyond the resource", () => {
    expect(parseRangeHeader("bytes=900-5000", SIZE)).toEqual({
      kind: "range",
      range: { start: 900, end: 999 },
    });
  });

  it("parses an open-ended range (seek)", () => {
    expect(parseRangeHeader("bytes=250-", SIZE)).toEqual({
      kind: "range",
      range: { start: 250, end: 999 },
    });
  });

  it("parses a suffix range (last N bytes)", () => {
    expect(parseRangeHeader("bytes=-100", SIZE)).toEqual({
      kind: "range",
      range: { start: 900, end: 999 },
    });
    // Suffix longer than the resource → whole resource.
    expect(parseRangeHeader("bytes=-5000", SIZE)).toEqual({
      kind: "range",
      range: { start: 0, end: 999 },
    });
  });

  it("is case-insensitive and tolerant of whitespace", () => {
    expect(parseRangeHeader("Bytes=0-1", SIZE)).toEqual({
      kind: "range",
      range: { start: 0, end: 1 },
    });
    expect(parseRangeHeader("  bytes=0-1  ", SIZE)).toEqual({
      kind: "range",
      range: { start: 0, end: 1 },
    });
  });

  it("returns unsatisfiable when the range starts past the end", () => {
    expect(parseRangeHeader("bytes=1000-", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=1500-2000", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=-0", SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  it("ignores malformed headers, other units, and multi-range requests", () => {
    expect(parseRangeHeader("bytes=abc-def", SIZE)).toEqual({ kind: "full" });
    expect(parseRangeHeader("items=0-10", SIZE)).toEqual({ kind: "full" });
    expect(parseRangeHeader("bytes=0-10,20-30", SIZE)).toEqual({ kind: "full" });
    expect(parseRangeHeader("bytes=-", SIZE)).toEqual({ kind: "full" });
    expect(parseRangeHeader("bytes=10-5", SIZE)).toEqual({ kind: "full" });
  });

  it("handles a one-byte resource", () => {
    expect(parseRangeHeader("bytes=0-0", 1)).toEqual({
      kind: "range",
      range: { start: 0, end: 0 },
    });
    expect(parseRangeHeader("bytes=1-", 1)).toEqual({ kind: "unsatisfiable" });
  });
});

describe("range headers", () => {
  it("computes inclusive lengths", () => {
    expect(rangeLength({ start: 0, end: 0 })).toBe(1);
    expect(rangeLength({ start: 200, end: 999 })).toBe(800);
  });

  it("builds Content-Range for 206 and 416", () => {
    expect(contentRangeHeader({ start: 0, end: 499 }, 1000)).toBe("bytes 0-499/1000");
    expect(unsatisfiableContentRange(1000)).toBe("bytes */1000");
  });
});
