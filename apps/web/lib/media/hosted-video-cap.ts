/**
 * Honest video caps for the hosted cloud path vs a paired storage node.
 *
 * Hosted Vercel cannot accept 6–100 MB video: the function edge rejects
 * bodies above 4.5 MB with 413 before our code runs. The advertised cloud
 * cap is 4 MiB. Larger clips belong on a paired storage node (schema
 * ceiling 100 MB) or a YouTube link in the Match Video Index.
 */

import {
  DB_ROW_CAP_BYTES,
  VERCEL_SAFE_UPLOAD_BYTES,
  cloudUploadCapBytes,
  type CapEnv,
} from "../storage-routing/caps";

/** Cloud-path video cap. Always 4 MiB — never advertise 100 MB on Vercel. */
export const HOSTED_VIDEO_CAP_BYTES = VERCEL_SAFE_UPLOAD_BYTES;

/** Schema / paired-node ceiling for one video row (0483/0489 CHECKs). */
export const NODE_VIDEO_CAP_BYTES = DB_ROW_CAP_BYTES;

/**
 * What THIS deployment will accept for a video on the cloud (function) path.
 * 4 MiB on Vercel; the schema ceiling off it. Never above the platform limit.
 */
export function hostedVideoCapBytes(env: CapEnv = process.env as CapEnv): number {
  return Math.min(NODE_VIDEO_CAP_BYTES, cloudUploadCapBytes(env));
}

export function exceedsHostedVideoCap(byteSize: number, env: CapEnv = process.env as CapEnv): boolean {
  return Number.isFinite(byteSize) && byteSize > hostedVideoCapBytes(env);
}

function formatCapBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Over-cap sentence that names the real size and the real cloud cap — never 100 MB on Vercel. */
export function hostedVideoOversizeMessage(byteSize: number, env: CapEnv = process.env as CapEnv): string {
  const cap = hostedVideoCapBytes(env);
  return `Video is ${formatCapBytes(byteSize)} — over the ${formatCapBytes(cap)} cloud upload limit. Bigger videos belong on a paired storage node or a YouTube link in the Match Video Index.`;
}
