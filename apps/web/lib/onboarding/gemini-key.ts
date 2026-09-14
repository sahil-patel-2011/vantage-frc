/** Team 6925 uses the platform Gemini key. Every other number needs its own. */
const PLATFORM_GEMINI_TEAM = 6925;

export function onboardingAsksForGeminiKey(input: {
  isTeamHead: boolean;
  teamNumber: number | null | undefined;
}): boolean {
  if (!input.isTeamHead) return false;
  if (input.teamNumber == null || !Number.isFinite(Number(input.teamNumber))) return false;
  return Number(input.teamNumber) !== PLATFORM_GEMINI_TEAM;
}

export function looksLikeGeminiApiKey(value: string): boolean {
  const key = value.trim();
  if (key.length < 20 || key.length > 200) return false;
  if (key.startsWith("AIza") || key.startsWith("AQ.")) return true;
  return /^[A-Za-z0-9_-]{32,}$/.test(key);
}
