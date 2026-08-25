/**
 * Why a surface failed to load, and what the member can actually do about it.
 *
 * Every failing panel used to offer the same "Retry" button. Retry cannot fix
 * an expired session — a tablet left signed in overnight in the pit comes back
 * to "Could not load calendar / Authentication required / Retry" and no amount
 * of retrying helps. Classifying the failure lets each state offer the one
 * action that resolves it.
 */

export type LoadFailureKind = "auth" | "forbidden" | "offline" | "setup" | "unknown";

export type LoadFailureCopy = {
  kind: LoadFailureKind;
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
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 503) return "setup";

  const text = (input.message ?? "").toLowerCase();
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
        title: "Your session ended",
        description: "Sign in again to pick up where you left off. Nothing you saved is lost.",
        primary: { label: "Sign in again", href: signInHref(options.nextPath) },
        showRetry: false,
      };
    case "forbidden":
      return {
        kind,
        title: "You don't have access to this",
        description:
          "Your team role does not include this section. An owner or admin can change it under Security.",
        primary: { label: "Back to Home", href: "/dashboard" },
        showRetry: false,
      };
    case "offline":
      return {
        kind,
        title: "You're offline",
        description:
          "This screen needs a connection. Anything you have already queued will sync once you reconnect.",
        showRetry: true,
      };
    case "setup":
      return {
        kind,
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
        title: "Something went wrong",
        description: options.message?.trim() || "That did not load. Try again in a moment.",
        showRetry: true,
      };
  }
}
