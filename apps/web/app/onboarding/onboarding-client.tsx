"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { VantageLogo } from "../../components/brand";
import { PENDING_INVITE_KEY } from "../invite/invite-client";

type OnboardingState = {
  complete: boolean;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  preferredTeamNumber: number | null;
  teamRole: string | null;
  displayName: string | null;
  themePreference: "light" | "dark";
  lockedTeamNumber: number | null;
  lockedOrgName: string | null;
  canCreateOrg: boolean;
  platformAdmin: boolean;
};

const GENDERS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
  { value: "other", label: "Other" },
] as const;

const ROLES = [
  { value: "student", label: "Student" },
  { value: "mentor", label: "Mentor" },
  { value: "coach", label: "Coach" },
  { value: "parent", label: "Parent / guardian" },
  { value: "other", label: "Other" },
] as const;

type Step = "about" | "team" | "preferences" | "done";

function safeRelativePath(value: string | null | undefined, fallback = "/dashboard") {
  if (!value?.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

function resolvePostOnboardingDestination(nextParam: string | null) {
  if (nextParam) return safeRelativePath(nextParam);
  try {
    const pending = sessionStorage.getItem(PENDING_INVITE_KEY);
    if (pending) return `/invite?token=${encodeURIComponent(pending)}`;
  } catch {
    // ignore
  }
  return "/dashboard";
}

export default function OnboardingClient() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [step, setStep] = useState<Step>("about");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("prefer_not_to_say");
  const [teamNumber, setTeamNumber] = useState("");
  const [teamRole, setTeamRole] = useState("student");
  const [displayName, setDisplayName] = useState("");
  const [themePreference, setThemePreference] = useState<"light" | "dark">("light");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/onboarding")
      .then(async (response) => (response.ok ? ((await response.json()) as OnboardingState) : null))
      .then((data) => {
        if (!data) return;
        if (data.complete) {
          window.location.assign(resolvePostOnboardingDestination(searchParams.get("next")));
          return;
        }
        setState(data);
        setFirstName(data.firstName ?? "");
        setLastName(data.lastName ?? "");
        setDateOfBirth(data.dateOfBirth ?? "");
        setGender(data.gender ?? "prefer_not_to_say");
        setTeamNumber(String(data.lockedTeamNumber ?? data.preferredTeamNumber ?? ""));
        setTeamRole(data.teamRole ?? "student");
        setDisplayName(data.displayName ?? "");
        setThemePreference(data.themePreference ?? "light");
      })
      .catch(() => setMessage("Could not load onboarding."));
  }, []);

  const locked = state?.lockedTeamNumber != null;
  const steps = useMemo(() => ["about", "team", "preferences", "done"] as const, []);
  const stepIndex = steps.indexOf(step);

  async function finish() {
    setBusy(true);
    setMessage("");
    try {
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
          displayName: displayName.trim() || undefined,
          themePreference,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not save onboarding.");
        return;
      }
      setStep("done");
      window.setTimeout(
        () => window.location.assign(resolvePostOnboardingDestination(searchParams.get("next"))),
        900,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="onboarding-page">
      <section className="onboarding-card" aria-labelledby="onboarding-title">
        <div className="onboarding-brand">
          <VantageLogo />
        </div>
        <h1 id="onboarding-title">Welcome to Vantage</h1>
        <p className="onboarding-sub">A short setup so your home dashboard greets you correctly. Date of birth stays private.</p>

        <ol className="onboarding-steps" aria-label="Onboarding progress">
          {["About you", "Team", "Preferences", "Done"].map((label, index) => (
            <li key={label} className={index <= stepIndex ? "active" : undefined} aria-current={index === stepIndex ? "step" : undefined}>
              <b>{index + 1}</b>
              <span>{label}</span>
            </li>
          ))}
        </ol>

        {message ? (
          <p className="signin-status" role="status">
            {message}
          </p>
        ) : null}

        {step === "about" ? (
          <form
            className="onboarding-form"
            onSubmit={(event) => {
              event.preventDefault();
              setStep("team");
            }}
          >
            <div className="onboarding-row">
              <label>
                First name
                <input required maxLength={60} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
              </label>
              <label>
                Last name
                <input required maxLength={60} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
              </label>
            </div>
            <label>
              Date of birth
              <input required type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} autoComplete="bday" />
              <small>Required for youth-safe account records. Never shown on public or team directories.</small>
            </label>
            <label>
              Gender
              <select required value={gender} onChange={(e) => setGender(e.target.value)}>
                {GENDERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="signin-submit" type="submit">
              Continue
            </button>
          </form>
        ) : null}

        {step === "team" ? (
          <form
            className="onboarding-form"
            onSubmit={(event) => {
              event.preventDefault();
              setStep("preferences");
            }}
          >
            <label>
              FRC team number
              <input
                required
                inputMode="numeric"
                min={1}
                max={99999}
                value={teamNumber}
                disabled={locked}
                onChange={(e) => setTeamNumber(e.target.value.replace(/\D/g, "").slice(0, 5))}
              />
              {locked ? (
                <small>
                  Locked to {state?.lockedOrgName ?? "your invite"} (team {state?.lockedTeamNumber}).
                </small>
              ) : state?.canCreateOrg ? (
                <small>As platform owner you can note a team number here; create the org from Admin when ready.</small>
              ) : (
                <small>Used to personalize setup. Joining a workspace still requires an invite.</small>
              )}
            </label>
            <label>
              Role at the team (optional)
              <select value={teamRole} onChange={(e) => setTeamRole(e.target.value)}>
                {ROLES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="onboarding-actions">
              <button type="button" className="signin-link" onClick={() => setStep("about")}>
                Back
              </button>
              <button className="signin-submit" type="submit">
                Continue
              </button>
            </div>
          </form>
        ) : null}

        {step === "preferences" ? (
          <form
            className="onboarding-form"
            onSubmit={(event) => {
              event.preventDefault();
              void finish();
            }}
          >
            <label>
              Display name (optional)
              <input
                maxLength={80}
                placeholder={`${firstName} ${lastName}`.trim()}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
            <fieldset className="onboarding-theme">
              <legend>Theme preference</legend>
              <label className="check-field">
                <input type="radio" name="theme" checked={themePreference === "light"} onChange={() => setThemePreference("light")} />
                Light
              </label>
              <label className="check-field">
                <input type="radio" name="theme" checked={themePreference === "dark"} onChange={() => setThemePreference("dark")} />
                Dark
              </label>
            </fieldset>
            <div className="onboarding-actions">
              <button type="button" className="signin-link" onClick={() => setStep("team")}>
                Back
              </button>
              <button className="signin-submit" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Finish setup"}
              </button>
            </div>
          </form>
        ) : null}

        {step === "done" ? (
          <div className="onboarding-done">
            <p role="status">You are set. Opening your dashboard…</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
