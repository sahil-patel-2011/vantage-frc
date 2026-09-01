/**
 * Awards workbench export — copy-all text + printable/PDF-ready HTML.
 *
 * A team finishes essays here so they can paste them into the FIRST portal. The packet is
 * deliberately literal: only `award_items` rows with authored content are included. Empty
 * catalog prompts stay out, and impact hours are never invented or attached.
 */

import {
  AWARD_STATUSES,
  awardCatalogEntry,
  awardStatusLabel,
  type AwardStatus,
} from "../awards";
import {
  AWARD_NOTEBOOK_TEXT_ONLY_REFUSAL,
  selectAwardNotebookPhotoEvidence,
  type AwardNotebookEntryInput,
  type AwardNotebookPhotoCite,
} from "./notebook-evidence";

export const AWARD_EXPORT_DISCLAIMER =
  "Only written award items are included. Empty prompts are omitted. Impact hours are never invented. Text-only notebook entries are not photo evidence.";

export {
  AWARD_NOTEBOOK_TEXT_ONLY_REFUSAL,
  isAwardNotebookPhotoEvidence,
  selectAwardNotebookPhotoEvidence,
  type AwardNotebookEntryInput,
  type AwardNotebookPhotoCite,
} from "./notebook-evidence";

export type AwardExportSubmissionInput = {
  id: string;
  seasonYear: number;
  awardType: string;
  title?: string | null;
  status: string;
  eventKey?: string | null;
  deadline?: string | null;
};

export type AwardExportItemInput = {
  id: string;
  kind?: string | null;
  prompt?: string | null;
  content?: string | null;
  charLimit?: number | null;
  done?: boolean | null;
  sortOrder?: number | null;
};

export type AwardExportItem = {
  id: string;
  kind: string;
  prompt: string | null;
  content: string;
  charCount: number;
  charLimit: number | null;
  done: boolean;
};

export type AwardExportPayload = {
  submissionId: string;
  awardName: string;
  seasonYear: number;
  statusLabel: string;
  eventKey: string | null;
  deadline: string | null;
  items: AwardExportItem[];
  omittedEmptyCount: number;
  notebookPhotoEvidence: AwardNotebookPhotoCite[];
  omittedTextOnlyNotebookCount: number;
  copyText: string;
  printableHtml: string;
  fileStem: string;
};

/** True when the item has authored text a team can paste into the FIRST portal. */
export function isRealAwardItem(item: AwardExportItemInput): boolean {
  return typeof item.content === "string" && item.content.trim().length > 0;
}

export function awardExportName(submission: AwardExportSubmissionInput): string {
  const titled = typeof submission.title === "string" ? submission.title.trim() : "";
  if (titled) return titled;
  return awardCatalogEntry(submission.awardType)?.name ?? submission.awardType;
}

export function awardExportStatusLabel(status: string): string {
  return AWARD_STATUSES.includes(status as AwardStatus)
    ? awardStatusLabel(status as AwardStatus)
    : status;
}

