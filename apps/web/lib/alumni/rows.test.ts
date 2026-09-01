import { describe, expect, it } from "vitest";
import {
  AlumniWriteError,
  alumniGradYear,
  directoryFromRows,
  isPlaceholderAlumniName,
  mapAlumniRow,
  parseAlumniWrite,
  summarizeAlumni,
} from "./rows";

describe("directoryFromRows — empty vs persisted", () => {
  it("returns an honest empty directory when no rows are persisted", () => {
    const directory = directoryFromRows([], "viewer-1");
    expect(directory.alumni).toEqual([]);
    expect(directory.summary).toEqual({ total: 0, mentors: 0 });
    expect(directory.viewerId).toBe("viewer-1");
    expect(JSON.stringify(directory)).not.toMatch(/DEMO/i);
  });

  it("returns the persisted row and never invents DEMO classmates", () => {
    const directory = directoryFromRows(
      [
        {
          id: "alum-1",
          fullName: "Ada Lovelace",
          gradYear: 2019,
          currentRole: "Robotics Engineer",
          email: "ada@example.com",
          discordHandle: null,
          linkedinUrl: null,
          note: null,
          isMentor: true,
          mentorTopic: "CAD",
          addedBy: "user-1",
          createdAt: "2026-03-01T00:00:00.000Z",
        },
      ],
      "viewer-1",
    );

    expect(directory.alumni).toHaveLength(1);
    expect(directory.alumni[0]).toMatchObject({
      id: "alum-1",
      fullName: "Ada Lovelace",
      gradYear: 2019,
      isMentor: true,
      mentorTopic: "CAD",
    });
    expect(directory.summary).toEqual({ total: 1, mentors: 1 });
    expect(directory.alumni.every((row) => !/DEMO/i.test(row.fullName))).toBe(true);
  });

  it("drops unusable rows instead of filling them with invented classmates", () => {
    const directory = directoryFromRows(
      [null, { id: "", fullName: "No id" }, { id: "x", fullName: "   " }, { id: "ok", fullName: "Sam Rivera" }],
      "v",
    );
    expect(directory.alumni.map((row) => row.fullName)).toEqual(["Sam Rivera"]);
    expect(directory.summary.total).toBe(1);
  });
});

describe("mapAlumniRow / summarizeAlumni", () => {
  it("accepts snake_case columns from a raw table scan", () => {
    const row = mapAlumniRow({
      id: "a1",
      full_name: "Jo Chen",
      grad_year: 2022,
      is_mentor: true,
      mentor_topic: "controls",
      added_by: "u1",
      created_at: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(row?.fullName).toBe("Jo Chen");
    expect(row?.gradYear).toBe(2022);
    expect(row?.isMentor).toBe(true);
    expect(row?.createdAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("summarizes only the rows it was given", () => {
    expect(summarizeAlumni([])).toEqual({ total: 0, mentors: 0 });
    expect(
      summarizeAlumni([
        { isMentor: true } as never,
        { isMentor: false } as never,
        { isMentor: true } as never,
      ]),
    ).toEqual({ total: 3, mentors: 2 });
  });
});

describe("parseAlumniWrite / placeholder names", () => {
  it("rejects blank names and DEMO classmate seeds", () => {
    expect(() => parseAlumniWrite({ fullName: "  " })).toThrow(AlumniWriteError);
    expect(() => parseAlumniWrite({ fullName: "DEMO Classmate" })).toThrow(/DEMO classmates/i);
    expect(() => parseAlumniWrite({ fullName: "demo" })).toThrow(/DEMO classmates/i);
    expect(() => parseAlumniWrite({ fullName: "Classmate 1" })).toThrow(/DEMO classmates/i);
    expect(isPlaceholderAlumniName("Sample Alum")).toBe(true);
  });

  it("accepts a real graduate and an optional valid year", () => {
    const write = parseAlumniWrite({
      fullName: "  Taylor Nguyen  ",
      gradYear: "2024",
      isMentor: true,
      mentorTopic: "business",
    });
    expect(write.fullName).toBe("Taylor Nguyen");
    expect(write.gradYear).toBe(2024);
    expect(write.isMentor).toBe(true);
    expect(write.mentorTopic).toBe("business");
  });

  it("rejects an out-of-range graduation year instead of inventing one", () => {
    expect(() => parseAlumniWrite({ fullName: "Ada", gradYear: 1800 })).toThrow(/Graduation year/);
    expect(alumniGradYear(1989)).toBeNull();
    expect(alumniGradYear(2020)).toBe(2020);
  });
});
