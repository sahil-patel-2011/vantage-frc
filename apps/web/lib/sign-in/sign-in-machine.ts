/**
 * Email-first sign-in flow model.
 *
 * One path: enter an email → we ask the server for a code → enter the code →
 * done. The same model drives the second-factor step, because `/signin?verify=1`
 * asks for the identical 6 digits from `/api/auth/email-2fa`.
 *
 * Every message here is derived from a real API outcome. Nothing invents a
 * delivery, an account, or a team.
 */

import {
  DEFAULT_CODE_TTL_SECONDS,
  DEFAULT_RESEND_COOLDOWN_SECONDS,
  normalizeSignInEmail,
  sanitizeCodeInput,
  secondsUntil,
  isCodeComplete,
} from "./otp-code";

export type SignInStep = "identity" | "code" | "done";

/**
 * `email-otp` is the first factor (Better Auth `/api/auth/sign-in/email-otp`).
 * `email-2fa` is the second factor (`/api/auth/email-2fa`), reached only when
 * the proxy bounces an authenticated session to `/signin?verify=1`.
 */
export type SignInChannel = "email-otp" | "email-2fa";

export type OtpFailureKind =
  | "wrong_code"
  | "expired"
  | "too_many_attempts"
  | "rate_limited"
  | "not_authorized"
  | "unavailable"
  | "network"
  | "unknown";

export type OtpFailure = {
  kind: OtpFailureKind;
  message: string;
  /** Leave the typed digits on screen so one wrong character can be fixed. */
  keepDigits: boolean;
  /** The digits on screen can never succeed — a fresh code is required. */
  needsNewCode: boolean;
  retryAfterSeconds?: number;
};

export type SignInFlowState = {
  step: SignInStep;
  channel: SignInChannel;
  /** Full address on the first factor; empty on the second (session-derived). */
  email: string;
  /** Masked address the server gave us for the second factor. */
  emailHint: string | null;
  code: string;
  failure: OtpFailure | null;
  notice: string | null;
  codeExpiresAt: number | null;
  resendAvailableAt: number | null;
  failedAttempts: number;
  destination: string | null;
};

export type SignInFlowEvent =
  | { type: "edit_email" }
  /** The session exists but still owes a second factor (`/signin?verify=1`). */
  | { type: "second_factor_required"; emailHint: string | null }
  | { type: "email_changed"; email: string }
  | {
      type: "code_sent";
      now: number;
      email?: string;
      emailHint?: string | null;
      expiresInSeconds?: number | null;
      cooldownSeconds?: number | null;
      resent?: boolean;
    }
  | { type: "send_failed"; failure: OtpFailure; now: number }
  | { type: "code_changed"; code: string }
  | { type: "code_failed"; failure: OtpFailure; now: number }
  | { type: "verified"; destination: string };

export function initialSignInState(input?: {
  channel?: SignInChannel;
  email?: string | null;
  emailHint?: string | null;
}): SignInFlowState {
  return {
    step: "identity",
    channel: input?.channel ?? "email-otp",
    email: normalizeSignInEmail(input?.email),
    emailHint: input?.emailHint ?? null,
    code: "",
    failure: null,
    notice: null,
    codeExpiresAt: null,
    resendAvailableAt: null,
    failedAttempts: 0,
    destination: null,
  };
}

function cooldownDeadline(now: number, seconds: number | null | undefined): number {
  const value = seconds == null || !Number.isFinite(seconds) ? DEFAULT_RESEND_COOLDOWN_SECONDS : seconds;
  return now + Math.max(0, value) * 1_000;
}

