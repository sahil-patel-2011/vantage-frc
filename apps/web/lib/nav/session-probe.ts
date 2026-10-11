/**
 * Who is signed in, asked of the auth route every page may call.
 *
 * `/api/me` answers a signed-out visitor with 401 and someone mid-onboarding with 403, and the
 * browser prints each as a console error: public and entry pages (sign-in, invite, join by code,
 * onboarding) were firing several of those per load just to learn "is anyone here, and who".
 * `/api/auth/get-session` answers 200 either way (null when signed out), so pages that only need
 * that ask it instead. One request per few seconds, shared by every caller.
 */
export type SessionUser = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
};

const FRESH_MS = 5_000;
let entry: { at: number; promise: Promise<SessionUser | null | undefined> } | null = null;

type SessionBody = { user?: { id?: unknown; email?: unknown; name?: unknown; image?: unknown } | null } | null;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** `null`: nobody is signed in. `undefined`: could not tell (offline, timeout, server error). */
export function probeSessionUser(): Promise<SessionUser | null | undefined> {
  const now = Date.now();
  if (entry && now - entry.at < FRESH_MS) return entry.promise;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve(undefined);
  const promise = fetch("/api/auth/get-session", { cache: "no-store", signal: AbortSignal.timeout(8_000) })
    .then(async (response) => (response.ok ? ((await response.json().catch(() => undefined)) as SessionBody | undefined) : undefined))
    .then((body): SessionUser | null | undefined => {
      if (body === undefined) return undefined;
      const id = text(body?.user?.id);
      if (!id) return null;
      return { id, email: text(body?.user?.email), name: text(body?.user?.name), image: text(body?.user?.image) };
    })
    .catch(() => undefined);
  entry = { at: now, promise };
  // An unanswered probe is not kept: the next caller asks again.
  void promise.then((user) => {
    if (user === undefined && entry?.promise === promise) entry = null;
  });
  return promise;
}

/** For tests, and after signing in or out. */
export function forgetSessionProbe(): void {
  entry = null;
}
