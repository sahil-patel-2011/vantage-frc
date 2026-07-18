"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { VantageLogo } from "../../components/brand";
import { LegalAgreementCheckbox } from "../../components/legal-agreement-checkbox";
import {
  buildOnboardingStepMeta,
  onboardingCanSubmit,
  onboardingLoadCopy,
  onboardingMembershipNote,
  onboardingProgressLabel,
  onboardingTermsRequired,
  type OnboardingFlowStep,
} from "../../lib/onboarding";
import { PENDING_INVITE_KEY } from "../invite/invite-client";
import { safeAppPath } from "../../lib/security/safe-navigation";
import "./onboarding-flow.css";

type PrimaryFocus = "competition" | "build" | "business" | "leadership";
type AccessStatus = "approved" | "invited" | "pending" | "declined" | "none";

type OnboardingState = {
  complete: boolean;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  preferredTeamNumber: number | null;
  teamRole: string | null;
  primaryFocus: PrimaryFocus;
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
  termsAcceptedAt: string | null;
  currentStep: "profile" | "team" | "preferences" | "complete";
  startedAt: string | null;
  savedAt: string | null;
};

const GENDERS = [
  { value: "prefer_not_to_say", label: "Prefer not to say" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "other", label: "Other" },
] as const;

const ROLES = [
  { value: "student", label: "Student" },
  { value: "mentor", label: "Mentor" },
  { value: "coach", label: "Coach" },
  { value: "parent", label: "Parent / guardian" },
  { value: "other", label: "Other" },
] as const;

const FOCUS_OPTIONS: Array<{
  value: PrimaryFocus;
  index: string;
  label: string;
  description: string;
}> = [
  { value: "competition", index: "01", label: "Competition", description: "Scouting, match strategy, drive team, and event operations" },
  { value: "build", index: "02", label: "Build & code", description: "Robot readiness, CAD, programming, and technical work" },
  { value: "business", index: "03", label: "Business", description: "Sponsors, grants, budgets, awards, and outreach" },
  { value: "leadership", index: "04", label: "Leadership", description: "Team coordination, safety, access, and season planning" },
];

function pendingInviteDestination() {
  try {
    const token = sessionStorage.getItem(PENDING_INVITE_KEY);
    return token ? `/invite?token=${encodeURIComponent(token)}` : null;
  } catch {
    return null;
  }
}

function approvedDestination(state: OnboardingState, nextParam: string | null) {
  if (nextParam) return safeAppPath(nextParam, "/workspace");
  // Build & code focus → deep-link Team GitHub connection for robot-code AI context.
  if (state.workspaceOrgId && state.primaryFocus === "build") {
    return `/team/admin?orgId=${encodeURIComponent(state.workspaceOrgId)}#github-connection`;
  }
  // Role / subteam Soft-UI path (CD #28) after profile approval.
  if (state.workspaceOrgId) return `/start?orgId=${encodeURIComponent(state.workspaceOrgId)}`;
  return state.platformAdmin ? "/admin" : "/workspace";
}

function githubConnectionHref(orgId: string | null | undefined) {
  if (!orgId) return "/team/admin#github-connection";
  return `/team/admin?orgId=${encodeURIComponent(orgId)}#github-connection`;
}

