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

type CapEnv = { VERCEL?: string; STORAGE_CLOUD_UPLOAD_CAP_BYTES?: string };

/**
 * The honest cloud upload cap for THIS deployment:
 * - explicit STORAGE_CLOUD_UPLOAD_CAP_BYTES override wins (clamped to the
 *   schema ceiling — the database CHECK is not negotiable),
 * - on Vercel (VERCEL env var set) the platform body limit governs,
 * - elsewhere (local dev, self-hosted Node) the schema ceiling governs.
 */
export function cloudUploadCapBytes(env: CapEnv = process.env as CapEnv): number {
  const override = Number(env.STORAGE_CLOUD_UPLOAD_CAP_BYTES);
  if (Number.isFinite(override) && override >= 1) {
    return Math.min(Math.floor(override), DB_ROW_CAP_BYTES);
  }
  return env.VERCEL ? VERCEL_SAFE_UPLOAD_BYTES : DB_ROW_CAP_BYTES;
}
