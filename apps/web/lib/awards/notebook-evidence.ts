/**
 * Awards workbench / export gate for notebook photo evidence.
 *
 * Notebook entries now carry `hasImageEvidence`. A write-up — even one that
 * embeds `![photo](url)` markdown — is not a judged photo. Only the API flag
 * (resolved media-kit image rows) counts. This helper is the only place the
 * awards packet decides that, so export cannot treat a text journal as imagery.
 * Missing photos stay omitted; nothing is invented.
 */

import { isResolvedNotebookImage } from "../notebook/attachments";

export const AWARD_NOTEBOOK_TEXT_ONLY_REFUSAL =
  "Text-only notebook entries are not photo evidence.";

export type AwardNotebookEntryInput = {
  id: string;
  title?: string | null;
  body?: string | null;
  hasImageEvidence?: boolean | null;
  attachments?: readonly AwardNotebookAttachmentInput[] | null;
};

export type AwardNotebookAttachmentInput = {
  url?: string | null;
  kind?: string | null;
  title?: string | null;
};

export type AwardNotebookPhoto = {
  title: string;
  url: string;
  kind: string;
};

export type AwardNotebookPhotoCite = {
  id: string;
  title: string;
  photos: AwardNotebookPhoto[];
};

export type AwardNotebookEvidenceSelection = {
  photos: AwardNotebookPhotoCite[];
  omittedTextOnlyCount: number;
};

/**
 * True only when the notebook already flagged a resolved image.
 * Body text, markdown images, and a missing/false flag never count.
 */
export function isAwardNotebookPhotoEvidence(entry: AwardNotebookEntryInput): boolean {
  return entry.hasImageEvidence === true;
}

function resolvedAwardNotebookPhotos(
  attachments: AwardNotebookEntryInput["attachments"],
): AwardNotebookPhoto[] {
  const photos: AwardNotebookPhoto[] = [];
  for (const attachment of attachments ?? []) {
    if (!attachment) continue;
    const url = typeof attachment.url === "string" ? attachment.url.trim() : "";
    const kind = typeof attachment.kind === "string" ? attachment.kind.trim() : "";
    if (!isResolvedNotebookImage({ url, kind })) continue;
    const title =
      typeof attachment.title === "string" && attachment.title.trim()
        ? attachment.title.trim()
        : "Notebook photo";
    photos.push({ title, url, kind });
  }
  return photos;
}

export function citeAwardNotebookPhotoEvidence(
  entry: AwardNotebookEntryInput,
): AwardNotebookPhotoCite | null {
  if (!isAwardNotebookPhotoEvidence(entry)) return null;
  const title = typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : "Notebook entry";
  return {
    id: entry.id,
    title,
    photos: resolvedAwardNotebookPhotos(entry.attachments),
  };
}

/** Keep photo-backed entries; refuse text-only write-ups as award imagery. */
export function selectAwardNotebookPhotoEvidence(
  entries: readonly AwardNotebookEntryInput[] | null | undefined,
): AwardNotebookEvidenceSelection {
  const photos: AwardNotebookPhotoCite[] = [];
  let omittedTextOnlyCount = 0;
  for (const entry of entries ?? []) {
    const cite = citeAwardNotebookPhotoEvidence(entry);
    if (cite) {
      photos.push(cite);
    } else {
      omittedTextOnlyCount += 1;
    }
  }
  return { photos, omittedTextOnlyCount };
}
