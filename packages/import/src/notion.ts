import { provenanceNow, type ImportDraft } from "./provenance";

/** Minimal Notion property shapes we accept — never invent dates or titles. */

export type NotionDateProperty = { start?: string | null; end?: string | null };

export type NotionPage = {
  id: string;
  url?: string;
  properties: Record<string, unknown>;
};

function titleFrom(properties: Record<string, unknown>): string {
  for (const value of Object.values(properties)) {
    if (!value || typeof value !== "object") continue;
    const record = value as { type?: string; title?: Array<{ plain_text?: string }> };
    if (record.type === "title") {
      const text = (record.title ?? []).map((item) => item.plain_text ?? "").join("").trim();
      if (text) return text;
    }
  }
  return "";
}

function dateFrom(properties: Record<string, unknown>): NotionDateProperty | null {
  for (const value of Object.values(properties)) {
    if (!value || typeof value !== "object") continue;
    const record = value as { type?: string; date?: NotionDateProperty | null };
    if (record.type === "date" && record.date?.start) return record.date;
  }
  return null;
}

function statusFrom(properties: Record<string, unknown>): string | null {
  for (const value of Object.values(properties)) {
    if (!value || typeof value !== "object") continue;
    const record = value as { type?: string; status?: { name?: string }; select?: { name?: string } };
    if (record.type === "status" && record.status?.name) return record.status.name;
    if (record.type === "select" && record.select?.name) return record.select.name;
  }
  return null;
}

export function notionPageToDraft(page: NotionPage, now: Date = new Date()): ImportDraft | null {
  const title = titleFrom(page.properties);
  if (!title) return null;
  const date = dateFrom(page.properties);
  const status = statusFrom(page.properties);
  const provenance = provenanceNow("notion", { sourceId: page.id, sourceUrl: page.url }, now);
  if (date?.start) {
    return {
      kind: "calendar",
      title,
      startsAt: date.start,
      endsAt: date.end ?? undefined,
      payload: { status },
      provenance,
    };
  }
  if (status) {
    return {
      kind: "task",
      title,
      payload: { status },
      provenance,
    };
  }
  return {
    kind: "knowledge",
    title,
    provenance,
  };
}

export function notionPagesToDrafts(pages: NotionPage[], now: Date = new Date()): ImportDraft[] {
  return pages.map((page) => notionPageToDraft(page, now)).filter((draft): draft is ImportDraft => Boolean(draft));
}
