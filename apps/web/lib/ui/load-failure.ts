/**
 * Why a surface failed to load, and what the member can actually do about it.
 *
 * Every failing panel used to offer the same "Retry" button. Retry cannot fix
 * an expired session — a tablet left signed in overnight in the pit comes back
 * to "Could not load calendar / Authentication required / Retry" and no amount
 * of retrying helps. Classifying the failure lets each state offer the one
 * action that resolves it.
 */

export type LoadFailureKind = "auth" | "reauth" | "forbidden" | "offline" | "setup" | "unknown";

export type LoadFailureCopy = {
  kind: LoadFailureKind;
  /**
   * The word in the chip above the title.
   *
   * Surfaces derived this from their own loading state, which could not tell
   * these apart: a session that needs signing in again was chipped
   * "Unavailable", the loudest and least true word on the screen — the feature
   * is available, the sign-in is not. It belongs with the rest of the copy.
   */
  badge: string;
  title: string;
  description: string;
  /** The action that actually resolves this failure, when one exists. */
  primary?: { label: string; href: string };
  /** Retry only where retrying could plausibly succeed. */
  showRetry: boolean;
};

const AUTH_PATTERNS = [
  "authentication required",
  "unauthenticated",
  "not signed in",
  "session expired",
  "sign in required",
  "unauthorized",
];

const FORBIDDEN_PATTERNS = [
  "forbidden",
  "not a member",
  "access denied",
  "insufficient role",
  "permission",
  // assertOrgCapability and requireOrgAdmin say this, and several routes
  // still answer 400 for it. The words are the role check.
  "administrator access",
];

/**
 * A 403 that is about *how you signed in*, not about who you are.
 *
 * An organization can require a particular sign-in method, 2FA enrolment, or a
 * step-up check. All three answer 403, and a 403 used to mean one thing to the
 * UI: "your team role does not include this section." So an **owner** — whose
 * role includes everything — was told their role was the problem, pointed at a
 * Security page that would show nothing wrong, and left with no way forward.
 *
 * These are checked before the role patterns and before the bare status,
 * because the message is the only thing that distinguishes them and getting it
 * wrong strands the one person who could have fixed it.
 */
const REAUTH_PATTERNS = [
  // The wording `packages/core/src/mfa.ts` produces today.
  "the way you signed in",
  "sign in again with",
  "authenticator-app",
  "authenticator verification",
  // Earlier wording, kept so a cached response or an older deployment still
  // classifies correctly.
  "re-authenticate",
  "reauthenticate",
  "sign-in method",
  "sign in method",
  "2fa enrollment",
  "2fa enrolment",
];

const SETUP_PATTERNS = ["setup_required", "setup required", "not configured", "configure"];

function matches(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * Classify from whatever the caller has. `status` is authoritative when given;
 * otherwise the API's own message text is used, so surfaces that only kept the
 * message string still get the right recovery action.
 */
export function classifyLoadFailure(input: {
  status?: number | null;
  message?: string | null;
  online?: boolean;
}): LoadFailureKind {
  if (input.online === false) return "offline";

  const status = input.status ?? null;
  const text = (input.message ?? "").toLowerCase();

  // Checked before the status, because a 403 about sign-in method and a 403
  // about role are the same status and opposite advice.
  if (text && matches(text, REAUTH_PATTERNS)) return "reauth";

  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 503) return "setup";

  if (!text) return "unknown";
  // "Unauthorized" is HTTP 401's own reason phrase, so it means signed-out here,
  // while the role words below mean signed-in-but-not-allowed.
  if (matches(text, FORBIDDEN_PATTERNS)) return "forbidden";
  if (matches(text, AUTH_PATTERNS)) return "auth";
  if (matches(text, SETUP_PATTERNS)) return "setup";
  return "unknown";
}

/**
 * Where to send someone after they sign back in.
 *
 * Only same-origin paths are carried through: a leading `//` or `/\` is
 * protocol-relative and would send them off-site, so those are dropped.
 */
export function signInHref(nextPath?: string | null): string {
  const candidate = nextPath ?? "";
  const sameOrigin =
    candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.startsWith("/\\");
  return sameOrigin ? `/signin?next=${encodeURIComponent(candidate)}` : "/signin";
}

export function loadFailureCopy(
  kind: LoadFailureKind,
  options: { nextPath?: string | null; message?: string | null } = {},
): LoadFailureCopy {
  switch (kind) {
    case "auth":
      return {
        kind,
        badge: "Signed out",
        title: "Your session ended",
        description: "Sign in again to pick up where you left off. Nothing you saved is lost.",
        primary: { label: "Sign in again", href: signInHref(options.nextPath) },
        showRetry: false,
      };
    case "reauth":
      return {
        kind,
        badge: "Sign in again",
        title: "Sign in again to open this",
        // The API's own sentence is the specific one — which method, or which
        // 2FA step. Repeating it beats a generic line that sends an owner to
        // look for a role problem that is not there.
        description:
          options.message?.trim() ||
          "Your team requires a different sign-in method for this section. Sign in again to continue.",
        primary: { label: "Sign in again", href: signInHref(options.nextPath) },
        showRetry: false,
      };
    case "forbidden":
      return {
        kind,
        badge: "No access",
        title: "You don't have access to this",
        description:
          "Your team role does not include this section. An owner or admin can change it under Security.",
        primary: { label: "Back to Home", href: "/dashboard" },
        showRetry: false,
      };
    case "offline":
      return {
        kind,
        badge: "Offline",
        title: "You're offline",
        description:
          "This screen needs a connection. Anything you have already queued will sync once you reconnect.",
        showRetry: true,
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Not set up yet",
        description:
          options.message?.trim() ||
          "This feature needs to be connected before it can show anything.",
        showRetry: true,
      };
    case "unknown":
    default:
      return {
        kind,
        badge: "Error",
        title: "Something went wrong",
        description: options.message?.trim() || "That did not load. Try again in a moment.",
        showRetry: true,
      };
  }
}

/**
 * The sentence the API sent with a failure, or null when it sent none.
 *
 * Routes in this app refuse requests with a specific reason — which sign-in
 * method this team allows, which integration is not connected, which cap was
 * hit. The screens then threw that away and substituted a house string like
 * "Could not load scouting", which `classifyLoadFailure` can only read as the
 * bare status. That is how an **owner**, refused a 403 for signing in with a
 * password their team does not allow, was told their *role* was insufficient
 * and sent to a Security page with nothing wrong on it.
 *
 * `clone()` so the caller can still read the body itself; a non-JSON or empty
 * body is a normal outcome here, not an error.
 */
export async function apiErrorMessage(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.clone().json();
    if (!body || typeof body !== "object") return null;
    const error = (body as { error?: unknown }).error;
    return typeof error === "string" && error.trim() ? error.trim() : null;
  } catch {
    return null;
  }
}