export function signInFlowReducer(
  state: SignInFlowState,
  event: SignInFlowEvent,
): SignInFlowState {
  switch (event.type) {
    case "email_changed":
      return {
        ...state,
        email: event.email,
        // A typo fix should not keep shouting the previous failure.
        failure: state.step === "identity" ? null : state.failure,
      };

    case "second_factor_required":
      return {
        ...state,
        channel: "email-2fa",
        // The address is session-derived from here on; only the mask is ours.
        email: "",
        emailHint: event.emailHint,
        code: "",
        failure: null,
        failedAttempts: 0,
      };

    case "edit_email":
      // On the second factor the address comes from the session, so there is
      // nothing to edit — switching accounts means signing out.
      if (state.channel === "email-2fa") return state;
      return {
        ...state,
        step: "identity",
        code: "",
        failure: null,
        notice: null,
        codeExpiresAt: null,
        resendAvailableAt: null,
        failedAttempts: 0,
      };

    case "code_sent": {
      const ttl =
        event.expiresInSeconds == null || !Number.isFinite(event.expiresInSeconds)
          ? DEFAULT_CODE_TTL_SECONDS
          : Math.max(30, event.expiresInSeconds);
      return {
        ...state,
        step: "code",
        email: event.email != null ? normalizeSignInEmail(event.email) : state.email,
        emailHint: event.emailHint !== undefined ? event.emailHint : state.emailHint,
        code: "",
        failure: null,
        notice: event.resent
          ? "A new code is on the way. The previous one no longer works."
          : state.channel === "email-otp"
            ? // `send-verification-otp` answers 200 for every address so it cannot
              // leak who has an account — so promise delivery only conditionally.
              "If that address belongs to a team, a 6-digit code is on the way."
            : "Enter the 6-digit code we emailed you to finish signing in.",
        codeExpiresAt: event.now + ttl * 1_000,
        resendAvailableAt: cooldownDeadline(event.now, event.cooldownSeconds),
        failedAttempts: 0,
      };
    }

    case "send_failed":
      return {
        ...state,
        failure: event.failure,
        notice: null,
        resendAvailableAt:
          event.failure.retryAfterSeconds != null
            ? cooldownDeadline(event.now, event.failure.retryAfterSeconds)
            : state.resendAvailableAt,
      };

    case "code_changed": {
      const code = sanitizeCodeInput(event.code);
      return {
        ...state,
        code,
        // Editing after a wrong code clears the error; an expired or locked
        // code stays flagged because retyping cannot rescue it.
        failure: state.failure && !state.failure.needsNewCode ? null : state.failure,
      };
    }

    case "code_failed":
      return {
        ...state,
        failedAttempts: state.failedAttempts + 1,
        failure: event.failure,
        notice: null,
        code: event.failure.keepDigits ? state.code : "",
        codeExpiresAt: event.failure.needsNewCode ? event.now : state.codeExpiresAt,
        resendAvailableAt:
          event.failure.retryAfterSeconds != null
            ? cooldownDeadline(event.now, event.failure.retryAfterSeconds)
            : // A dead code should be replaceable immediately.
              event.failure.needsNewCode
              ? null
              : state.resendAvailableAt,
      };

    case "verified":
      return { ...state, step: "done", failure: null, destination: event.destination };

    default:
      return state;
  }
}

/* ---------------------------------- selectors --------------------------------- */

export function codeSecondsRemaining(state: SignInFlowState, now: number): number {
  return secondsUntil(state.codeExpiresAt, now);
}

export function resendSecondsRemaining(state: SignInFlowState, now: number): number {
  return secondsUntil(state.resendAvailableAt, now);
}

export function isCodeExpired(state: SignInFlowState, now: number): boolean {
  if (state.failure?.needsNewCode) return true;
  return Boolean(state.codeExpiresAt) && codeSecondsRemaining(state, now) === 0;
}

export function canResendCode(state: SignInFlowState, now: number): boolean {
  return state.step === "code" && resendSecondsRemaining(state, now) === 0;
}

export function canSubmitCode(state: SignInFlowState, now: number): boolean {
  return state.step === "code" && isCodeComplete(state.code) && !isCodeExpired(state, now);
}

/**
 * Card title + sub for the current step. The invite headline, when we have one,
 * replaces the generic title so the team stays named the whole way through
 * instead of only on `/invite`.
 */
