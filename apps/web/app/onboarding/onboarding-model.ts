import { PENDING_INVITE_STORAGE_KEY } from "../../lib/invite";
import type { FundingModel } from "../../lib/funding-profile";
import type {
  OnboardingCrew,
  OnboardingFocus,
  OnboardingGender,
  OnboardingRole,
  TeamAffiliationOption,
} from "../../lib/onboarding";

export type AccessStatus = "approved" | "invited" | "pending" | "declined" | "withdrawn" | "none";

export type OnboardingState = {
  userId?: string;
  complete: boolean;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  preferredTeamNumber: number | null;
  teamRole: string | null;
  crewRole: string | null;
  roleDescription: string | null;
  primaryFocus: OnboardingFocus;
  displayName: string | null;
  themePreference: "light" | "dark";
  lockedTeamNumber: number | null;
  lockedOrgName: string | null;
  canCreateOrg: boolean;
  platformAdmin: boolean;
  accessStatus: AccessStatus;
  accessRequestId: string | null;
  workspaceOrgId: string | null;
  workspaceOrgName: string | null;
  requestCreatedAt: string | null;
  workspaceMissing?: boolean;
  /** The team role this person holds or was invited with (owner, admin, scout, viewer). */
  workspaceRole?: string | null;
  isTeamHead: boolean;
  orgCity: string | null;
  orgStateProv: string | null;
  orgDescription: string | null;
  orgTeamAffiliation: TeamAffiliationOption | null;
  orgSchoolFunded: boolean | null;
  orgOutsideGrants: boolean | null;
  orgSponsorsAllowed: boolean | null;
  orgFundingModel: FundingModel | null;
  termsAcceptedAt: string | null;
  privacyAcceptedAt: string | null;
  currentStep: "profile" | "team" | "preferences" | "complete";
  startedAt: string | null;
  savedAt: string | null;
  /** The latest request to put a team on Vantage (migration 0733); absent on older servers. */
  teamRequest?: {
    id: string;
    teamNumber: number;
    status: "pending" | "approved" | "declined" | "withdrawn" | "forwarded";
    declineReason: string | null;
  } | null;
  /** Teams this person is on that a ban suspended. */
  bannedTeams?: Array<{ teamNumber: number; orgName: string }>;
};

export const GENDERS: Array<{ value: OnboardingGender; label: string }> = [
  { value: "prefer_not_to_say", label: "Prefer not to say" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "other", label: "Other" },
];

export const ROLES: Array<{ value: OnboardingRole; label: string; detail: string }> = [
  { value: "student", label: "Student", detail: "On the team, in the shop" },
  { value: "mentor", label: "Mentor or teacher", detail: "Adult who supports or coaches the team" },
  { value: "coach", label: "Head mentor or coach", detail: "Runs the team and the season" },
  { value: "parent", label: "Parent", detail: "Guardian supporting the team" },
  { value: "other", label: "Something else", detail: "Alum, volunteer, sponsor" },
];

export const CREW_ROLES: Array<{ value: OnboardingCrew; label: string; detail: string }> = [
  { value: "scout", label: "Scout", detail: "Stand data and picks" },
  { value: "driver", label: "Driver", detail: "Drive team" },
  { value: "operator", label: "Operator", detail: "Drive team" },
  { value: "mechanical", label: "Mechanical", detail: "Build and fabricate" },
  { value: "electrical", label: "Electrical", detail: "Wiring and power" },
  { value: "programming", label: "Programming", detail: "Robot code" },
  { value: "cad", label: "CAD", detail: "Design the robot" },
  { value: "pit", label: "Pit crew", detail: "Repairs at events" },
  { value: "business", label: "Business", detail: "Sponsors and awards" },
  { value: "other", label: "Not sure yet", detail: "Decide later" },
];

export const AFFILIATIONS: Array<{ value: TeamAffiliationOption; label: string }> = [
  { value: "private_school", label: "Private school" },
  { value: "public_school", label: "Public school" },
  { value: "community", label: "Community team" },
];

export const FOCUS_OPTIONS: Array<{ value: OnboardingFocus; label: string; description: string }> = [
  { value: "competition", label: "Competing", description: "Scouting, match strategy and the drive team" },
  { value: "build", label: "Building the robot", description: "Mechanical, CAD, wiring and code" },
  { value: "business", label: "Running the business", description: "Sponsors, grants, budget and awards" },
  { value: "leadership", label: "Leading the team", description: "Season plans, schedules and safety" },
];

export function pendingInviteDestination() {
  try {
    const token = sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY);
    return token ? `/invite?token=${encodeURIComponent(token)}` : null;
  } catch {
    return null;
  }
}

export function githubConnectionHref(orgId: string | null | undefined) {
  if (!orgId) return "/team/admin#github-connection";
  return `/team/admin?orgId=${encodeURIComponent(orgId)}#github-connection`;
}

export function isRole(value: string | null | undefined): value is OnboardingRole {
  return ROLES.some((role) => role.value === value);
}

export function isCrew(value: string | null | undefined): value is OnboardingCrew {
  return CREW_ROLES.some((crew) => crew.value === value);
}

export function isGender(value: string | null | undefined): value is OnboardingGender {
  return GENDERS.some((option) => option.value === value);
}