export function awardExportFileStem(input: {
  awardName: string;
  seasonYear: number;
  submissionId: string;
}): string {
  const slug = input.awardName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const idTail = input.submissionId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8);
  return `${slug || "award"}-${input.seasonYear}${idTail ? `-${idTail}` : ""}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function realItems(items: readonly AwardExportItemInput[]): AwardExportItem[] {
  return items
    .filter(isRealAwardItem)
    .map((item) => {
      const content = item.content!.trim();
      const prompt = typeof item.prompt === "string" && item.prompt.trim() ? item.prompt.trim() : null;
      return {
        id: item.id,
        kind: item.kind?.trim() || "essay",
        prompt,
        content,
        charCount: content.length,
        charLimit: typeof item.charLimit === "number" && item.charLimit > 0 ? item.charLimit : null,
        done: Boolean(item.done),
      };
    });
}

function notebookCopySection(input: {
  notebookPhotoEvidence: AwardNotebookPhotoCite[];
  omittedTextOnlyNotebookCount: number;
}): string {
  const lines: string[] = [];
  if (input.notebookPhotoEvidence.length > 0) {
    lines.push("Notebook photo evidence");
    for (const cite of input.notebookPhotoEvidence) {
      lines.push(`${cite.title}`);
      if (cite.photos.length === 0) {
        lines.push("(resolved notebook photos; URLs were not attached to this packet)");
      } else {
        for (const photo of cite.photos) {
          lines.push(`- ${photo.title}: ${photo.url}`);
        }
      }
    }
  }
  if (input.omittedTextOnlyNotebookCount > 0) {
    const n = input.omittedTextOnlyNotebookCount;
    lines.push(
      `${AWARD_NOTEBOOK_TEXT_ONLY_REFUSAL} ${n} write-up${n === 1 ? "" : "s"} omitted.`,
    );
  }
  return lines.join("\n");
}

function buildCopyText(input: {
  awardName: string;
  seasonYear: number;
  statusLabel: string;
  eventKey: string | null;
  deadline: string | null;
  items: AwardExportItem[];
  notebookPhotoEvidence: AwardNotebookPhotoCite[];
  omittedTextOnlyNotebookCount: number;
}): string {
  const header = [
    input.awardName,
    `Season ${input.seasonYear}${input.eventKey ? ` · ${input.eventKey}` : ""}${
      input.deadline ? ` · due ${input.deadline}` : ""
    }`,
    `Status: ${input.statusLabel}`,
  ].join("\n");

  const notebook = notebookCopySection(input);
  if (input.items.length === 0) {
    return `${header}\n\n${notebook ? `${notebook}\n\n` : ""}${AWARD_EXPORT_DISCLAIMER}\n`;
  }

  const body = input.items
    .map((item, index) => {
      const heading = item.prompt ?? item.kind;
      return `${index + 1}. ${heading}\n\n${item.content}`;
    })
    .join("\n\n");

  return `${header}\n\n${body}${notebook ? `\n\n${notebook}` : ""}\n\n${AWARD_EXPORT_DISCLAIMER}\n`;
}

function notebookHtmlSection(input: {
  notebookPhotoEvidence: AwardNotebookPhotoCite[];
  omittedTextOnlyNotebookCount: number;
}): string {
  const parts: string[] = [];
  if (input.notebookPhotoEvidence.length > 0) {
    const cites = input.notebookPhotoEvidence
      .map((cite) => {
        const photos =
          cite.photos.length === 0
            ? `<p class="count">Resolved notebook photos; URLs were not attached to this packet.</p>`
            : `<ul>${cite.photos
                .map(
                  (photo) =>
                    `<li>${escapeHtml(photo.title)}: ${escapeHtml(photo.url)}</li>`,
                )
                .join("")}</ul>`;
        return `<section class="item">
  <h2>${escapeHtml(cite.title)}</h2>
  ${photos}
</section>`;
      })
      .join("\n");
    parts.push(`<h2>Notebook photo evidence</h2>\n${cites}`);
  }
  if (input.omittedTextOnlyNotebookCount > 0) {
    const n = input.omittedTextOnlyNotebookCount;
    parts.push(
      `<p class="empty">${escapeHtml(AWARD_NOTEBOOK_TEXT_ONLY_REFUSAL)} ${n} write-up${n === 1 ? "" : "s"} omitted.</p>`,
    );
  }
  return parts.join("\n");
}

function buildPrintableHtml(input: {
  awardName: string;
  seasonYear: number;
  statusLabel: string;
  eventKey: string | null;
  deadline: string | null;
  items: AwardExportItem[];
  notebookPhotoEvidence: AwardNotebookPhotoCite[];
  omittedTextOnlyNotebookCount: number;
}): string {
  const title = escapeHtml(`${input.awardName} — ${input.seasonYear}`);
  const metaBits = [
    `Season ${input.seasonYear}`,
    `Status: ${input.statusLabel}`,
    input.eventKey ? `Event: ${input.eventKey}` : null,
    input.deadline ? `Due ${input.deadline}` : null,
  ]
    .filter((bit): bit is string => Boolean(bit))
    .map((bit) => escapeHtml(bit));

  const itemHtml =
    input.items.length === 0
      ? `<p class="empty">${escapeHtml(AWARD_EXPORT_DISCLAIMER)}</p>`
      : input.items
          .map((item, index) => {
            const heading = escapeHtml(item.prompt ?? item.kind);
            const count =
              item.charLimit != null
                ? `${item.charCount}/${item.charLimit} characters`
                : `${item.charCount} characters`;
            return `<section class="item">
  <h2>${index + 1}. ${heading}</h2>
  <p class="count">${escapeHtml(count)}</p>
  <div class="content">${escapeHtml(item.content)}</div>
