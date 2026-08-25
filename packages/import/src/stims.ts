/**
 * FIRST youth-registration roster CSV (STIMS / the FIRST Dashboard team roster
 * download). There is no STIMS API — a lead mentor downloads a CSV.
 *
 * HONEST LIMITATION: FIRST does not publish the column names of that download,
 * and they have changed between seasons. So this importer does NOT hard-code a
 * schema it cannot verify. It matches headers by meaning (tolerant matching,
 * below), and if it cannot find an email column it REJECTS the file naming the
 * header spellings it looked for, rather than guessing which column is which.
 *
 * Output is an INVITE LIST DRAFT. Nothing is sent: the owner reviews the list
 * and commits it through the existing invite machinery.
 *
 * Parent/guardian contact columns are deliberately never used as the invite
 * address. On a youth roster those belong to adults who did not ask for a
 * workspace account, and mailing them an invite link would be wrong.
 */

import { parseCsvHeaders } from "./csv-map";
import { parseCsvRows } from "./csv-rows";
import { provenanceNow, type InviteDraft } from "./provenance";
import { emptyResult, rejectShape, type ImportResult } from "./result";

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Headers we refuse to read an invite address out of. */
const GUARDIAN_MARKERS = ["parent", "guardian", "emergency", "caregiver", "mother", "father"];

const EMAIL_MARKERS = ["email", "emailaddress", "mail"];
const FIRST_NAME_MARKERS = ["firstname", "givenname", "first", "youthfirstname", "studentfirstname"];
const LAST_NAME_MARKERS = ["lastname", "surname", "familyname", "last", "youthlastname", "studentlastname"];
const FULL_NAME_MARKERS = ["name", "fullname", "displayname", "studentname", "membername", "youthname"];

function isGuardianColumn(header: string): boolean {
  const key = normalizeHeader(header);
  return GUARDIAN_MARKERS.some((marker) => key.includes(marker));
}

function findHeader(headers: string[], markers: string[], exact: boolean): string | null {
  for (const header of headers) {
    if (isGuardianColumn(header)) continue;
    const key = normalizeHeader(header);
    if (exact ? markers.includes(key) : markers.some((marker) => key.includes(marker))) return header;
  }
  return null;
}

export type StimsColumns = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  /** Guardian contact columns found and deliberately not used. */
  ignoredGuardianColumns: string[];
};

const EXPECTED =
  "a roster CSV whose header row has an email column (\"Email\", \"Email Address\", " +
  "\"Student Email\", …) and a name column (\"Name\", or \"First Name\" + \"Last Name\"). " +
  "Parent/guardian contact columns are never used as the invite address.";

/** Resolve which columns to read, or reject naming what was expected. */
export function resolveStimsColumns(headers: string[]): StimsColumns {
  if (!headers.length) {
    rejectShape("That file has no header row.", EXPECTED);
  }
  const email = findHeader(headers, EMAIL_MARKERS, false);
  if (!email) {
    const guardianOnly = headers.filter(
      (header) => isGuardianColumn(header) && normalizeHeader(header).includes("email"),
    );
    const found = guardianOnly.length
      ? `The only email columns in that file are parent/guardian contacts (${guardianOnly.join(", ")}), which are never invited.`
      : `That file's columns are: ${headers.slice(0, 12).join(", ")}.`;
    rejectShape(found, EXPECTED);
  }
  const firstName = findHeader(headers, FIRST_NAME_MARKERS, true);
  const lastName = findHeader(headers, LAST_NAME_MARKERS, true);
  const fullName = firstName && lastName ? null : findHeader(headers, FULL_NAME_MARKERS, true);
  if (!firstName && !lastName && !fullName) {
    rejectShape(
      `That file has an email column ("${email}") but no name column. Its columns are: ${headers.slice(0, 12).join(", ")}.`,
      EXPECTED,
    );
  }
  return {
    email,
    firstName,
    lastName,
    fullName,
    ignoredGuardianColumns: headers.filter(isGuardianColumn),
  };
}

/** Conservative address check — we would rather skip a row than mail a typo. */
function isPlausibleEmail(value: string): boolean {
  return /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/.test(value) && value.length <= 254;
}

export type StimsImportInput = {
  content: string;
  sourceFile?: string;
  now?: Date;
};

/**
 * Roster CSV -> invite drafts. Deduped by lowercased email, so re-importing the
 * same roster (or next week's roster with three new students) produces the same
 * list plus the new rows — never a second invite for the same person.
 */
export function stimsRosterToInviteDrafts(
  input: StimsImportInput,
): ImportResult<InviteDraft> {
  const result = emptyResult<InviteDraft>();
  const headers = parseCsvHeaders(input.content);
  const columns = resolveStimsColumns(headers);
  const now = input.now ?? new Date();

  if (columns.ignoredGuardianColumns.length) {
    result.skipped.push({
      ref: columns.ignoredGuardianColumns.join(", "),
      reason: "parent/guardian contact columns are never used as an invite address",
    });
  }

  const rows = parseCsvRows(input.content);
  if (!rows.length) {
    result.errors.push({ ref: "file", message: "That CSV has a header row but no data rows." });
    return result;
  }

  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const ref = `row ${index + 2}`;
    const email = (row[columns.email] ?? "").trim().toLowerCase();
    if (!email) {
      result.skipped.push({ ref, reason: `the "${columns.email}" column is empty` });
      return;
    }
    if (!isPlausibleEmail(email)) {
      result.skipped.push({ ref, reason: `"${email}" is not a usable email address` });
      return;
    }
    const personName = columns.fullName
      ? (row[columns.fullName] ?? "").trim()
      : [columns.firstName ? row[columns.firstName] : "", columns.lastName ? row[columns.lastName] : ""]
          .map((part) => (part ?? "").trim())
          .filter(Boolean)
          .join(" ");
    if (!personName) {
      result.skipped.push({ ref, reason: "the row has an email but no name to review it by" });
      return;
    }
    if (seen.has(email)) {
      result.skipped.push({ ref, reason: `duplicate of an earlier row for ${email}` });
      return;
    }
    seen.add(email);

    result.drafts.push({
      kind: "invite",
      title: personName,
      email,
      personName,
      idempotencyKey: `stims:${email}`,
      provenance: provenanceNow("stims", { sourceFile: input.sourceFile, sourceId: email }, now),
    });
  });

  return result;
}
