import { describe, expect, it } from "vitest";
import { ImportShapeError } from "./result";
import { resolveStimsColumns, stimsRosterToInviteDrafts } from "./stims";

/**
 * FIXTURES — FIRST does not publish the column names of the youth-registration
 * roster download, and they differ between seasons, so these exercise the
 * TOLERANT HEADER MATCHER rather than claiming to be a verbatim STIMS file.
 * Every person below is obviously fictional (example.org addresses).
 */
const SPLIT_NAME_ROSTER = [
  "First Name,Last Name,Email Address,Grade,Parent Email",
  "Ada,Lovelace,ada@example.org,11,guardian1@example.org",
  "Grace,Hopper,grace@example.org,12,guardian2@example.org",
  "Alan,Turing,ALAN@EXAMPLE.ORG,10,guardian3@example.org",
].join("\n");

const FULL_NAME_ROSTER = [
  "Student Name,Email,Team",
  "Ada Lovelace,ada@example.org,9991",
  "Katherine Johnson,katherine@example.org,9991",
].join("\n");

describe("resolveStimsColumns", () => {
  it("finds split first/last name columns and the member email", () => {
    const columns = resolveStimsColumns([
      "First Name",
      "Last Name",
      "Email Address",
      "Grade",
      "Parent Email",
    ]);
    expect(columns).toMatchObject({
      email: "Email Address",
      firstName: "First Name",
      lastName: "Last Name",
      fullName: null,
    });
  });

  it("never picks a parent or guardian column as the invite address", () => {
    const columns = resolveStimsColumns(["Student Name", "Email", "Guardian Email"]);
    expect(columns.email).toBe("Email");
    expect(columns.ignoredGuardianColumns).toEqual(["Guardian Email"]);
  });

  it("rejects a roster whose only email column is a guardian contact", () => {
    expect(() => resolveStimsColumns(["Student Name", "Parent Email"])).toThrow(ImportShapeError);
    try {
      resolveStimsColumns(["Student Name", "Parent Email"]);
    } catch (error) {
      expect((error as Error).message).toMatch(/only email columns .* are parent\/guardian contacts/);
    }
  });

  it("rejects a file with no email column, naming what it looked for", () => {
    expect(() => resolveStimsColumns(["Name", "Grade", "T-Shirt Size"])).toThrow(/Expected a roster CSV/);
  });

  it("rejects a file with an email but no name column", () => {
    expect(() => resolveStimsColumns(["Email", "Grade"])).toThrow(/no name column/);
  });
});

describe("stimsRosterToInviteDrafts", () => {
  const result = stimsRosterToInviteDrafts({
    content: SPLIT_NAME_ROSTER,
    sourceFile: "roster.csv",
    now: new Date("2026-01-05T00:00:00.000Z"),
  });

  it("produces one reviewable invite draft per roster row", () => {
    expect(result.drafts.map((draft) => draft.email)).toEqual([
      "ada@example.org",
      "grace@example.org",
      "alan@example.org",
    ]);
    expect(result.drafts.map((draft) => draft.personName)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
      "Alan Turing",
    ]);
  });

  it("marks every draft as an invite carrying provenance — nothing is sent by parsing", () => {
    expect(result.drafts.every((draft) => draft.kind === "invite")).toBe(true);
    expect(result.drafts[0]!.provenance.source).toBe("stims");
    expect(result.drafts[0]!.provenance.sourceFile).toBe("roster.csv");
  });

  it("reports the guardian columns it deliberately ignored", () => {
    expect(result.skipped.some((skip) => /never used as an invite address/.test(skip.reason))).toBe(true);
  });

  it("reads a single full-name column too", () => {
    const full = stimsRosterToInviteDrafts({ content: FULL_NAME_ROSTER });
    expect(full.drafts.map((draft) => draft.personName)).toEqual(["Ada Lovelace", "Katherine Johnson"]);
  });

  it("is idempotent on email, so re-importing next week's roster adds only the new rows", () => {
    const withNewStudent = stimsRosterToInviteDrafts({
      content: `${SPLIT_NAME_ROSTER}\nMargaret,Hamilton,margaret@example.org,11,guardian4@example.org`,
    });
    expect(withNewStudent.drafts.map((draft) => draft.idempotencyKey)).toEqual([
      ...result.drafts.map((draft) => draft.idempotencyKey),
      "stims:margaret@example.org",
    ]);
  });

  it("skips a duplicate email rather than queueing a second invite", () => {
    const duplicated = stimsRosterToInviteDrafts({
      content: `${SPLIT_NAME_ROSTER}\nAda,Lovelace,ada@example.org,11,guardian1@example.org`,
    });
    expect(duplicated.drafts).toHaveLength(3);
    expect(duplicated.skipped.some((skip) => /duplicate of an earlier row for ada@example.org/.test(skip.reason))).toBe(
      true,
    );
  });

  it("skips a row with an unusable address instead of mailing a typo", () => {
    const typo = stimsRosterToInviteDrafts({
      content: "First Name,Last Name,Email\nAda,Lovelace,ada@examplecom",
    });
    expect(typo.drafts).toHaveLength(0);
    expect(typo.skipped[0]?.reason).toMatch(/is not a usable email address/);
  });

  it("skips a row that has an email but no name to review it by", () => {
    const nameless = stimsRosterToInviteDrafts({
      content: "First Name,Last Name,Email\n,,nobody@example.org",
    });
    expect(nameless.drafts).toHaveLength(0);
    expect(nameless.skipped[0]?.reason).toMatch(/no name to review it by/);
  });

  it("reports an empty roster instead of silently importing nothing", () => {
    const empty = stimsRosterToInviteDrafts({ content: "First Name,Last Name,Email" });
    expect(empty.drafts).toHaveLength(0);
    expect(empty.errors[0]?.message).toMatch(/no data rows/);
  });
});