export default function OnboardingClient() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [step, setStep] = useState<OnboardingFlowStep>("profile");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("prefer_not_to_say");
  const [teamNumber, setTeamNumber] = useState("");
  const [teamRole, setTeamRole] = useState("student");
  const [primaryFocus, setPrimaryFocus] = useState<PrimaryFocus>("competition");
  const [displayName, setDisplayName] = useState("");
  const [themePreference, setThemePreference] = useState<"light" | "dark">("light");
  const [orgCity, setOrgCity] = useState("");
  const [orgStateProv, setOrgStateProv] = useState("");
  const [orgDescription, setOrgDescription] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error" | "setup_required">("loading");

  function hydrate(data: OnboardingState) {
    setState(data);
    setFirstName(data.firstName ?? "");
    setLastName(data.lastName ?? "");
    setDateOfBirth(data.dateOfBirth ?? "");
    setGender(data.gender ?? "prefer_not_to_say");
    setTeamNumber(String(data.lockedTeamNumber ?? data.preferredTeamNumber ?? ""));
    setTeamRole(data.teamRole ?? "student");
    setPrimaryFocus(data.primaryFocus ?? "competition");
    setDisplayName(data.displayName ?? "");
    setThemePreference(data.themePreference ?? "light");
    setOrgCity(data.orgCity ?? "");
    setOrgStateProv(data.orgStateProv ?? "");
    setOrgDescription(data.orgDescription ?? "");
    if (data.termsAcceptedAt) setTermsAccepted(true);
  }

  function routeCompleteState(data: OnboardingState) {
    if (data.accessStatus === "approved") {
      window.location.assign(approvedDestination(data, searchParams.get("next")));
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
  }

  function loadSession() {
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
        if (data.complete) routeCompleteState(data);
        else if (data.currentStep === "team" || data.currentStep === "preferences") setStep(data.currentStep);
        else setStep("profile");
      })
      .catch(() => {
        setLoadStatus("error");
        setLoadError("Could not load onboarding. Check your connection and try again.");
        setState(null);
      });
  }

  useEffect(() => {
    loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial secure session load only
  }, []);

  const locked = state?.lockedTeamNumber != null;
  const termsNeeded = onboardingTermsRequired(state?.termsAcceptedAt);
  const canSubmit = onboardingCanSubmit({
    termsAccepted,
    termsAcceptedAt: state?.termsAcceptedAt,
  });
  const stepMeta = useMemo(() => buildOnboardingStepMeta(step), [step]);
  const progressLabel = onboardingProgressLabel(step);
  const membershipNote = onboardingMembershipNote(state?.accessStatus ?? "none");

  async function saveProgress(completedStep: "profile" | "team") {
    setBusy(true);
    setMessage("");
    const body = completedStep === "profile"
      ? { step: "profile" as const, firstName, lastName, dateOfBirth, gender }
      : {
          step: "team" as const,
          preferredTeamNumber: Number(teamNumber),
          teamRole,
          primaryFocus,
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
      setStep(completedStep === "profile" ? "team" : "preferences");
      setMessage("Progress saved securely. You can return on another device and continue here.");
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
        setMessage("Please agree to the Terms of Service and Privacy Policy to submit your request.");
        setBusy(false);
        return;
      }
      const isTeamHead = Boolean(state?.isTeamHead);
      if (isTeamHead && (!orgCity.trim() || !orgStateProv.trim())) {
        setMessage("Add your team's city and state so sponsors and partners know where you compete from.");
        setBusy(false);
        return;
      }
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          dateOfBirth,
          gender,
          preferredTeamNumber: Number(teamNumber),
          teamRole,
          primaryFocus,
          displayName: displayName.trim() || undefined,
          themePreference,
          termsAccepted: true,
          city: isTeamHead ? orgCity.trim() || null : undefined,
          stateProv: isTeamHead ? orgStateProv.trim() || null : undefined,
          description: isTeamHead ? orgDescription.trim() || null : undefined,
        }),
      });
      const data = (await response.json()) as OnboardingState & { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not submit your access request.");
        return;
      }
      hydrate(data);
      routeCompleteState(data);
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
        setMessage("Approved. Your team access email is on its way—use its sign-in link to enter the workspace.");
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

  return (
    <main className="onboarding-page onboarding-flow-page">
      <section className={`onboarding-card onboarding-flow-card${step === "pending" ? " pending" : ""}`} aria-labelledby="onboarding-title">
        <header className="onboarding-flow-header">
          <div className="onboarding-brand"><VantageLogo /></div>
          <span>{step === "pending" ? "SECURE ACCESS REQUEST" : "WELCOME TO VANTAGE"}</span>
          <h1 id="onboarding-title">
            {step === "pending" ? "Your profile is ready. Team access is next." : "Set up Vantage around your role."}
          </h1>
          <p className="onboarding-sub">
            {step === "pending"
              ? "A team number never grants access by itself. A team owner or administrator must approve this verified account."
              : "Three short steps personalize your starting workspace. Nothing is shared with a team until they approve you."}
          </p>
        </header>

        {step !== "pending" ? (
          <div className="onboarding-progress-block">
            <p className="onboarding-progress-label" aria-live="polite">{progressLabel}</p>
            <ol className="onboarding-steps onboarding-steps-simple" aria-label="Onboarding progress">
              {stepMeta.map((item) => (
                <li
                  key={item.id}
                  className={item.phase}
                  aria-current={item.phase === "current" ? "step" : undefined}
                >
                  <b aria-hidden="true">{item.phase === "done" ? "✓" : item.index + 1}</b>
                  <span>{item.label}</span>
                </li>
              ))}
            </ol>
            <p className="onboarding-step-hint">{stepMeta.find((item) => item.phase === "current")?.description}</p>
          </div>
        ) : null}

        {message ? <p className="onboarding-message" role="status">{message}</p> : null}
        {state.savedAt && step !== "pending" ? (
          <p className="onboarding-resume-note">
            <b>Progress restored</b>
            <span>Securely saved {new Date(state.savedAt).toLocaleString()}. Finish from here—your earlier steps are already set.</span>
          </p>
        ) : null}

        {step === "profile" ? (
          <form className="onboarding-form" onSubmit={(event) => { event.preventDefault(); void saveProgress("profile"); }}>
            <div className="onboarding-row">
              <label>First name<input required maxLength={60} value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" /></label>
              <label>Last name<input required maxLength={60} value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" /></label>
            </div>
            <label>
              Date of birth
              <input required type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} autoComplete="bday" />
              <small>Used only for youth-safe account records. Team members never see it.</small>
            </label>
            <label>
              Gender
              <select required value={gender} onChange={(event) => setGender(event.target.value)}>
                {GENDERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button className="signin-submit" type="submit" disabled={busy}>{busy ? "Saving…" : "Save and continue to team"}</button>
          </form>
        ) : null}

        {step === "team" ? (
          <form className="onboarding-form" onSubmit={(event) => { event.preventDefault(); void saveProgress("team"); }}>
            <div className={`onboarding-team-lock${locked ? " locked" : ""}`}>
              <label>
                FRC team number
                <input required inputMode="numeric" min={1} max={99999} value={teamNumber} disabled={locked} onChange={(event) => setTeamNumber(event.target.value.replace(/\D/g, "").slice(0, 5))} />
              </label>
              <p>
                {locked
                  ? `${state.lockedOrgName ?? "Your team"} is already tied to this invitation or request.`
                  : "We use this to route your request to the correct team leaders. It does not unlock the workspace."}
              </p>
            </div>
            <label>
              Your role
              <select value={teamRole} onChange={(event) => setTeamRole(event.target.value)}>
                {ROLES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {state.isTeamHead ? (
              <fieldset className="onboarding-team-profile">
                <legend>Team location</legend>
                <p className="onboarding-team-profile-hint">
                  Required for owners and admins. Used in sponsorship one-pagers and grant proposals — this workspace only.
                </p>
                <div className="onboarding-row">
                  <label>
                    City
                    <input required maxLength={120} value={orgCity} onChange={(event) => setOrgCity(event.target.value)} autoComplete="address-level2" placeholder="Portland" />
                  </label>
                  <label>
                    State / province
                    <input required maxLength={80} value={orgStateProv} onChange={(event) => setOrgStateProv(event.target.value)} autoComplete="address-level1" placeholder="OR" />
                  </label>
                </div>
                <label>
                  Describe your FRC team <small>Optional</small>
                  <textarea maxLength={2000} rows={3} value={orgDescription} onChange={(event) => setOrgDescription(event.target.value)} placeholder="A short blurb about who you are — students served, focus areas, community." />
                </label>
              </fieldset>
            ) : null}
            <fieldset className="onboarding-focus-grid">
              <legend>What should Vantage prioritize for you?</legend>
              {FOCUS_OPTIONS.map((option) => (
                <label key={option.value} className={primaryFocus === option.value ? "selected" : undefined}>
                  <input type="radio" name="primaryFocus" value={option.value} checked={primaryFocus === option.value} onChange={() => setPrimaryFocus(option.value)} />
                  <i>{option.index}</i><strong>{option.label}</strong><span>{option.description}</span>
                </label>
              ))}
            </fieldset>
            <div className="onboarding-actions">
              <button type="button" className="signin-link" onClick={() => setStep("profile")}>Back</button>
              <button className="signin-submit" type="submit" disabled={busy}>{busy ? "Saving…" : "Save and review request"}</button>
            </div>
          </form>
        ) : null}

        {step === "preferences" ? (
          <form className="onboarding-form" onSubmit={(event) => { event.preventDefault(); void finish(); }}>
            <section className="onboarding-review-card" aria-label="Access request summary">
              <div><span>TEAM</span><strong>FRC {teamNumber}</strong></div>
              <div><span>ROLE</span><strong>{ROLES.find((option) => option.value === teamRole)?.label ?? teamRole}</strong></div>
              <div><span>STARTING VIEW</span><strong>{FOCUS_OPTIONS.find((option) => option.value === primaryFocus)?.label}</strong></div>
            </section>
            {primaryFocus === "build" ? (
              <div className="onboarding-security-note" style={{ marginTop: 0 }}>
                <b aria-hidden="true">↳</b>
                <p>
                  <strong>After approval: connect GitHub for AI code context.</strong>
                  <span>
                    {" "}
                    Owners/admins link the robot-code repo under{" "}
                    <a href={githubConnectionHref(state.workspaceOrgId)}>Team → GitHub</a> (OAuth or encrypted PAT).
                  </span>
                </p>
              </div>
            ) : null}
            <label>
              Display name <small>Optional</small>
              <input maxLength={80} placeholder={`${firstName} ${lastName}`.trim()} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <fieldset className="onboarding-theme">
              <legend>Appearance</legend>
              <label className="check-field"><input type="radio" name="theme" checked={themePreference === "light"} onChange={() => setThemePreference("light")} /> Light</label>
              <label className="check-field"><input type="radio" name="theme" checked={themePreference === "dark"} onChange={() => setThemePreference("dark")} /> Dark</label>
            </fieldset>
            {termsNeeded ? (
              <div className="onboarding-terms-block">
                <p className="onboarding-terms-required-label">Required before submit</p>
                <LegalAgreementCheckbox
                  id="onboarding-terms"
                  checked={termsAccepted}
                  onChange={setTermsAccepted}
                  className="onboarding-legal-accept"
                  required
                />
              </div>
            ) : (
              <p className="onboarding-terms-already" role="status">
                <b>✓</b>
                <span>Terms already accepted for this account. You can submit your closed-membership access request.</span>
              </p>
            )}
            <div className="onboarding-security-note">
              <b aria-hidden="true">✓</b>
              <p><strong>Submitting does not grant access.</strong><span>Your verified request goes to a team owner or administrator. Approval creates membership, ends this temporary session, and emails you a fresh sign-in link. Prefer an invite? Use the invitation email instead.</span></p>
            </div>
            <div className="onboarding-actions">
              <button type="button" className="signin-link" onClick={() => setStep("team")}>Back</button>
              <button className="signin-submit" type="submit" disabled={busy || !canSubmit}>{busy ? "Submitting…" : "Submit access request"}</button>
            </div>
          </form>
        ) : null}

        {step === "pending" ? (
          <div className="onboarding-pending-panel">
            <div className={`onboarding-request-status ${state.accessStatus}`}>
              <i aria-hidden="true" />
              <div>
                <span>{state.accessStatus === "declined" ? "REQUEST NEEDS ATTENTION" : state.accessStatus === "invited" ? "INVITATION READY" : "AWAITING TEAM APPROVAL"}</span>
                <strong>{state.workspaceOrgName ?? (state.preferredTeamNumber ? `FRC Team ${state.preferredTeamNumber}` : "Your team workspace")}</strong>
              </div>
            </div>

            <ol className="onboarding-approval-path">
              <li className="done"><b>1</b><div><strong>Profile submitted</strong><span>Your identity and preferences are saved privately.</span></div></li>
              <li className={state.accessStatus === "invited" ? "done" : "current"}><b>2</b><div><strong>Team leader review</strong><span>An owner or administrator confirms you belong in the workspace.</span></div></li>
              <li><b>3</b><div><strong>Secure email handoff</strong><span>Approval ends this onboarding session and sends a link to sign in again.</span></div></li>
            </ol>

            <p className="onboarding-pending-help">
              {state.accessStatus === "declined"
                ? "If you selected the wrong team, update the request and submit it again."
                : "You can close this page. We will not open any team data while the request is pending."}
            </p>
            <div className="onboarding-security-note">
              <b aria-hidden="true">✓</b>
              <p><strong>Your private profile stays private.</strong><span>Team leaders review your verified email, requested role, and focus. They do not receive your birth date or gender.</span></p>
            </div>
            <div className="onboarding-pending-actions">
              {state.accessStatus === "declined" ? <button type="button" className="signin-submit" onClick={() => { setMessage(""); setStep("team"); }}>Update request</button> : <button type="button" className="signin-submit" disabled={checking} onClick={() => void refreshApproval()}>{checking ? "Checking…" : "Check approval status"}</button>}
              <button type="button" className="signin-link" disabled={busy} onClick={() => void signOut()}>Sign out</button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
