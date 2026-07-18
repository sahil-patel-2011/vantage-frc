// Optional scouting voice notes: ambient recording → speech-to-text transcript
// attached to a scout entry. Transcripts never replace structured form fields.

export type ScoutVoiceSttSource = "browser" | "cloud" | "manual";

export type ScoutVoiceNote = {
  id: string;
  eventKey: string;
  matchKey: string | null;
  teamKey: string;
  entryType: "match" | "pit";
  entryClientId: string | null;
  entryId: string | null;
  mediaClientId: string | null;
  transcript: string;
  sttSource: ScoutVoiceSttSource;
  consentAckVersion: string;
  createdBy: string;
  createdAt: string;
};

export type ScoutVoiceOrgSettings = {
  enabled: boolean;
  consentAckVersion: string | null;
  acceptedAt: string | null;
  acceptedBy: string | null;
};

export type ScoutVoiceUserPrefs = {
  enabled: boolean;
  consentAckVersion: string | null;
  acceptedAt: string | null;
};

export type ScoutVoiceProviders = {
  /** Platform or org OpenAI-compatible key available for Whisper-style STT. */
  cloudConfigured: boolean;
  cloudProvider: "openai" | null;
};
