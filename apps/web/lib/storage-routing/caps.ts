/**
 * Honest upload caps for the CLOUD path (bytes stored as bytea in Postgres,
 * uploaded through a serverless function).
 *
 * Vercel's documented request-body limit for functions is 4.5 MB
 * (https://vercel.com/docs/functions/limitations#request-body-size — a larger
 * payload is rejected at the platform edge with 413 FUNCTION_PAYLOAD_TOO_LARGE
 * before our code runs). The database schema allows up to 100 MB per db row
 * (migrations 0483/0489), which a self-hosted or local deployment can accept —
 * but a Vercel deployment cannot, so advertising 100 MB there is a lie the
 * user only discovers at the end of an upload. These helpers make the
 * advertised cap match what the deployed platform actually honors; anything
 * larger belongs on a paired storage node.
 */

/** Vercel's documented request/response body limit for functions. */
export const VERCEL_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;

/**
 * The cap we advertise and enforce on Vercel: 4 MiB, safely under the 4.5 MB
 * platform rejection so headers/multipart overhead can never tip a "fits"
 * upload into a platform 413.
 */
export const VERCEL_SAFE_UPLOAD_BYTES = 4 * 1024 * 1024;

/** The database-schema ceiling for one db-stored file (0483/0489 CHECKs). */
export const DB_ROW_CAP_BYTES = 100 * 1024 * 1024;

export type CapEnv = { VERCEL?: string; STORAGE_CLOUD_UPLOAD_CAP_BYTES?: string };

/**
 * What this process can actually accept on the cloud (function) path.
 * On Vercel that is 4 MiB — never the 100 MB schema ceiling.
 */
export function platformUploadCeilingBytes(env: CapEnv = process.env as CapEnv): number {
  return env.VERCEL ? VERCEL_SAFE_UPLOAD_BYTES : DB_ROW_CAP_BYTES;
}

/**
 * The honest cloud upload cap for THIS deployment:
 * - on Vercel the platform body limit governs (4 MiB). An env override cannot
 *   raise that — advertising 6–100 MB there is a lie the edge answers with 413,
 * - elsewhere (local dev, self-hosted Node) the schema ceiling governs,
 * - STORAGE_CLOUD_UPLOAD_CAP_BYTES may lower the cap, never raise it past the
 *   platform ceiling.
 */
export function cloudUploadCapBytes(env: CapEnv = process.env as CapEnv): number {
  const ceiling = platformUploadCeilingBytes(env);
  const override = Number(env.STORAGE_CLOUD_UPLOAD_CAP_BYTES);
  if (Number.isFinite(override) && override >= 1) {
    return Math.min(Math.floor(override), ceiling);
  }
  return ceiling;
}
