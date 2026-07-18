"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { VantageLogo } from "../../components/brand";
import { LegalAgreementCheckbox } from "../../components/legal-agreement-checkbox";
import { PENDING_INVITE_KEY } from "../invite/invite-client";
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

type Step = "profile" | "team" | "preferences" | "pending";

function safeRelativePath(value: string | null | undefined, fallback = "/workspace") {
  if (!value?.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

function pendingInviteDestination() {
  try {
    const token = sessionStorage.getItem(PENDING_INVITE_KEY);
    return token ? `/invite?token=${encodeURIComponent(token)}` : null;
  } catch {
    return null;
  }
}

function approvedDestination(state: OnboardingState, nextParam: string | null) {
  if (nextParam) return safeRelativePath(nextParam);
  // Build & code focus → deep-link Team GitHub connection for robot-code AI context.
  if (state.workspaceOrgId && state.primaryFocus === "build") {
    return `/team?orgId=${encodeURIComponent(state.workspaceOrgId)}#github-connection`;
  }
  // Role / subteam Soft-UI path (CD #28) after profile approval.
  if (state.workspaceOrgId) return `/start?orgId=${encodeURIComponent(state.workspaceOrgId)}`;
  return state.platformAdmin ? "/admin" : "/workspace";
}

function githubConnectionHref(orgId: string | null | undefined) {
  if (!orgId) return "/team#github-connection";
  return `/team?orgId=${encodeURIComponent(orgId)}#github-connection`;
}

export default function OnboardingClient() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [step, setStep] = useState<Step>("profile");
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

  useEffect(() => {
    void fetch("/api/onboarding")
      .then(async (response) => (response.ok ? ((await response.json()) as OnboardingState) : null))
      .then((data) => {
        if (!data) {
          setMessage("Could not load your secure onboarding session.");
          return;
        }
        hydrate(data);
        if (data.complete) routeCompleteState(data);
      })
      .catch(() => setMessage("Could not load onboarding."));
  }, []);

  const locked = state?.lockedTeamNumber != null;
  const setupSteps = useMemo(() => ["profile", "team", "preferences"] as const, []);
  const stepIndex = step === "pending" ? setupSteps.length : setupSteps.indexOf(step);

  async function finish() {
    setBusy(true);
    setMessage("");
    try {
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
          termsAccepted,
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
          <ol className="onboarding-steps onboarding-steps-simple" aria-label="Onboarding progress">
            {["You", "Team & focus", "Review"].map((label, index) => (
              <li key={label} className={index <= stepIndex ? "active" : undefined} aria-current={index === stepIndex ? "step" : undefined}>
                <b>{index + 1}</b><span>{label}</span>
              </li>
            ))}
          </ol>
        ) : null}

        {message ? <p className="onboarding-message" role="status">{message}</p> : null}

        {step === "profile" ? (
          <form className="onboarding-form" onSubmit={(event) => { event.preventDefault(); setMessage(""); setStep("team"); }}>
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
            <button className="signin-submit" type="submit">Continue to team</button>
          </form>
        ) : null}

        {step === "team" ? (
          <form className="onboarding-form" onSubmit={(event) => { event.preventDefault(); setMessage(""); setStep("preferences"); }}>
            <div className={`onboarding-team-lock${locked ? " locked" : ""}`}>
              <label>
                FRC team number
                <input required inputMode="numeric" min={1} max={99999} value={teamNumber} disabled={locked} onChange={(event) => setTeamNumber(event.target.value.replace(/\D/g, "").slice(0, 5))} />
              </label>
              <p>
                {locked
                  ? `${state?.lockedOrgName ?? "Your team"} is already tied to this invitation or request.`
                  : "We use this to route your request to the correct team leaders. It does not unlock the workspace."}
              </p>
            </div>
            <label>
              Your role
              <select value={teamRole} onChange={(event) => setTeamRole(event.target.value)}>
                {ROLES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {state?.isTeamHead ? (
              <fieldset className="onboarding-team-profile">
                <legend>Team location</legend>
                <p className="onboarding-team-profile-hint">
                  Required for owners and admins. Used in sponsorship one-pagers and grant proposals ? this workspace only.
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
                  <textarea maxLength={2000} rows={3} value={orgDescription} onChange={(event) => setOrgDescription(event.target.value)} placeholder="A short blurb about who you are ? students served, focus areas, community." />
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
              <button className="signin-submit" type="submit">Review request</button>
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
                    <a href={githubConnectionHref(state?.workspaceOrgId)}>Team → GitHub</a> (OAuth or encrypted PAT).
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
            <LegalAgreementCheckbox id="onboarding-terms" checked={termsAccepted} onChange={setTermsAccepted} className="onboarding-legal-accept" />
            <div className="onboarding-security-note">
              <b aria-hidden="true">✓</b>
              <p><strong>Submitting does not grant access.</strong><span>Your verified request goes to a team owner or administrator. Approval creates membership, ends this temporary session, and emails you a fresh sign-in link.</span></p>
            </div>
            <div className="onboarding-actions">
              <button type="button" className="signin-link" onClick={() => setStep("team")}>Back</button>
              <button className="signin-submit" type="submit" disabled={busy || !termsAccepted}>{busy ? "Submitting…" : "Submit access request"}</button>
            </div>
          </form>
        ) : null}

        {step === "pending" ? (
          <div className="onboarding-pending-panel">
            <div className={`onboarding-request-status ${state?.accessStatus ?? "pending"}`}>
              <i aria-hidden="true" />
              <div>
                <span>{state?.accessStatus === "declined" ? "REQUEST NEEDS ATTENTION" : state?.accessStatus === "invited" ? "INVITATION READY" : "AWAITING TEAM APPROVAL"}</span>
                <strong>{state?.workspaceOrgName ?? (state?.preferredTeamNumber ? `FRC Team ${state.preferredTeamNumber}` : "Your team workspace")}</strong>
              </div>
            </div>

            <ol className="onboarding-approval-path">
              <li className="done"><b>1</b><div><strong>Profile submitted</strong><span>Your identity and preferences are saved privately.</span></div></li>
              <li className={state?.accessStatus === "invited" ? "done" : "current"}><b>2</b><div><strong>Team leader review</strong><span>An owner or administrator confirms you belong in the workspace.</span></div></li>
              <li><b>3</b><div><strong>Secure email handoff</strong><span>Approval ends this onboarding session and sends a link to sign in again.</span></div></li>
            </ol>

            <p className="onboarding-pending-help">
              {state?.accessStatus === "declined"
                ? "If you selected the wrong team, update the request and submit it again."
                : "You can close this page. We will not open any team data while the request is pending."}
            </p>
            <div className="onboarding-pending-actions">
              {state?.accessStatus === "declined" ? <button type="button" className="signin-submit" onClick={() => { setMessage(""); setStep("team"); }}>Update request</button> : <button type="button" className="signin-submit" disabled={checking} onClick={() => void refreshApproval()}>{checking ? "Checking…" : "Check approval status"}</button>}
              <button type="button" className="signin-link" disabled={busy} onClick={() => void signOut()}>Sign out</button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
