/**
 * An error string as a team may read it. Worker and sync errors are stored as they were
 * thrown, and older ones named server settings (env variable names, the hosting dashboard)
 * that teams never see and cannot change. Those become a plain next step; anything else
 * passes through.
 */
const PLUMBING = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|Environment Variables|Vercel|deployment environment|redeploy/;

export function teamFacingError(message: string | null | undefined, fallback: string): string {
  const text = (message ?? "").trim();
  if (!text) return fallback;
  if (/Blue Alliance|TBA/i.test(text) && PLUMBING.test(text)) {
    return "Match data isn't connected yet. An owner can connect it on Team → Data";
  }
  return PLUMBING.test(text) ? fallback : text;
}