</section>`;
          })
          .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<style>
  @page { margin: 0.75in; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 12pt/1.45 Georgia, "Times New Roman", serif;
    color: #111;
    padding: 24px;
    max-width: 720px;
  }
  h1 { font-size: 20pt; letter-spacing: -0.02em; margin: 0 0 8px; }
  .meta { color: #333; font-size: 11pt; margin: 0 0 20px; }
  .item { margin: 0 0 22px; page-break-inside: avoid; }
  h2 { font-size: 13pt; margin: 0 0 4px; }
  .count { margin: 0 0 8px; color: #555; font-size: 10pt; }
  .content { white-space: pre-wrap; }
  .empty, .disclaimer { color: #333; font-size: 10pt; }
  .disclaimer { margin-top: 28px; border-top: 1px solid #ccc; padding-top: 10px; }
  @media print {
    body { padding: 0; }
    button, nav { display: none !important; }
  }
</style>
</head>
<body>
  <h1>${title}</h1>
  <p class="meta">${metaBits.join(" · ")}</p>
  ${itemHtml}
  ${notebookHtmlSection(input)}
  <p class="disclaimer">${escapeHtml(AWARD_EXPORT_DISCLAIMER)}</p>
</body>
</html>
`;
}

/**
 * Build the copy/print packet from a submission and its items.
 * Skips empty rows. Never attaches impact hours or other invented metrics.
 * Text-only notebook entries are refused as photo evidence.
 */
export function buildAwardExportPayload(input: {
  submission: AwardExportSubmissionInput;
  items: readonly AwardExportItemInput[];
  notebookEntries?: readonly AwardNotebookEntryInput[];
}): AwardExportPayload {
  const awardName = awardExportName(input.submission);
  const statusLabel = awardExportStatusLabel(input.submission.status);
  const eventKey =
    typeof input.submission.eventKey === "string" && input.submission.eventKey.trim()
      ? input.submission.eventKey.trim()
      : null;
  const deadline =
    typeof input.submission.deadline === "string" && input.submission.deadline.trim()
      ? input.submission.deadline.trim()
      : null;
  const items = realItems(input.items);
  const omittedEmptyCount = input.items.length - items.length;
  const notebook = selectAwardNotebookPhotoEvidence(input.notebookEntries);
  const fields = {
    awardName,
    seasonYear: input.submission.seasonYear,
    statusLabel,
    eventKey,
    deadline,
    items,
    notebookPhotoEvidence: notebook.photos,
    omittedTextOnlyNotebookCount: notebook.omittedTextOnlyCount,
  };

  return {
    submissionId: input.submission.id,
    awardName,
    seasonYear: input.submission.seasonYear,
    statusLabel,
    eventKey,
    deadline,
    items,
    omittedEmptyCount,
    notebookPhotoEvidence: notebook.photos,
    omittedTextOnlyNotebookCount: notebook.omittedTextOnlyCount,
    copyText: buildCopyText(fields),
    printableHtml: buildPrintableHtml(fields),
    fileStem: awardExportFileStem({
      awardName,
      seasonYear: input.submission.seasonYear,
      submissionId: input.submission.id,
    }),
  };
}

/** Payload keys a client may persist or download. Hours fields are intentionally absent. */
export const AWARD_EXPORT_PAYLOAD_KEYS = [
  "submissionId",
  "awardName",
  "seasonYear",
  "statusLabel",
  "eventKey",
  "deadline",
  "items",
  "omittedEmptyCount",
  "notebookPhotoEvidence",
  "omittedTextOnlyNotebookCount",
  "copyText",
  "printableHtml",
  "fileStem",
] as const;
