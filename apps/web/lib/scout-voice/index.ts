export * from "./types";

/** Bump when privacy/consent copy changes — forces org + user re-acceptance. */
export const SCOUT_VOICE_CONSENT_VERSION = "2026-07-18-form";

export const SCOUT_VOICE_STT_FEATURE = "scout_voice_stt";

export const SCOUT_VOICE_CONSENT_COPY = {
  title: "Voice notes privacy consent",
  summary:
    "Voice notes record conversation near the scout while an entry is open. Transcripts are stored with your team workspace and can optionally fill custom form fields when you choose Apply to form. Audio queues in the offline outbox until sync returns.",
  bullets: [
    "Only enable when people who may be recorded have consented (teammates, pit visitors, mentors).",
    "Audio may be kept with the note for audit; cloud speech-to-text sends audio to a configured STT provider and is metered as AI usage.",
    "Browser speech recognition (when available) stays on-device for the transcript step and is not metered as AI.",
    "Apply to form is explicit — labeled speech can fill published custom form fields; robot-image fields stay upload-only.",
    "Owners/admins opt the organization in; each scout also opts in for their own device before recording.",
    "You can turn voice notes off at any time; existing notes remain until deleted by an author or admin.",
  ],
  acceptLabel: "I understand and consent to voice recording for scouting notes",
} as const;

export function isScoutVoiceConsentCurrent(ackVersion: string | null | undefined): boolean {
  return Boolean(ackVersion) && ackVersion === SCOUT_VOICE_CONSENT_VERSION;
}

export function isScoutVoiceFullyEnabled(input: {
  orgEnabled: boolean;
  orgAckVersion: string | null;
  userEnabled: boolean;
  userAckVersion: string | null;
}): boolean {
  return (
    input.orgEnabled &&
    isScoutVoiceConsentCurrent(input.orgAckVersion) &&
    input.userEnabled &&
    isScoutVoiceConsentCurrent(input.userAckVersion)
  );
}

/** Rough Whisper-class estimate: ~$0.006 / minute of audio. */
export function estimateCloudSttCostUsd(byteSize: number, contentType?: string | null): number {
  // Assume ~16 kbps for webm/opus voice; floor at 5 seconds.
  const bytesPerSecond = contentType?.includes("wav") ? 32_000 : 2_000;
  const seconds = Math.max(5, byteSize / bytesPerSecond);
  const minutes = seconds / 60;
  return Math.round(minutes * 0.006 * 10_000) / 10_000;
}
