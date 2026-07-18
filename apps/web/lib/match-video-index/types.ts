// Match Video Index domain types. Pure data shapes — no I/O, no framework imports.
// Auto-indexes match videos by match key so a team can jump straight to the clip for a
// given qualification/playoff match instead of hunting through a shared drive or channel.

export type MatchVideoSource = "youtube" | "drive" | "twitch" | "local" | "other";

export type MatchVideoEntry = {
  id: string;
  matchKey: string;
  eventKey: string | null;
  matchLabel: string | null;
  videoUrl: string;
  source: MatchVideoSource;
  recordedOn: string | null;
  notes: string | null;
  tags: string[];
  createdAt: string;
};

export type MatchVideoGroup = {
  matchKey: string;
  matchLabel: string | null;
  eventKey: string | null;
  videos: MatchVideoEntry[];
};

export type MatchVideoIndexSummary = {
  totalVideos: number;
  totalMatches: number;
  bySource: Array<{ source: MatchVideoSource; count: number }>;
  latestAddedAt: string | null;
};
