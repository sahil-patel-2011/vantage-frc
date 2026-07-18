export type TrackSource = "welcome" | "role" | "focus" | "subteam" | "manual";

export type OnboardingCheckTemplate = {
  key: string;
  label: string;
  detail: string;
  href?: string;
};

export type OnboardingTrackTemplate = {
  key: string;
  title: string;
  summary: string;
  source: TrackSource;
  checks: OnboardingCheckTemplate[];
};

export type AssignedTrack = {
  trackKey: string;
  source: TrackSource;
  reason: string;
};

export type AssignInput = {
  teamRole: string | null | undefined;
  primaryFocus: string | null | undefined;
  subteamNames: string[];
};

export type StartCheckView = {
  key: string;
  label: string;
  detail: string;
  href: string | null;
  done: boolean;
  completedAt: string | null;
};

export type StartTrackView = {
  key: string;
  title: string;
  summary: string;
  source: TrackSource;
  reason: string;
  dismissed: boolean;
  doneCount: number;
  totalCount: number;
  checks: StartCheckView[];
};

export type RoleOnboardingView =
  | {
      status: "setup_required";
      message: string;
    }
  | {
      status: "live";
      orgId: string;
      orgName: string;
      teamRole: string | null;
      primaryFocus: string | null;
      subteamNames: string[];
      doneCount: number;
      totalCount: number;
      tracks: StartTrackView[];
    };
