import { describe, expect, it } from "vitest";
import {
  describeAttachedLinks,
  linkLabelFromUrl,
  meetingProvider,
  optionalHttpsUrl,
  parseAttachedLinks,
  requireAttachedLinks,
} from "./links";

describe("planner links", () => {
  it("labels meeting providers", () => {
    expect(meetingProvider("https://meet.google.com/abc-defg-hij")).toBe("Google Meet");
    expect(meetingProvider("https://us06web.zoom.us/j/123")).toBe("Zoom");
    expect(meetingProvider("https://example.com/room")).toBe("Meeting");
    expect(meetingProvider("")).toBeNull();
  });

  it("labels attached docs and CAD", () => {
    expect(linkLabelFromUrl("https://docs.google.com/document/d/1")).toBe("Google Doc");
    expect(linkLabelFromUrl("https://docs.google.com/spreadsheets/d/1")).toBe("Google Sheet");
    expect(linkLabelFromUrl("https://cad.onshape.com/documents/abc")).toBe("Onshape");
    expect(linkLabelFromUrl("https://github.com/team/repo")).toBe("GitHub");
  });

  it("requires https URLs", () => {
    expect(optionalHttpsUrl("")).toBeNull();
    expect(optionalHttpsUrl("https://meet.google.com/abc")).toMatch(/^https:\/\/meet\.google\.com\//);
    expect(() => optionalHttpsUrl("http://meet.google.com/abc")).toThrow(/https/);
    expect(() => optionalHttpsUrl("ftp://files")).toThrow(/https/);
    expect(() => optionalHttpsUrl("not-a-url")).toThrow(/https:\/\//);
  });

  it("parses and dedupes attached links", () => {
    expect(
      parseAttachedLinks([
        { label: "CAD", url: "https://cad.onshape.com/documents/a" },
        { url: "https://cad.onshape.com/documents/a" },
        { url: "https://docs.google.com/spreadsheets/d/1" },
        { url: "" },
      ]),
    ).toEqual([
      { label: "CAD", url: "https://cad.onshape.com/documents/a" },
      { label: "Google Sheet", url: "https://docs.google.com/spreadsheets/d/1" },
    ]);
  });

  it("rejects a bad URL when required", () => {
    expect(() => requireAttachedLinks([{ url: "http://insecure" }])).toThrow(/https/);
    expect(requireAttachedLinks([])).toEqual([]);
  });

  it("describes links for ICS / notes", () => {
    expect(
      describeAttachedLinks([{ label: "Sheet", url: "https://docs.google.com/spreadsheets/d/1" }]),
    ).toBe("Sheet: https://docs.google.com/spreadsheets/d/1");
  });
});
