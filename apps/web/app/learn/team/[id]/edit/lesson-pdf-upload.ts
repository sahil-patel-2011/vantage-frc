"use client";

/**
 * Uploading a lesson PDF reuses Vantage Drive end to end, so the file lands in the team's
 * Files (folder "Team lessons") with the same routing, caps and honesty as any other upload:
 *
 *   1. /api/drive/upload/plan  — where would this go, and does it fit? (refused → say why)
 *   2. uploadOneFile()          — grant → bytes → finalize, exactly as Files does it
 *   3. the lesson's attach-pdf  — the server checks it is this team's ready PDF
 *
 * Steps 1–2 are the same calls app/files makes; nothing here stores bytes itself.
 */

import { uploadOneFile, type UploadItem } from "../../../../files/upload-queue";
import { formatDriveBytes } from "../../../../../lib/drive/validation";
import type { StoragePlanEntry } from "../../../../../lib/storage-routing/types";
import { lessonFetch } from "../../lesson-shared";

export type PdfUploadProgress = { label: string; fraction: number | null };

export function looksLikePdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

type PlanResponse = {
  cloudCapBytes?: number;
  entries?: StoragePlanEntry[];
  status?: string;
  reason?: string;
};

/** Returns the Drive file id of the uploaded PDF, or an error sentence. */
export async function uploadLessonPdf(input: {
  file: File;
  orgId: string;
  lessonId: string;
  onProgress: (progress: PdfUploadProgress) => void;
}): Promise<{ fileId: string } | { error: string }> {
  const { orgId, lessonId, onProgress } = input;
  if (!looksLikePdf(input.file)) return { error: "Choose a PDF file (.pdf)." };
  // Some systems hand the browser a PDF with no type; Files then could not preview it inline.
  const file = input.file.type === "application/pdf" ? input.file : new File([input.file], input.file.name, { type: "application/pdf" });

  onProgress({ label: "Checking where the file goes…", fraction: null });
  const plan = await lessonFetch<PlanResponse>("/api/drive/upload/plan", {
    method: "POST",
    body: JSON.stringify({ orgId, files: [{ name: file.name, contentType: file.type, byteSize: file.size }] }),
  });
  if (!plan.ok || !plan.data) return { error: plan.error ?? "Files couldn't be reached. Try again." };
  if (plan.data.status === "setup_required") return { error: plan.data.reason ?? "Files isn't set up for this team yet." };
  const decision = plan.data.entries?.[0]?.decision;
  if (!decision) return { error: "Files couldn't plan this upload. Try again." };
  if (decision.destination === "refused") {
    const cap = plan.data.cloudCapBytes ? ` Files takes up to ${formatDriveBytes(plan.data.cloudCapBytes)} here.` : "";
    return { error: `${decision.reason}${cap}` };
  }

  const folder = await lessonFetch<{ folderId: string | null }>(`/api/team-lessons/${lessonId}`, {
    method: "POST",
    body: JSON.stringify({ orgId, action: "pdf-folder" }),
  });
  const folderId = folder.ok ? (folder.data?.folderId ?? null) : null;

  let item: UploadItem = {
    id: `lesson-${lessonId}`,
    name: file.name,
    byteSize: file.size,
    phase: "hashing",
    progress: 0,
    routeLabel: "",
    reason: "",
    error: null,
    fileId: null,
  };
  await uploadOneFile(file, { orgId, scope: "team", folderId }, item, (patch) => {
    item = { ...item, ...patch };
    const percent = Math.round((item.progress ?? 0) * 100);
    if (item.phase === "hashing") onProgress({ label: `Reading the file… ${percent}%`, fraction: item.progress });
    else if (item.phase === "routing") onProgress({ label: "Starting the upload…", fraction: null });
    else if (item.phase === "sending") onProgress({ label: `Uploading… ${percent}%`, fraction: item.progress });
    else if (item.phase === "finishing") onProgress({ label: "Finishing…", fraction: 1 });
  });
  if (item.phase === "failed" || !item.fileId) return { error: item.error ?? "The upload didn't finish. Try again." };
  return { fileId: item.fileId };
}
