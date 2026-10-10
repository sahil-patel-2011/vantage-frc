import { z } from "zod";
import { coverageEventKey } from "./coverage-request";

const uuid = z.string().uuid();
const timestamp = z.string().max(40).datetime().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10));
export const QUALITY_REPORT_PAGE_SIZE = 25;
export const qualityReportCursor = z.object({ checkedAt: timestamp, validationId: uuid }).strict();
export const qualityReportQuery = z.object({
  orgId: uuid, eventKey: coverageEventKey, schemaId: uuid, fieldKey: z.string().min(1).max(200),
  status: z.enum(["all", "conflict"]).default("all"),
  beforeCheckedAt: timestamp.optional(), beforeValidationId: uuid.optional(),
}).strict().refine(value => Boolean(value.beforeCheckedAt) === Boolean(value.beforeValidationId), "A report cursor needs both parts.");
const answer = z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]);
export const qualityReportPage = z.object({
  orgId: uuid, eventKey: coverageEventKey, schemaId: uuid, fieldKey: z.string(), status: z.enum(["all", "conflict"]),
  checkingEnabled: z.boolean(),
  reports: z.array(z.object({
    validationId: uuid, entryId: uuid, matchKey: z.string(), teamKey: z.string(), scoutName: z.string(), source: z.string(),
    status: z.enum(["match", "conflict"]), scoutValue: answer, officialValue: answer,
    checkedAt: timestamp, updatedAt: timestamp,
  })).max(QUALITY_REPORT_PAGE_SIZE),
  nextCursor: qualityReportCursor.nullable(),
});
export type QualityReportPage = z.infer<typeof qualityReportPage>;
export type QualityReportScope = Pick<QualityReportPage, "orgId" | "eventKey" | "schemaId" | "fieldKey" | "status">;
export type QualityReportCursor = z.infer<typeof qualityReportCursor>;

export function readQualityReportPage(value: unknown, scope: QualityReportScope): QualityReportPage | null {
  const parsed = qualityReportPage.safeParse(value);
  if (!parsed.success) return null;
  const page = parsed.data;
  if (page.orgId !== scope.orgId || page.eventKey !== scope.eventKey || page.schemaId !== scope.schemaId || page.fieldKey !== scope.fieldKey || page.status !== scope.status) return null;
  if (new Set(page.reports.map(report => report.validationId)).size !== page.reports.length) return null;
  if (page.reports.some(report => !report.matchKey.startsWith(`${scope.eventKey}_`) || scope.status === "conflict" && report.status !== "conflict")) return null;
  if (!page.checkingEnabled && (page.reports.length || page.nextCursor)) return null;
  const last = page.reports.at(-1);
  if (page.nextCursor && (!last || page.nextCursor.validationId !== last.validationId || page.nextCursor.checkedAt !== last.checkedAt)) return null;
  return page;
}

export function qualityReportUrl(scope: QualityReportScope, cursor: QualityReportCursor | null): string {
  const params = new URLSearchParams(scope);
  if (cursor) { params.set("beforeCheckedAt", cursor.checkedAt); params.set("beforeValidationId", cursor.validationId); }
  return `/api/scouting/quality-reports?${params}`;
}
export function qualityAnswerLabel(value: string | number | boolean | null): string {
  return value === null || typeof value === "string" && !value.trim() ? "Not observed" : typeof value === "boolean" ? value ? "Yes" : "No" : String(value);
}
