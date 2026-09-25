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
  /** Team membership role (owner/admin/scout/viewer). Owners and admins get the team-setup list. */
  orgRole?: string | null;
  teamRole: string | null | undefined;
  crewRole?: string | null;
  roleDescription?: string | null;
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
      /** owner / admin / scout / viewer: who can reach team setup and security. */
      orgRole?: string | null;
      teamRole: string | null;
      crewRole: string | null;
      roleDescription: string | null;
      primaryFocus: string | null;
      subteamNames: string[];
      doneCount: number;
      totalCount: number;
      tracks: StartTrackView[];
    };
