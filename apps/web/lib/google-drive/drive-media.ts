/**
 * The team's photos and videos, kept in its own Google Drive through the same Apps Script
 * that keeps its spreadsheet (lib/google-sheets/apps-script-source.ts, version 2+).
 *
 * Vantage stores nothing about the folder: the script remembers it, so connecting,
 * listing and testing are each one signed call. Files are added in Drive itself (any size,
 * straight from a phone); Vantage tiles what is there, with the small thumbnails Drive
 * already makes, so no media ever passes through or is stored by Vantage.
 */

import type { AppsScriptBridge } from "../google-sheets/apps-script-bridge";
import { APPS_SCRIPT_DRIVE_VERSION } from "../google-sheets/apps-script-source";
import { GoogleSheetsError } from "../google-sheets/google-api";

export type DriveFolderRef = { id: string; name: string; url: string };

export type DriveMediaFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  updated: string;
  url: string;
  /** A data: URL Drive made, or null (not an image/video, or Drive has not made one yet). */
  thumb: string | null;
};

export type DriveMediaFolder = {
  key: string;
  name: string;
  id: string | null;
  url: string | null;
  files: DriveMediaFile[];
  more: boolean;
};

export type DriveMediaListing = { root: DriveFolderRef | null; shared: boolean; folders: DriveMediaFolder[] };

export type DriveTestStep = { step: string; ok: boolean; detail?: string };

/** The script's version, and a plain message when it predates photos and videos. */
export async function requireDriveScript(bridge: AppsScriptBridge): Promise<void> {
  const ping = await bridge.ping();
  if (ping.version < APPS_SCRIPT_DRIVE_VERSION) {
    const message =
      "Your Google script is an older version without photos and videos. Copy the new script from Connectors, paste it over the old one, then Deploy → Manage deployments → Edit → New version.";
    throw new GoogleSheetsError("bad_request", message, null, "old_version", null, message);
  }
}

/** Accepts a Drive folder link or a bare folder id; returns the id, "" for none, null if unusable. */
export function driveFolderIdFrom(input: unknown): string | null {
  const text = typeof input === "string" ? input.trim() : "";
  if (!text) return "";
  const fromUrl = /\/folders\/([A-Za-z0-9_-]{10,200})/.exec(text)?.[1] ?? /[?&]id=([A-Za-z0-9_-]{10,200})/.exec(text)?.[1];
  if (fromUrl) return fromUrl;
  return /^[A-Za-z0-9_-]{10,200}$/.test(text) ? text : null;
}

export async function setUpDriveMedia(
  bridge: AppsScriptBridge,
  input: { team: string; rootId: string; shareWithLink: boolean | null },
): Promise<{ root: DriveFolderRef; folders: Array<{ key: string; name: string; id: string; url: string }> }> {
  await requireDriveScript(bridge);
  const data = await bridge.call<{
    ok: boolean;
    root: DriveFolderRef;
    folders: Array<{ key: string; name: string; id: string; url: string }>;
  }>("drive.setup", {
    team: input.team.slice(0, 80),
    rootId: input.rootId,
    ...(input.shareWithLink === null ? {} : { shareWithLink: input.shareWithLink }),
  });
  return { root: data.root, folders: data.folders ?? [] };
}

export async function listDriveMedia(bridge: AppsScriptBridge, input: { limit?: number } = {}): Promise<DriveMediaListing> {
  await requireDriveScript(bridge);
  const data = await bridge.call<{ ok: boolean } & DriveMediaListing>("drive.list", { limit: input.limit ?? 60 });
  return { root: data.root ?? null, shared: Boolean(data.shared), folders: data.folders ?? [] };
}

export async function testDriveMedia(bridge: AppsScriptBridge): Promise<{ passed: boolean; steps: DriveTestStep[] }> {
  const steps: DriveTestStep[] = [];
  try {
    await requireDriveScript(bridge);
    steps.push({ step: "Reach your Google script", ok: true, detail: "It answered and accepted Vantage's signature" });
  } catch (error) {
    steps.push({ step: "Reach your Google script", ok: false, detail: error instanceof GoogleSheetsError ? error.publicMessage ?? error.message : "No answer" });
    return { passed: false, steps };
  }
  const data = await bridge.call<{ ok: boolean; passed: boolean; steps: DriveTestStep[] }>("drive.test");
  steps.push(...(data.steps ?? []));
  return { passed: steps.every((step) => step.ok), steps };
}
