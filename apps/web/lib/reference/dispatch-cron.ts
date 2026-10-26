/**
 * Ask a CRON_SECRET route to do worker work. The caller has already checked
 * the signed-in role. This module does not import the worker or an admin pool.
 */

export type CronDispatch<T> =
  | { ok: true; body: T }
  | { ok: false; pending: true; reason: "cron_unconfigured" | "cron_rejected" };

export type CronDispatchOptions = {
  fetchImpl?: typeof fetch;
  origin?: string;
};

export function internalCronOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.VANTAGE_INTERNAL_ORIGIN?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = env.VERCEL_URL?.trim();
  if (vercel) return (vercel.startsWith("http") ? vercel : `https://${vercel}`).replace(/\/$/, "");
  const port = env.PORT?.trim();
  if (env.NODE_ENV !== "production" && port && /^\d+$/.test(port)) return `http://127.0.0.1:${port}`;
  return "";
}

export async function dispatchCron<T>(
  path: string,
  body: unknown,
  options: CronDispatchOptions = {},
): Promise<CronDispatch<T>> {
  const secret = process.env.CRON_SECRET?.trim();
  const origin = (options.origin ?? internalCronOrigin()).replace(/\/$/, "");
  if (!secret || !origin) return { ok: false, pending: true, reason: "cron_unconfigured" };
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${origin}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, pending: true, reason: "cron_rejected" };
  }
  if (!response.ok) return { ok: false, pending: true, reason: "cron_rejected" };
  return { ok: true, body: (await response.json()) as T };
}