export function signInStepCopy(
  state: Pick<SignInFlowState, "step" | "channel" | "email" | "emailHint">,
  inviteHeadline?: string | null,
): { title: string; sub: string } {
  const invite = inviteHeadline?.trim() || null;
  if (state.step === "code") {
    const target =
      state.channel === "email-2fa" ? state.emailHint : state.email || state.emailHint;
    return {
      title: invite ?? "Check your email",
      sub: target ? `Enter the 6-digit code sent to ${target}.` : "Enter the 6-digit code we sent.",
    };
  }
  if (state.channel === "email-2fa") {
    return {
      title: invite ?? "One more step",
      sub: "Confirm this sign-in with a code sent to your email.",
    };
  }
  return {
    title: invite ?? "Sign in",
    sub: invite
      ? "Sign in with the address the invite was sent to, then accept."
      : "Use your team email — we’ll send a 6-digit code.",
  };
}

/* ------------------------------- classification ------------------------------- */

type FailureInput = {
  channel: SignInChannel;
  /** HTTP status; omit for a thrown fetch (offline, DNS, aborted). */
  status?: number | null;
  /** Better Auth error code — `INVALID_OTP`, `OTP_EXPIRED`, `TOO_MANY_ATTEMPTS`. */
  code?: string | null;
  message?: string | null;
  retryAfterSeconds?: number | null;
  /** True when `fetch` itself rejected rather than returning a response. */
  networkError?: boolean;
};

const WRONG_CODE_MESSAGE = "That code doesn’t match. Check the six digits and try again.";
const EXPIRED_MESSAGE = "That code expired. Send a new one to continue.";
const LOCKED_MESSAGE = "Too many attempts on that code. Send a new one to continue.";
const NETWORK_MESSAGE =
  "Couldn’t reach Vantage. Check your connection — your code is still here when you retry.";

/**
 * Turn one API outcome into a state the UI can be honest about.
 *
 * The distinction that matters most: "wrong code" keeps the digits and lets the
 * user fix a typo, while "expired" / "too many attempts" tell them the code on
 * screen is dead no matter what they type.
 */
export function classifyOtpFailure(input: FailureInput): OtpFailure {
  const text = `${input.code ?? ""} ${input.message ?? ""}`.trim();

  if (input.networkError || input.status == null || input.status === 0) {
    return { kind: "network", message: NETWORK_MESSAGE, keepDigits: true, needsNewCode: false };
  }

  if (input.status === 429) {
    const retryAfterSeconds = input.retryAfterSeconds ?? DEFAULT_RESEND_COOLDOWN_SECONDS;
    return {
      kind: "rate_limited",
      message: "Too many requests. Wait for the timer, then try again.",
      keepDigits: true,
      needsNewCode: false,
      retryAfterSeconds,
    };
  }

  if (/OTP_EXPIRED|expired/i.test(text)) {
    return { kind: "expired", message: EXPIRED_MESSAGE, keepDigits: true, needsNewCode: true };
  }

  if (/TOO_MANY_ATTEMPTS|too many attempts/i.test(text)) {
    return { kind: "too_many_attempts", message: LOCKED_MESSAGE, keepDigits: false, needsNewCode: true };
  }

  if (/INVALID_OTP|invalid otp|incorrect/i.test(text)) {
    return { kind: "wrong_code", message: WRONG_CODE_MESSAGE, keepDigits: true, needsNewCode: false };
  }

  if (input.status === 401 || input.status === 403 || /unauthorized|forbidden/i.test(text)) {
    return {
      kind: "not_authorized",
      message: "That sign-in isn’t authorized. Start again from your email.",
      keepDigits: false,
      needsNewCode: true,
    };
  }

  if (/unavailable|not configured|RESEND|AUTH_EMAIL_FROM|DATABASE_/i.test(text)) {
    return {
      kind: "unavailable",
      message:
        "Email codes are unavailable right now — the mail provider isn’t reachable. Nothing was sent.",
      keepDigits: true,
      needsNewCode: false,
    };
  }

  // A 400 on the code step is Better Auth's generic OTP rejection.
  if (input.status === 400) {
    return { kind: "wrong_code", message: WRONG_CODE_MESSAGE, keepDigits: true, needsNewCode: false };
  }

  return {
    kind: "unknown",
    message: input.message?.trim() || "That didn’t work. Try again.",
    keepDigits: true,
    needsNewCode: false,
  };
}

