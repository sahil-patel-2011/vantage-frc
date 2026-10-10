import { describe, expect, it } from "vitest";
import { qualityAnswerLabel, qualityReportQuery, qualityReportUrl, readQualityReportPage } from "./quality-reports";

const orgId = "11111111-1111-4111-8111-111111111111";
const schemaId = "22222222-2222-4222-8222-222222222222";
const validationId = "33333333-3333-4333-8333-333333333333";
const entryId = "44444444-4444-4444-8444-444444444444";
const scope = { orgId, schemaId, eventKey: "2026txho", fieldKey: "q_saved", status: "conflict" as const };
const report = { validationId, entryId, matchKey: "2026txho_qm1", teamKey: "frc6925", scoutName: "Scout", source: "manual", status: "conflict",
  scoutValue: false, officialValue: "DeepCage", checkedAt: "2026-10-09T12:00:00.123456Z", updatedAt: "2026-10-09T11:59:00.000001Z" };
const page = { ...scope, checkingEnabled: true, reports: [report], nextCursor: { checkedAt: report.checkedAt, validationId } };
describe("scouting question report evidence", () => {
  it("retains microsecond cursor precision and explicit false/zero answers", () => {
    expect(readQualityReportPage(page, scope)).toEqual(page);
    const url = new URL(qualityReportUrl(scope, page.nextCursor), "https://vantage.example");
    expect(url.searchParams.get("beforeCheckedAt")).toBe(report.checkedAt);
    expect(qualityReportQuery.parse(Object.fromEntries(url.searchParams)).beforeCheckedAt).toBe(report.checkedAt);
    expect(qualityAnswerLabel(false)).toBe("No"); expect(qualityAnswerLabel(0)).toBe("0");
    expect(qualityAnswerLabel(null)).toBe("Not observed");
  });
  it("refuses mixed team/event/schema/question/filter results and cross-event reports", () => {
    for (const changed of [{ orgId: schemaId }, { eventKey: "2026txda" }, { schemaId: orgId }, { fieldKey: "other" }, { status: "all" },
      { reports: [{ ...report, matchKey: "2026txda_qm1" }] }, { reports: [{ ...report, status: "match" }] }]) {
      expect(readQualityReportPage({ ...page, ...changed }, scope)).toBeNull();
    }
  });
  it("rejects malformed, duplicate, disabled and invalid cursor evidence", () => {
    for (const changed of [{ reports: [report, report] }, { checkingEnabled: false }, { reports: [null] },
      { reports: [{ ...report, scoutValue: { invented: true } }] }, { nextCursor: { ...page.nextCursor, validationId: entryId } }]) {
      expect(readQualityReportPage({ ...page, ...changed }, scope)).toBeNull();
    }
    expect(readQualityReportPage({ ...page, checkingEnabled: false, reports: [], nextCursor: null }, scope)?.checkingEnabled).toBe(false);
    expect(qualityReportQuery.safeParse({ ...scope, beforeValidationId: validationId }).success).toBe(false);
    expect(qualityReportQuery.safeParse({ ...scope, beforeCheckedAt: "2026-02-30T12:00:00Z", beforeValidationId: validationId }).success).toBe(false);
    expect(qualityReportQuery.safeParse({ ...scope, fieldKey: "q".repeat(200) }).success).toBe(true);
  });
});
