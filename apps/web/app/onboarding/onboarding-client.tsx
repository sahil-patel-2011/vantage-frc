"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { VantageLogo } from "../../components/brand";
import { LegalAgreementCheckbox } from "../../components/legal-agreement-checkbox";
import {
  buildOnboardingLanding,
  buildOnboardingPendingPlan,
  buildOnboardingStepMeta,
  defaultFocusForRole,
  emptyOnboardingDraft,
  formatRoleList,
  isAdultRole,
  lookupTeamNumber,
  parseStoredCrews,
  parseStoredRoles,
  personalizeFromRoles,
  onboardingAdvance,
  onboardingCanSubmit,
  onboardingGoBack,
  onboardingLegalRequired,
  onboardingLoadCopy,
  onboardingMembershipNote,
  onboardingProgressLabel,
  sanitizeTeamNumberInput,
  submittedTeamNumber,
  type OnboardingCrew,
  type OnboardingDraft,
  type OnboardingFlowStep,
  type OnboardingFocus,
  type OnboardingGender,
  type OnboardingRole,
  type OnboardingStepContext,
  type TeamAffiliationOption,
} from "../../lib/onboarding";
import { PENDING_INVITE_KEY } from "../invite/invite-client";
import { legalConsentMessage } from "../../lib/legal";
import { safeAppPath } from "../../lib/security/safe-navigation";
import "./onboarding-flow.css";

type AccessStatus = "approved" | "invited" | "pending" | "declined" | "withdrawn" | "none";

type OnboardingState = {
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
  isTeamHead: boolean;
  orgCity: string | null;
  orgStateProv: string | null;
  orgDescription: string | null;
  orgTeamAffiliation: TeamAffiliationOption | null;
  orgSchoolFunded: boolean | null;
  orgOutsideGrants: boolean | null;
  orgSponsorsAllowed: boolean | null;
  termsAcceptedAt: string | null;
  privacyAcceptedAt: string | null;
  currentStep: "profile" | "team" | "preferences" | "complete";
  startedAt: string | null;
  savedAt: string | null;
};

const GENDERS: Array<{ value: OnboardingGender; label: string }> = [
  { value: "prefer_not_to_say", label: "Prefer not to say" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "other", label: "Other" },
];

const ROLES: Array<{ value: OnboardingRole; label: string; detail: string; glyph: string }> = [
  { value: "student", label: "Student", detail: "On the team, in the shop", glyph: "🎒" },
  { value: "mentor", label: "Mentor", detail: "Adult who coaches a subteam", glyph: "🔧" },
  { value: "coach", label: "Coach", detail: "Runs the team and the season", glyph: "📋" },
  { value: "parent", label: "Parent", detail: "Guardian supporting the team", glyph: "🚗" },
  { value: "other", label: "Something else", detail: "Alum, volunteer, sponsor", glyph: "✳️" },
];

