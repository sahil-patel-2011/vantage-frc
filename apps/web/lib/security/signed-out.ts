/**
 * The one sentence an API answers with a 401 when nobody is signed in. The proxy said
 * "Authentication required" and the routes said this, for the same state (QA A1-27); the UI maps
 * either through lib/ui/load-failure.ts ("session ended" is one of its sign-in patterns).
 */
export const SIGNED_OUT_MESSAGE = "Your session ended. Sign in again.";