/**
 * Why a correct-looking email never receives a code.
 *
 * `send-verification-otp` answers 200 for every address (it refuses to leak who
 * has an account), and `disableSignUp` then makes sign-in reject the code as
 * `INVALID_OTP`. After a couple of failures on the first factor that silence is
 * the likeliest explanation, so say it plainly instead of repeating "wrong code".
 */
export function invitedOnlyHint(state: SignInFlowState): string | null {
  if (state.channel !== "email-otp") return null;
  if (state.failedAttempts < 2) return null;
  if (state.failure?.kind !== "wrong_code" && state.failure?.kind !== "expired") return null;
  return "No code in your inbox? Vantage access is invite-only — codes are sent only to addresses a team owner has already invited. Join the waitlist and a team can add you.";
}

/* -------------------------------- destinations -------------------------------- */

/** `/invite?token=…` for a token, blank-safe. */
export function inviteReturnPath(token: string | null | undefined): string {
  const value = token?.trim() ?? "";
  return value ? `/invite?token=${encodeURIComponent(value)}` : "/invite";
}

/**
 * Pull the invite token out of a `next=` path so the sign-in card can name the
 * team the whole way through, and so we can put the user back on the acceptance
 * screen instead of a dashboard.
 */
export function inviteTokenFromNext(nextPath: string | null | undefined): string | null {
  const value = nextPath?.trim() ?? "";
  if (!value.startsWith("/")) return null;
  try {
    const parsed = new URL(value, "https://vantage.invalid");
    if (parsed.pathname !== "/invite") return null;
    const token = parsed.searchParams.get("token")?.trim() ?? "";
    return token || null;
  } catch {
    return null;
  }
}

export type OnboardingGateSnapshot = {
  complete?: boolean;
  accessStatus?: string;
} | null;

/**
 * Where to land after the last factor clears.
 *
 * An invite in flight always wins. `proxy.ts` lets `/invite` through before
 * onboarding completes and before workspace approval, so sending a freshly
 * invited user to `/onboarding` (or worse, `/dashboard`) is exactly the
 * drop-through that leaves the invite unaccepted.
 */
export function postAuthDestination(input: {
  nextPath: string;
  gate: OnboardingGateSnapshot;
  inviteToken?: string | null;
}): string {
  const inviteToken = input.inviteToken?.trim() || inviteTokenFromNext(input.nextPath);
  if (inviteToken) return inviteReturnPath(inviteToken);

  const next = input.nextPath || "/dashboard";
  if (!input.gate) return next;
  if (input.gate.complete && input.gate.accessStatus === "approved") return next;
  return `/onboarding?next=${encodeURIComponent(next)}`;
}

/**
 * `proxy.ts` builds its second-factor bounce from `pathname` alone, so
 * `/invite?token=…` arrives back as `next=/invite` with the token gone. When we
 * still hold the token (the invite page stashed it, or it was in the URL), put
 * it back rather than dumping the user on a tokenless invite screen.
 */
export function restoreInviteNextPath(
  nextPath: string | null | undefined,
  storedToken: string | null | undefined,
): string {
  const value = nextPath?.trim() || "/dashboard";
  const token = storedToken?.trim() ?? "";
  if (!token) return value;
  if (inviteTokenFromNext(value)) return value;
  if (value === "/invite" || value === "/invite/") return inviteReturnPath(token);
  return value;
}