const CREW_ROLES: Array<{ value: OnboardingCrew; label: string; detail: string }> = [
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

const AFFILIATIONS: Array<{ value: TeamAffiliationOption; label: string }> = [
  { value: "private_school", label: "Private school" },
  { value: "public_school", label: "Public school" },
  { value: "community", label: "Community team" },
];

const FOCUS_OPTIONS: Array<{ value: OnboardingFocus; label: string; description: string }> = [
  { value: "competition", label: "Competition", description: "Scouting, match strategy, drive team, event ops" },
  { value: "build", label: "Build & code", description: "Robot readiness, CAD, programming" },
  { value: "business", label: "Business", description: "Sponsors, grants, budgets, awards" },
  { value: "leadership", label: "Leadership", description: "Coordination, safety, season planning" },
];

function pendingInviteDestination() {
  try {
    const token = sessionStorage.getItem(PENDING_INVITE_KEY);
    return token ? `/invite?token=${encodeURIComponent(token)}` : null;
  } catch {
    return null;
  }
}

function githubConnectionHref(orgId: string | null | undefined) {
  if (!orgId) return "/team/admin#github-connection";
  return `/team/admin?orgId=${encodeURIComponent(orgId)}#github-connection`;
}

function isRole(value: string | null | undefined): value is OnboardingRole {
  return ROLES.some((role) => role.value === value);
}

function isCrew(value: string | null | undefined): value is OnboardingCrew {
  return CREW_ROLES.some((crew) => crew.value === value);
}

function isGender(value: string | null | undefined): value is OnboardingGender {
  return GENDERS.some((option) => option.value === value);
}

function FundingFields({
  draft,
  patch,
}: {
  draft: OnboardingDraft;
  patch: (next: Partial<OnboardingDraft>) => void;
}) {
  return (
    <fieldset className="onboarding-team-profile onboarding-funding-profile">
      <legend>Team affiliation &amp; funding</legend>
      <p className="onboarding-team-profile-hint">
        Required for owners and admins. Shapes the Business tools — teams that disallow sponsors hide sponsor features.
      </p>
      <fieldset className="onboarding-affiliation">
        <legend>Affiliation</legend>
        {AFFILIATIONS.map((option) => (
          <label key={option.value} className="check-field">
            <input
              type="radio"
              name="teamAffiliation"
              value={option.value}
              checked={draft.teamAffiliation === option.value}
              onChange={() => patch({ teamAffiliation: option.value })}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      {draft.teamAffiliation === "private_school" ? (
        <p className="onboarding-funding-note">
          Many private schools self-fund and disallow outside sponsors. Uncheck Sponsors allowed if that matches your school.
        </p>
      ) : null}
      <fieldset className="onboarding-funding-paths">
        <legend>
          Funding paths <small>Select at least one</small>
        </legend>
        <label className="check-field">
          <input type="checkbox" checked={draft.schoolFunded} onChange={(event) => patch({ schoolFunded: event.target.checked })} />
          School funds
        </label>
        <label className="check-field">
          <input type="checkbox" checked={draft.outsideGrants} onChange={(event) => patch({ outsideGrants: event.target.checked })} />
          Outside grants
        </label>
        <label className="check-field">
          <input type="checkbox" checked={draft.sponsorsAllowed} onChange={(event) => patch({ sponsorsAllowed: event.target.checked })} />
          Sponsors allowed
        </label>
      </fieldset>
    </fieldset>
  );
}

export default function OnboardingClient() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [step, setStep] = useState<OnboardingFlowStep>("profile");
  const [draft, setDraft] = useState<OnboardingDraft>(() => emptyOnboardingDraft());
  /** True once the person picked a focus themselves — stops the role default overriding them. */
  const focusTouched = useRef(false);
  const [message, setMessage] = useState("");
  const [errorField, setErrorField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error" | "setup_required">("loading");

  const patch = useCallback((next: Partial<OnboardingDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
  }, []);

  const hydrate = useCallback((data: OnboardingState) => {
    setState(data);
    setDraft((current) => ({
      ...current,
      firstName: data.firstName ?? current.firstName,
      lastName: data.lastName ?? current.lastName,
      dateOfBirth: data.dateOfBirth ?? current.dateOfBirth,
      gender: isGender(data.gender) ? data.gender : current.gender,
      teamRole: parseStoredRoles(data.teamRole)[0] ?? (isRole(data.teamRole) ? data.teamRole : current.teamRole),
      teamRoles: parseStoredRoles(data.teamRole).length ? parseStoredRoles(data.teamRole) : current.teamRoles,
      crewRole: parseStoredCrews(data.crewRole)[0] ?? (isCrew(data.crewRole) ? data.crewRole : current.crewRole),
      crewRoles: parseStoredCrews(data.crewRole),
      roleDescription: data.roleDescription ?? current.roleDescription,
      teamNumber: String(data.lockedTeamNumber ?? data.preferredTeamNumber ?? current.teamNumber ?? ""),
      noTeam: data.complete && !data.lockedTeamNumber && data.preferredTeamNumber == null ? true : current.noTeam,
      primaryFocus: data.primaryFocus ?? current.primaryFocus,
      displayName: data.displayName ?? current.displayName,
      themePreference: data.themePreference ?? current.themePreference,
      orgCity: data.orgCity ?? current.orgCity,
      orgStateProv: data.orgStateProv ?? current.orgStateProv,
      orgDescription: data.orgDescription ?? current.orgDescription,
      teamAffiliation: data.orgTeamAffiliation ?? current.teamAffiliation,
      schoolFunded: data.orgSchoolFunded ?? current.schoolFunded,
      outsideGrants: data.orgOutsideGrants ?? current.outsideGrants,
      sponsorsAllowed: data.orgSponsorsAllowed ?? current.sponsorsAllowed,
      termsAccepted: data.termsAcceptedAt ? true : current.termsAccepted,
      privacyAccepted: data.privacyAcceptedAt ? true : current.privacyAccepted,
    }));
    if (data.primaryFocus) focusTouched.current = true;
  }, []);

  const approvedDestination = useCallback(
    (data: OnboardingState) => {
      const nextParam = searchParams.get("next");
      if (nextParam) return safeAppPath(nextParam, "/workspace");
      if (data.workspaceOrgId) return `/start?orgId=${encodeURIComponent(data.workspaceOrgId)}`;
      return data.platformAdmin ? "/admin" : "/workspace";
    },
    [searchParams],
  );

  /** On load, an already-complete profile goes straight through — the landing
   *  screen is for the moment you finish, not every later visit. */
  const routeCompleteState = useCallback(
    (data: OnboardingState, justFinished: boolean) => {
      if (data.accessStatus === "approved") {
        if (justFinished) {
          setStep("done");
          return;
        }
        window.location.assign(approvedDestination(data));
        return;
      }
      if (data.accessStatus === "invited") {
        const inviteDestination = pendingInviteDestination();
        if (inviteDestination) {
          window.location.assign(inviteDestination);
          return;
        }
      }
      setStep("pending");
    },
    [approvedDestination],
  );

  const loadSession = useCallback(() => {
    setLoadStatus("loading");
    setLoadError(null);
    void fetch("/api/onboarding", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          setLoadStatus("setup_required");
          setLoadError("Sign in again to continue secure onboarding.");
          setState(null);
          return null;
        }
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          setLoadStatus("error");
          setLoadError(data.error ?? "Could not load your secure onboarding session.");
          setState(null);
          return null;
        }
        return (await response.json()) as OnboardingState;
      })
      .then((data) => {
        if (!data) return;
        hydrate(data);
        setLoadStatus("ready");
        if (data.complete) routeCompleteState(data, false);
        else if (data.currentStep === "team" || data.currentStep === "preferences") setStep(data.currentStep);
        else setStep("profile");
      })
      .catch(() => {
        setLoadStatus("error");
        setLoadError("Could not load onboarding. Check your connection and try again.");
        setState(null);
      });
  }, [hydrate, routeCompleteState]);

  useEffect(() => {
    loadSession();
     
  }, []);

  const locked = state?.lockedTeamNumber != null;
  const legalNeeded = onboardingLegalRequired({
    termsAcceptedAt: state?.termsAcceptedAt,
    privacyAcceptedAt: state?.privacyAcceptedAt,
  });

  const context: OnboardingStepContext = useMemo(
    () => ({
      isTeamHead: Boolean(state?.isTeamHead),
      legalNeeded,
      locked,
      lockedTeamNumber: state?.lockedTeamNumber ?? null,
      lockedOrgName: state?.lockedOrgName ?? null,
      accessStatus: state?.accessStatus ?? null,
      knownTeamNumber: state?.preferredTeamNumber ?? null,
    }),
    [state, legalNeeded, locked],
  );

  const adult = isAdultRole(draft.teamRoles);
  const lookup = useMemo(
    () =>
      lookupTeamNumber({
        raw: draft.teamNumber,
        noTeam: draft.noTeam,
        locked,
        lockedTeamNumber: state?.lockedTeamNumber ?? null,
        lockedOrgName: state?.lockedOrgName ?? null,
        accessStatus: state?.accessStatus ?? null,
        knownTeamNumber: state?.preferredTeamNumber ?? null,
        adult,
      }),
    [draft.teamNumber, draft.noTeam, locked, state, adult],
  );

  const canSubmit = onboardingCanSubmit({
    termsAccepted: draft.termsAccepted,
    privacyAccepted: draft.privacyAccepted,
    termsAcceptedAt: state?.termsAcceptedAt,
    privacyAcceptedAt: state?.privacyAcceptedAt,
  });
  const stepMeta = useMemo(() => buildOnboardingStepMeta(step), [step]);
  const progressLabel = onboardingProgressLabel(step);
  const membershipNote = onboardingMembershipNote(state?.accessStatus ?? "none", {
    preferredTeamNumber: state?.preferredTeamNumber ?? lookup.teamNumber,
  });

  function pickRole(value: OnboardingRole) {
    const next = draft.teamRoles.includes(value)
      ? draft.teamRoles.filter((role) => role !== value)
      : [...draft.teamRoles, value];
    const teamRoles = next.length ? next : [value];
    const nextFocus = focusTouched.current
      ? draft.primaryFocus
      : defaultFocusForRole(teamRoles, draft.crewRoles);
    patch({ teamRoles, teamRole: teamRoles[0] ?? value, primaryFocus: nextFocus });
    setErrorField(null);
  }

  function pickCrew(value: OnboardingCrew) {
    const next = draft.crewRoles.includes(value)
      ? draft.crewRoles.filter((crew) => crew !== value)
      : [...draft.crewRoles, value];
    const nextFocus = focusTouched.current
      ? draft.primaryFocus
      : defaultFocusForRole(draft.teamRoles, next);
    patch({ crewRoles: next, crewRole: next[0] ?? "", primaryFocus: nextFocus });
  }

  function goBack() {
    const back = onboardingGoBack({ step, draft, error: null, errorField: null });
    setStep(back.step);
    setMessage("");
    setErrorField(null);
  }

  /** Runs the shared gate, then persists the draft for that step. */
  async function advance() {
    const result = onboardingAdvance({ step, draft, error: null, errorField: null }, context);
    if (result.error) {
      setMessage(result.error);
      setErrorField(result.errorField);
      return;
    }
    setErrorField(null);
    if (result.submit) {
      await finish();
      return;
    }
    const completedStep = step as "profile" | "team";
    setBusy(true);
    setMessage("");
    // Payload shape is the server's, unchanged: `step: "profile"` is strict and
    // takes only these four fields, so role/crew ride along with the team step.
    const body =
      completedStep === "profile"
        ? {
            step: "profile" as const,
            firstName: draft.firstName.trim(),
            lastName: draft.lastName.trim(),
            dateOfBirth: draft.dateOfBirth,
            gender: draft.gender,
          }
        : {
            step: "team" as const,
            preferredTeamNumber: submittedTeamNumber(draft, context),
            teamRole: draft.teamRoles[0] ?? draft.teamRole,
            crewRole: draft.crewRoles[0] ?? (draft.crewRole || null),
            teamRoles: draft.teamRoles,
            crewRoles: draft.crewRoles,
            roleDescription: draft.roleDescription.trim() || null,
            primaryFocus: draft.primaryFocus,
          };
    try {
      const response = await fetch("/api/onboarding", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as OnboardingState & { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not save your progress.");
        return;
      }
      hydrate(data);
      setStep(result.step);
    } catch {
      setMessage("Could not save your progress. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setMessage("");
    try {
      if (!canSubmit) {
        const consentMessage =
          legalConsentMessage({ terms: draft.termsAccepted, privacy: draft.privacyAccepted }) ??
          "Agree to the Terms of Service and the Privacy Policy to submit your request.";
        setLegalError(consentMessage);
        setMessage(consentMessage);
        setErrorField("legal");
        return;
      }
      const isTeamHead = Boolean(state?.isTeamHead);
      // Payload is byte-for-byte the contract `POST /api/onboarding` already validates.
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          dateOfBirth: draft.dateOfBirth,
          gender: draft.gender,
          preferredTeamNumber: submittedTeamNumber(draft, context),
          teamRole: draft.teamRoles[0] ?? draft.teamRole,
          crewRole: draft.crewRoles[0] ?? (draft.crewRole || null),
          teamRoles: draft.teamRoles,
          crewRoles: draft.crewRoles,
          roleDescription: draft.roleDescription.trim() || null,
          primaryFocus: draft.primaryFocus,
          displayName: draft.displayName.trim() || undefined,
          themePreference: draft.themePreference,
          termsAccepted: true,
          privacyAccepted: true,
          city: isTeamHead ? draft.orgCity.trim() || null : undefined,
          stateProv: isTeamHead ? draft.orgStateProv.trim() || null : undefined,
          description: isTeamHead ? draft.orgDescription.trim() || null : undefined,
          teamAffiliation: isTeamHead ? draft.teamAffiliation || null : undefined,
          schoolFunded: isTeamHead ? draft.schoolFunded : undefined,
          outsideGrants: isTeamHead ? draft.outsideGrants : undefined,
          sponsorsAllowed: isTeamHead ? draft.sponsorsAllowed : undefined,
        }),
      });
      const data = (await response.json()) as OnboardingState & { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not submit your access request.");
        return;
      }
      hydrate(data);
      routeCompleteState(data, true);
    } finally {
      setBusy(false);
    }
  }

  async function refreshApproval() {
    setChecking(true);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding", { cache: "no-store" });
      if (response.status === 401) {
        setMessage("Your onboarding session ended. If your team approved you, use the secure sign-in link in your email.");
        return;
      }
      const data = (await response.json()) as OnboardingState & { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not check approval status.");
        return;
      }
      hydrate(data);
      if (data.accessStatus === "approved") {
        setMessage("Approved. Your team access email is on its way — use its sign-in link to enter the workspace.");
      } else if (data.accessStatus === "invited") {
        setMessage("Your team sent an invitation. Open the invitation email to finish joining.");
      } else if (data.accessStatus === "declined") {
        setMessage("This request was not approved. You can update the team number and request access again.");
      } else {
        setMessage("Still waiting for a team owner or administrator to review your request.");
      }
    } catch {
      setMessage("Could not check approval status. Try again in a moment.");
    } finally {
      setChecking(false);
    }
  }

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => undefined);
    window.location.assign("/signin");
  }

  if (loadStatus !== "ready" || !state) {
    const copy = onboardingLoadCopy(
      loadStatus === "setup_required" ? "setup_required" : loadStatus === "error" ? "error" : "loading",
      loadError,
    );
    return (
      <main className="onboarding-page onboarding-flow-page">
        <section className="onboarding-card onboarding-flow-card" aria-labelledby="onboarding-load-title" aria-busy={copy.kind === "loading"}>
          <header className="onboarding-flow-header">
            <div className="onboarding-brand"><VantageLogo /></div>
            <span>{copy.eyebrow}</span>
            <h1 id="onboarding-load-title">{copy.title}</h1>
            <p className="onboarding-sub">{copy.description}</p>
          </header>
          <div className={`onboarding-load-shell${copy.kind === "loading" ? " loading" : ""}`}>
            {copy.badge ? <span className={`onboarding-load-badge${copy.kind === "setup_required" ? " setup" : ""}`}>{copy.badge}</span> : null}
            <p className="onboarding-membership-blurb">
              <strong>{membershipNote.title}</strong>
              <span>{membershipNote.body}</span>
            </p>
            {copy.kind === "error" || copy.kind === "setup_required" ? (
              <div className="onboarding-pending-actions">
                {copy.kind === "error" ? (
                  <button type="button" className="signin-submit" onClick={() => loadSession()}>Try again</button>
                ) : (
                  <a className="signin-submit" href="/signin">Sign in</a>
                )}
                <a className="signin-link" href="/invite">Have an invite?</a>
              </div>
            ) : (
              <p className="onboarding-load-progress" role="status">Checking saved steps…</p>
            )}
          </div>
        </section>
      </main>
    );
  }

  const setupStep = step === "pending" || step === "done" ? null : step;
  const headerCopy =
    step === "done"
      ? { eyebrow: "SETUP COMPLETE", title: "You're in.", sub: "Here's the shortest path to being useful this week." }
      : step === "pending"
        ? {
            eyebrow: "SECURE ACCESS REQUEST",
            title: "Your profile is ready. Team access is next.",
            sub: "A team number never grants access by itself. A team owner or administrator must approve this verified account.",
          }
        : {
            eyebrow: "WELCOME TO VANTAGE",
            title: "Set up Vantage around your role.",
            sub: "Three short steps. Nothing is shared with a team until they approve you.",
          };

  return (
    <main className="onboarding-page onboarding-flow-page">
      <section className={`onboarding-card onboarding-flow-card${step === "pending" || step === "done" ? " pending" : ""}`} aria-labelledby="onboarding-title">
        <header className="onboarding-flow-header">
          <div className="onboarding-brand"><VantageLogo /></div>
          <span>{headerCopy.eyebrow}</span>
          <h1 id="onboarding-title">{headerCopy.title}</h1>
          <p className="onboarding-sub">{headerCopy.sub}</p>
        </header>

        {setupStep ? (
          <div className="onboarding-progress-block">
            <p className="onboarding-progress-label" aria-live="polite">{progressLabel}</p>
            <ol className="onboarding-steps onboarding-steps-simple" aria-label="Onboarding progress">
              {stepMeta.map((item) => (
                <li key={item.id} className={item.phase} aria-current={item.phase === "current" ? "step" : undefined}>
                  <b aria-hidden="true">{item.phase === "done" ? "✓" : item.index + 1}</b>
                  <span>{item.label}</span>
                </li>
              ))}
            </ol>
            <p className="onboarding-step-hint">{stepMeta.find((item) => item.phase === "current")?.description}</p>
          </div>
        ) : null}

        {message ? (
          <p className={`onboarding-message${errorField ? " invalid" : ""}`} role="status">{message}</p>
        ) : null}
        {state.savedAt && setupStep ? (
          <p className="onboarding-resume-note">
            <b>Progress restored</b>
            <span>Securely saved {new Date(state.savedAt).toLocaleString()}. Your earlier answers are already filled in.</span>
          </p>
        ) : null}

        {step === "profile" ? (
          <form className="onboarding-form" onSubmit={(event) => { event.preventDefault(); void advance(); }}>
            <div className="onboarding-row">
              <label>
                First name
                <input
                  required
                  maxLength={60}
                  value={draft.firstName}
                  onChange={(event) => patch({ firstName: event.target.value })}
                  autoComplete="given-name"
                  autoCapitalize="words"
                  aria-invalid={errorField === "firstName" || undefined}
                />
              </label>
              <label>
                Last name
                <input
                  required
                  maxLength={60}
                  value={draft.lastName}
                  onChange={(event) => patch({ lastName: event.target.value })}
                  autoComplete="family-name"
                  autoCapitalize="words"
                  aria-invalid={errorField === "lastName" || undefined}
                />
              </label>
            </div>

            <fieldset className="onboarding-cards onboarding-cards-role">
              <legend>
                What are you on the team? <small>Pick every role that fits</small>
              </legend>
              {ROLES.map((option) => (
                <label key={option.value} className={draft.teamRoles.includes(option.value) ? "selected" : undefined}>
                  <input
                    type="checkbox"
                    name="teamRole"
                    value={option.value}
                    checked={draft.teamRoles.includes(option.value)}
                    onChange={() => pickRole(option.value)}
                  />
                  <i aria-hidden="true">{option.glyph}</i>
                  <strong>{option.label}</strong>
                  <span>{option.detail}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="onboarding-cards onboarding-cards-crew">
              <legend>
                What do you actually do? <small>Pick as many as you want</small>
              </legend>
              {CREW_ROLES.map((option) => (
                <label key={option.value} className={draft.crewRoles.includes(option.value) ? "selected" : undefined}>
                  <input
                    type="checkbox"
                    name="crewRole"
                    value={option.value}
                    checked={draft.crewRoles.includes(option.value)}
                    onChange={() => pickCrew(option.value)}
                  />
                  <strong>{option.label}</strong>
                  <span>{option.detail}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="onboarding-account-fields">
              <legend>Account record</legend>
              <p className="onboarding-team-profile-hint">
                Vantage requires these two for youth-safe account records before it will create your account. Teammates and team leaders never see them.
              </p>
              <label>
                Date of birth
                <input
                  required
                  type="date"
                  value={draft.dateOfBirth}
                  onChange={(event) => patch({ dateOfBirth: event.target.value })}
                  autoComplete="bday"
                  aria-invalid={errorField === "dateOfBirth" || undefined}
                />
              </label>
              <label>
                Gender
                <select required value={draft.gender} onChange={(event) => patch({ gender: event.target.value as OnboardingGender })}>
                  {GENDERS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </fieldset>

            <div className="onboarding-actions">
              <span />
              <button className="signin-submit" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Continue"}
              </button>
            </div>
          </form>
        ) : null}

        {step === "team" ? (
          <form className="onboarding-form" onSubmit={(event) => { event.preventDefault(); void advance(); }}>
            <div className={`onboarding-team-lock${locked ? " locked" : ""}`}>
              <label>
                FRC team number <small>{locked ? "" : "Optional"}</small>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  enterKeyHint="done"
                  placeholder="1234"
                  value={draft.teamNumber}
                  disabled={locked || draft.noTeam}
                  aria-invalid={lookup.ok ? undefined : true}
                  aria-describedby="onboarding-team-lookup"
                  onChange={(event) => patch({ teamNumber: sanitizeTeamNumberInput(event.target.value) })}
                />
              </label>
              <p id="onboarding-team-lookup" className={`onboarding-lookup ${lookup.tone}`} role="status" aria-live="polite">
                <strong>{lookup.title}</strong>
                <span>{lookup.body}</span>
                {lookup.action ? <a href={lookup.action.href}>{lookup.action.label} →</a> : null}
              </p>
              {locked ? null : (
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={draft.noTeam}
                    onChange={(event) => patch({ noTeam: event.target.checked, teamNumber: event.target.checked ? "" : draft.teamNumber })}
                  />
                  I don&apos;t have a team number yet
                </label>
              )}
            </div>

            <fieldset className="onboarding-focus-grid">
              <legend>What should Vantage put first?</legend>
              {FOCUS_OPTIONS.map((option, index) => (
                <label key={option.value} className={draft.primaryFocus === option.value ? "selected" : undefined}>
                  <input
                    type="radio"
                    name="primaryFocus"
                    value={option.value}
                    checked={draft.primaryFocus === option.value}
                    onChange={() => {
                      focusTouched.current = true;
                      patch({ primaryFocus: option.value });
                    }}
                  />
                  <i aria-hidden="true">{String(index + 1).padStart(2, "0")}</i>
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </label>
              ))}
            </fieldset>

            <label>
              Describe your role <small>Optional, 280 characters</small>
              <textarea
                maxLength={280}
                rows={3}
                value={draft.roleDescription}
                onChange={(event) => patch({ roleDescription: event.target.value })}
                placeholder="Scout stand, drive team operator, CAD lead, pit repair, business outreach…"
              />
            </label>

            {state.isTeamHead ? <FundingFields draft={draft} patch={patch} /> : null}

            <div className="onboarding-actions">
              <button type="button" className="signin-link" onClick={goBack}>Back</button>
              <button className="signin-submit" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Continue"}
              </button>
            </div>
          </form>
        ) : null}

        {step === "preferences" ? (
          <form className="onboarding-form" onSubmit={(event) => { event.preventDefault(); void advance(); }}>
            <section className="onboarding-review-card" aria-label="Access request summary">
              <div><span>TEAM</span><strong>{lookup.teamNumber ? `FRC ${lookup.teamNumber}` : "None yet"}</strong></div>
              <div><span>ROLE</span><strong>{formatRoleList(draft.teamRoles, Object.fromEntries(ROLES.map((option) => [option.value, option.label])))}</strong></div>
              <div><span>CREW</span><strong>{formatRoleList(draft.crewRoles, Object.fromEntries(CREW_ROLES.map((option) => [option.value, option.label])))}</strong></div>
              <div><span>STARTING VIEW</span><strong>{FOCUS_OPTIONS.find((option) => option.value === draft.primaryFocus)?.label}</strong></div>
              {draft.roleDescription.trim() ? (
                <div><span>HOW YOU HELP</span><strong>{draft.roleDescription.trim()}</strong></div>
              ) : null}
            </section>

            {state.isTeamHead ? (
              <fieldset className="onboarding-team-profile">
                <legend>Team location</legend>
                <p className="onboarding-team-profile-hint">
                  Required for owners and admins. Used in sponsorship one-pagers and grant proposals — this workspace only.
                </p>
                <div className="onboarding-row">
                  <label>
                    City
                    <input
                      required
                      maxLength={120}
                      value={draft.orgCity}
                      onChange={(event) => patch({ orgCity: event.target.value })}
                      autoComplete="address-level2"
                      placeholder="Portland"
                      aria-invalid={errorField === "orgCity" || undefined}
                    />
                  </label>
                  <label>
                    State / province
                    <input
                      required
                      maxLength={80}
                      value={draft.orgStateProv}
                      onChange={(event) => patch({ orgStateProv: event.target.value })}
                      autoComplete="address-level1"
                      placeholder="OR"
                    />
                  </label>
                </div>
                <label>
                  Describe your FRC team <small>Optional</small>
                  <textarea
                    maxLength={2000}
                    rows={3}
                    value={draft.orgDescription}
                    onChange={(event) => patch({ orgDescription: event.target.value })}
                    placeholder="A short blurb about who you are — students served, focus areas, community."
                  />
                </label>
              </fieldset>
            ) : null}

            {draft.primaryFocus === "build" ? (
              <div className="onboarding-security-note" style={{ marginTop: 0 }}>
                <b aria-hidden="true">↳</b>
                <p>
                  <strong>After approval: connect GitHub for AI code context.</strong>
                  <span>
                    {" "}Owners/admins link the robot-code repo under{" "}
                    <a href={githubConnectionHref(state.workspaceOrgId)}>Team → GitHub</a> (OAuth or encrypted PAT).
                  </span>
                </p>
              </div>
            ) : null}

            <details className="onboarding-optional">
              <summary>Display name and appearance <small>Optional — change any time in Account</small></summary>
              <label>
                Display name
                <input
                  maxLength={80}
                  placeholder={`${draft.firstName} ${draft.lastName}`.trim()}
                  value={draft.displayName}
                  onChange={(event) => patch({ displayName: event.target.value })}
                />
              </label>
              <fieldset className="onboarding-theme">
                <legend>Appearance</legend>
                <label className="check-field">
                  <input type="radio" name="theme" checked={draft.themePreference === "light"} onChange={() => patch({ themePreference: "light" })} /> Light
                </label>
                <label className="check-field">
                  <input type="radio" name="theme" checked={draft.themePreference === "dark"} onChange={() => patch({ themePreference: "dark" })} /> Dark
                </label>
              </fieldset>
            </details>

            {legalNeeded ? (
              <div className="onboarding-terms-block">
                <LegalAgreementCheckbox
                  id="onboarding-legal"
                  terms={draft.termsAccepted}
                  privacy={draft.privacyAccepted}
                  onChange={(next) => {
                    patch({ termsAccepted: next.terms, privacyAccepted: next.privacy });
                    setLegalError(legalConsentMessage({ terms: next.terms, privacy: next.privacy }));
                  }}
                  className="onboarding-legal-accept"
                  required
                  error={legalError}
                />
              </div>
            ) : null}

            <div className="onboarding-security-note">
              <b aria-hidden="true">✓</b>
              <p>
                <strong>{lookup.teamNumber ? "Submit sends a request — not access." : "Finish without a team"}</strong>
                <span>
                  {lookup.teamNumber
                    ? " That team's owners must approve. You cannot join an existing workspace just by knowing the number."
                    : " You are not joining anyone. An invite or a later team-number request still needs that team's approval."}
                </span>
              </p>
            </div>

            <div className="onboarding-actions">
              <button type="button" className="signin-link" onClick={goBack}>Back</button>
              <button className="signin-submit" type="submit" disabled={busy || !canSubmit}>
                {busy ? "Submitting…" : lookup.teamNumber ? "Submit access request" : "Finish without a team"}
              </button>
            </div>
          </form>
        ) : null}

        {step === "pending" ? (
          <PendingPanel
            state={state}
            adult={adult}
            checking={checking}
            busy={busy}
            onCheck={() => void refreshApproval()}
            onEdit={() => { setMessage(""); setStep("team"); }}
            onSignOut={() => void signOut()}
          />
        ) : null}

        {step === "done" ? <LandingPanel state={state} draft={draft} /> : null}
      </section>
    </main>
  );
}

function PendingPanel({
  state,
  adult,
  checking,
  busy,
  onCheck,
  onEdit,
  onSignOut,
}: {
  state: OnboardingState;
  adult: boolean;
  checking: boolean;
  busy: boolean;
  onCheck: () => void;
  onEdit: () => void;
  onSignOut: () => void;
}) {
  const plan = buildOnboardingPendingPlan({
    accessStatus: state.accessStatus,
    teamNumber: state.preferredTeamNumber ?? state.lockedTeamNumber ?? null,
    orgName: state.workspaceOrgName ?? state.lockedOrgName ?? null,
    adult,
  });

  return (
    <div className="onboarding-pending-panel">
      <div className={`onboarding-request-status ${state.accessStatus}`}>
        <i aria-hidden="true" />
        <div>
          <span>{plan.eyebrow}</span>
          <strong>{plan.headline}</strong>
        </div>
      </div>

      <ol className="onboarding-approval-path">
        {plan.stages.map((stage, index) => (
          <li key={stage.key} className={stage.phase === "upcoming" ? undefined : stage.phase}>
            <b>{stage.phase === "done" ? "✓" : index + 1}</b>
            <div>
              <strong>{stage.title}</strong>
              <span>{stage.detail}</span>
            </div>
          </li>
        ))}
      </ol>

      {plan.notified ? (
        <div className="onboarding-security-note">
          <b aria-hidden="true">✓</b>
          <p>
            <strong>Who was notified</strong>
            <span> {plan.notified} They do not receive your birth date or gender.</span>
          </p>
        </div>
      ) : null}

      <section className="onboarding-meanwhile" aria-labelledby="onboarding-meanwhile-title">
        <h2 id="onboarding-meanwhile-title">While you wait</h2>
        <ul>
          {plan.meanwhile.map((link) => (
            <li key={link.href}>
              <a href={link.href}>
                <strong>{link.label}</strong>
                <span>{link.detail}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <div className="onboarding-pending-actions">
        {plan.primaryAction.kind === "check" ? (
          <button type="button" className="signin-submit" disabled={checking} onClick={onCheck}>
            {checking ? "Checking…" : plan.primaryAction.label}
          </button>
        ) : plan.primaryAction.kind === "invite" ? (
          <a className="signin-submit" href="/invite">{plan.primaryAction.label}</a>
        ) : plan.primaryAction.kind === "claim" ? (
          <a className="signin-submit" href="/claim">{plan.primaryAction.label}</a>
        ) : (
          <button type="button" className="signin-submit" onClick={onEdit}>{plan.primaryAction.label}</button>
        )}
        <a className="signin-link" href="/invite">Have an invite?</a>
        <button type="button" className="signin-link" disabled={busy} onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

function LandingPanel({ state, draft }: { state: OnboardingState; draft: OnboardingDraft }) {
  const landing = buildOnboardingLanding({
    teamRole: draft.teamRoles.join(",") || draft.teamRole,
    crewRole: draft.crewRoles.join(",") || draft.crewRole || null,
    roleDescription: draft.roleDescription || null,
    primaryFocus: draft.primaryFocus,
    orgId: state.workspaceOrgId,
    orgName: state.workspaceOrgName,
    platformAdmin: state.platformAdmin,
  });
  const personalized = personalizeFromRoles({
    teamRole: draft.teamRoles,
    crewRole: draft.crewRoles,
    primaryFocus: draft.primaryFocus,
  });

  return (
    <div className="onboarding-landing">
      <p className="onboarding-landing-summary">{landing.summary}</p>
      <p className="onboarding-landing-summary">{personalized.greetingHint}</p>
      <ol className="onboarding-landing-list">
        {landing.firstFiveMinutes.map((link, index) => (
          <li key={link.key}>
            <a href={link.href}>
              <b aria-hidden="true">{index + 1}</b>
              <div>
                <strong>{link.label}</strong>
                <span>{link.detail}</span>
                <em>{link.reason}</em>
              </div>
            </a>
          </li>
        ))}
      </ol>
      <div className="onboarding-pending-actions">
        <a className="signin-submit" href={landing.primary.href}>{landing.primary.label}</a>
        {landing.secondary ? <a className="signin-link" href={landing.secondary.href}>{landing.secondary.label}</a> : null}
      </div>
    </div>
  );
}
