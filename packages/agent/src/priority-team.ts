/**
 * Team 6925 uses Gemini only for product AI (platform GEMINI_API_KEY or a
 * Google BYOK row). Other teams bring their own free Gemini key, or a
 * Freebuff grant. There is no product toggle for the 6925 Gemini pin.
 */
export const PRIORITY_FREEBUFF_TEAM_NUMBER = 6925;

export function isPriorityFreebuffTeam(teamNumber: number | null | undefined): boolean {
  return Number(teamNumber) === PRIORITY_FREEBUFF_TEAM_NUMBER;
}

/** Hosted / BYOK chat for 6925 stays on Google Gemini — no OpenRouter, Groq, or Anthropic. */
export function isGeminiOnlyTeam(teamNumber: number | null | undefined): boolean {
  return isPriorityFreebuffTeam(teamNumber);
}

/** Team heads of every other FRC number collect a free Gemini key for basic AI. */
export function teamNeedsOwnGeminiKey(teamNumber: number | null | undefined): boolean {
  if (teamNumber == null || !Number.isFinite(Number(teamNumber))) return false;
  return !isGeminiOnlyTeam(teamNumber);
}
