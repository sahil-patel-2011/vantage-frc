"use client";

import { LegalAgreementCheckbox } from "../../components/legal-agreement-checkbox";
import { legalConsentMessage } from "../../lib/legal";
import {
  sanitizeTeamNumberInput,
  type OnboardingCrew,
  type OnboardingDraft,
  type OnboardingGender,
  type OnboardingRole,
  type TeamLookupResult,
} from "../../lib/onboarding";
import { FundingFields } from "./onboarding-funding";
import {
  CREW_ROLES,
  FOCUS_OPTIONS,
  GENDERS,
  ROLES,
  githubConnectionHref,
  type OnboardingState,
} from "./onboarding-model";

/** The one id an error note carries, so the field it is about can point at it. */
export const ONBOARDING_ERROR_ID = "onboarding-error";

/** Under the field it is about, when Continue stopped on that field. */
function FieldError({ field, errorField, message }: { field: string; errorField: string | null; message: string }) {
  if (!message || errorField !== field) return null;
  return <p id={ONBOARDING_ERROR_ID} className="onboarding-field-error" role="alert">{message}</p>;
}

/**
 * Just above the step's buttons, for anything no field on this screen shows: a lost connection,
 * a server fault. It used to sit at the top of the card, a screen above Continue on a phone, so
 * the press looked like it did nothing.
 */
function FormError({ message, errorField, inPlace }: { message: string; errorField: string | null; inPlace: string[] }) {
  if (!message || (errorField && inPlace.includes(errorField))) return null;
  return <p id={ONBOARDING_ERROR_ID} className="onboarding-message invalid onboarding-form-error" role="alert">{message}</p>;
}

/** aria props for a field that may be the one Continue stopped on. */
function invalidProps(field: string, errorField: string | null) {
  return errorField === field ? { "aria-invalid": true as const, "aria-describedby": ONBOARDING_ERROR_ID } : {};
}

const PROFILE_FIELDS = ["firstName", "lastName", "teamRole", "dateOfBirth", "gender"];

const THEME_CHOICES: Array<{ value: OnboardingDraft["themePreference"]; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System (follows your device)" },
];

export function ProfileForm({
  draft,
  patch,
  errorField,
  message,
  busy,
  pickRole,
  pickCrew,
  onSubmit,
}: {
  draft: OnboardingDraft;
  patch: (next: Partial<OnboardingDraft>) => void;
  errorField: string | null;
  message: string;
  busy: boolean;
  pickRole: (value: OnboardingRole) => void;
  pickCrew: (value: OnboardingCrew | "") => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="onboarding-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
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
            {...invalidProps("firstName", errorField)}
          />
          <FieldError field="firstName" errorField={errorField} message={message} />
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
            {...invalidProps("lastName", errorField)}
          />
          <FieldError field="lastName" errorField={errorField} message={message} />
        </label>
      </div>

      <fieldset className="onboarding-cards onboarding-cards-role">
        <legend>What are you on the team?</legend>
        {ROLES.map((option) => (
          <label key={option.value} className={draft.teamRole === option.value ? "selected" : undefined}>
            <input
              type="radio"
              name="teamRole"
              value={option.value}
              checked={draft.teamRole === option.value}
              onChange={() => pickRole(option.value)}
              // Nothing is picked for you; Continue points here until a card is chosen.
              {...invalidProps("teamRole", errorField)}
            />
            <strong>{option.label}</strong>
            <span>{option.detail}</span>
          </label>
        ))}
      </fieldset>
      <FieldError field="teamRole" errorField={errorField} message={message} />

      <details className="onboarding-specialty">
        <summary>
          <span>
            <strong>Team specialty</strong>
            <small>{draft.crewRole ? CREW_ROLES.find((option) => option.value === draft.crewRole)?.label : "Optional"}</small>
          </span>
          <b aria-hidden="true">+</b>
        </summary>
        {/* One answer, so radios: these were checkboxes that unticked each other, which a screen
            reader announced as "checkbox" and people read as "pick several". */}
        <fieldset className="onboarding-cards onboarding-cards-crew">
          <legend className="sr-only">Choose your team specialty</legend>
          {[...CREW_ROLES, { value: "" as const, label: "Not sure yet", detail: "Pick one later in Account" }].map((option) => (
            <label key={option.value || "none"} className={draft.crewRole === option.value ? "selected" : undefined}>
              <input
                type="radio"
                name="crewRole"
                value={option.value}
                checked={draft.crewRole === option.value}
                onChange={() => pickCrew(option.value)}
              />
              <strong>{option.label}</strong>
              <span>{option.detail}</span>
            </label>
          ))}
        </fieldset>
      </details>

      <fieldset className="onboarding-account-fields">
        <legend>Only you can see this</legend>
        <p className="onboarding-team-profile-hint">
          Both stay on your account: teammates and team leaders never see them. Your birthday tells Vantage whether this is a student account, which gets extra protections.
        </p>
        <label>
          <span>Date of birth <small className="onboarding-required">Required</small></span>
          <input
            required
            type="date"
            value={draft.dateOfBirth}
            onChange={(event) => patch({ dateOfBirth: event.target.value })}
            autoComplete="bday"
            {...invalidProps("dateOfBirth", errorField)}
          />
          <FieldError field="dateOfBirth" errorField={errorField} message={message} />
        </label>
        <label>
          {/* "Prefer not to say" is a full answer: nobody has to tell us. */}
          <span>Gender <small>Optional</small></span>
          <select
            value={draft.gender}
            onChange={(event) => patch({ gender: event.target.value as OnboardingGender })}
            {...invalidProps("gender", errorField)}
          >
            {GENDERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <FieldError field="gender" errorField={errorField} message={message} />
        </label>
      </fieldset>

      <FormError message={message} errorField={errorField} inPlace={PROFILE_FIELDS} />
      {/* No spacer before Continue: its gap left the button 12px narrower than the fields above. */}
      <div className="onboarding-actions">
        <button className="signin-submit" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Continue"}
        </button>
      </div>
    </form>
  );
}

export function TeamForm({
  draft,
  patch,
  lookup,
  locked,
  busy,
  isTeamHead,
  errorField,
  errorMessage,
  onFocusTouch,
  onBack,
  onSubmit,
}: {
  draft: OnboardingDraft;
  patch: (next: Partial<OnboardingDraft>) => void;
  lookup: TeamLookupResult;
  locked: boolean;
  busy: boolean;
  isTeamHead: boolean;
  errorField?: string | null;
  errorMessage?: string;
  onFocusTouch: () => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="onboarding-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {locked ? (
        // The invite already set the team: a greyed-out number field asked the owner to check
        // something they could not change.
        <p className="onboarding-team-confirmed" role="status">
          <strong>{lookup.title}</strong>
          <span>Your invite set the team.</span>
        </p>
      ) : (
      <div className="onboarding-team-lock">
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
            aria-invalid={lookup.ok && errorField !== "teamNumber" ? undefined : true}
            aria-describedby={errorField === "teamNumber" && errorMessage !== lookup.body ? `onboarding-team-lookup ${ONBOARDING_ERROR_ID}` : "onboarding-team-lookup"}
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
      )}

      <fieldset className="onboarding-focus-grid" aria-describedby="onboarding-focus-hint">
        <legend>What will you spend most of your time on?</legend>
        <p id="onboarding-focus-hint" className="onboarding-focus-hint">Your Home opens on the tools for it. Everything else is still one tap away.</p>
        {FOCUS_OPTIONS.map((option) => (
          <label key={option.value} className={draft.primaryFocus === option.value ? "selected" : undefined}>
            <input
              type="radio"
              name="primaryFocus"
              value={option.value}
              checked={draft.primaryFocus === option.value}
              onChange={() => {
                onFocusTouch();
                patch({ primaryFocus: option.value });
              }}
            />
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </label>
        ))}
      </fieldset>

      <details className="onboarding-specialty onboarding-role-note" open={draft.roleDescription.trim() ? true : undefined}>
        <summary>
          <span>
            <strong>Describe your role</strong>
            <small>Optional</small>
          </span>
          <b aria-hidden="true">+</b>
        </summary>
      <label>
        <span className="sr-only">Describe your role</span>
        <small>Up to 280 characters</small>
        <textarea
          maxLength={280}
          rows={3}
          value={draft.roleDescription}
          onChange={(event) => patch({ roleDescription: event.target.value })}
          placeholder="Scout stand, drive team operator, CAD lead, pit repair, business outreach…"
        />
      </label>
      </details>

      {isTeamHead ? <FundingFields draft={draft} patch={patch} errorField={errorField} errorMessage={errorMessage} /> : null}

      <FormError
        message={errorMessage ?? ""}
        errorField={errorField ?? null}
        // The team-number check already says the same thing under the field.
        inPlace={["teamAffiliation", "funding", ...(errorMessage === lookup.body ? ["teamNumber"] : [])]}
      />
      <div className="onboarding-actions">
        <button type="button" className="signin-link" onClick={onBack}>Back</button>
        <button className="signin-submit" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Continue"}
        </button>
      </div>
    </form>
  );
}

export function PreferencesForm({
  draft,
  patch,
  state,
  lookup,
  errorField,
  message,
  onThemeChange,
  legalNeeded,
  legalError,
  setLegalError,
  canSubmit,
  busy,
  onBack,
  onSubmit,
}: {
  draft: OnboardingDraft;
  patch: (next: Partial<OnboardingDraft>) => void;
  state: OnboardingState;
  lookup: TeamLookupResult;
  errorField: string | null;
  message: string;
  /** Applies the theme on this device at once; Finish saves it to the account. */
  onThemeChange: (value: OnboardingDraft["themePreference"]) => void;
  legalNeeded: boolean;
  legalError: string | null;
  setLegalError: (message: string | null) => void;
  canSubmit: boolean;
  busy: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  // The owner the platform set this team up for is not joining someone else's team.
  const owner = state.workspaceRole === "owner" && (lookup.invited || lookup.joined);
  return (
    <form
      className="onboarding-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {/* A summary list, label on the left and answer on the right, like a settings screen. */}
      <dl className="onboarding-review-card onboarding-review-list" aria-label="Your answers">
        <div><dt>Team</dt><dd>{lookup.teamNumber ? `FRC ${lookup.teamNumber}` : "None yet"}</dd></div>
        <div><dt>Role</dt><dd>{ROLES.find((option) => option.value === draft.teamRole)?.label ?? draft.teamRole}</dd></div>
        <div><dt>Specialty</dt><dd>{CREW_ROLES.find((option) => option.value === draft.crewRole)?.label ?? "Not sure yet"}</dd></div>
        <div><dt>Home opens on</dt><dd>{FOCUS_OPTIONS.find((option) => option.value === draft.primaryFocus)?.label}</dd></div>
        {draft.roleDescription.trim() ? (
          <div><dt>About your role</dt><dd>{draft.roleDescription.trim()}</dd></div>
        ) : null}
      </dl>

      {state.isTeamHead ? (
        <fieldset className="onboarding-team-profile">
          <legend>
            Team location <small>Optional</small>
          </legend>
          <p className="onboarding-team-profile-hint">
            Used in sponsorship one-pagers and grant proposals, this team only. You can add it later on Team profile.
          </p>
          <div className="onboarding-row">
            <label>
              City
              <input
                maxLength={120}
                value={draft.orgCity}
                onChange={(event) => patch({ orgCity: event.target.value })}
                autoComplete="address-level2"
                placeholder="e.g. Atlanta"
                aria-invalid={errorField === "orgCity" || undefined}
              />
            </label>
            <label>
              State / province
              <input
                maxLength={80}
                value={draft.orgStateProv}
                onChange={(event) => patch({ orgStateProv: event.target.value })}
                autoComplete="address-level1"
                placeholder="e.g. GA"
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
            <strong>After your team lets you in, connect the robot code.</strong>
            <span>
              {" "}A team owner links the GitHub repo under{" "}
              <a href={githubConnectionHref(state.workspaceOrgId)}>Team, then GitHub</a>
              {" "}so the code helper can read it.
            </span>
          </p>
        </div>
      ) : null}

      <details className="onboarding-optional">
        <summary data-disclosure>Display name and appearance <small>Optional — change any time in Account</small></summary>
        <label>
          Display name
          <input
            maxLength={80}
            placeholder={`${draft.firstName} ${draft.lastName}`.trim()}
            value={draft.displayName}
            onChange={(event) => patch({ displayName: event.target.value })}
          />
        </label>
        {/* The same three choices as Account › Appearance, applied the moment one is picked. */}
        <fieldset className="onboarding-theme">
          <legend>Appearance</legend>
          {THEME_CHOICES.map((choice) => (
            <label key={choice.value} className="check-field">
              <input
                type="radio"
                name="theme"
                value={choice.value}
                checked={draft.themePreference === choice.value}
                onChange={() => onThemeChange(choice.value)}
              />{" "}
              {choice.label}
            </label>
          ))}
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
          <strong>
            {owner
              ? `You're the owner of ${lookup.title}.`
              : lookup.joined
              ? "You are already on this team."
              : lookup.invited
                ? `You're joining ${lookup.title}.`
                : lookup.teamNumber
                  ? "Finishing sends a request"
                  : "Finish without a team"}
          </strong>
          <span>
            {owner
              ? " Finishing opens the team. Home then walks you through inviting everyone."
              : lookup.joined
              ? " Finishing saves your profile and opens Home on what to do first."
              : lookup.invited
                ? " The team invited this email, so finishing puts you straight on it."
                : lookup.teamNumber
                ? ` Team ${lookup.teamNumber}'s owners decide who joins. If the team isn't on Vantage yet, the Vantage team reviews it instead.`
                : " You are not joining anyone. An invite or a later team-number request still needs that team's approval."}
          </span>
        </p>
      </div>

      <FormError message={message} errorField={errorField} inPlace={["legal"]} />
      <div className="onboarding-actions">
        <button type="button" className="signin-link" onClick={onBack}>Back</button>
        <button className="signin-submit" type="submit" disabled={busy || !canSubmit}>
          {/* Says what is happening while the team opens (it could take a while with no sign). */}
          {busy
            ? owner || lookup.joined || lookup.invited
              ? "Opening your team…"
              : "Sending…"
            : owner
              ? "Finish and open the team"
              : lookup.joined
              ? "Finish and open Home"
              : lookup.invited
                ? `Join ${lookup.title}`
                : lookup.teamNumber
                  ? "Send request"
                  : "Finish without a team"}
        </button>
      </div>
      {busy ? (
        <p className="onboarding-busy" role="status">
          {owner ? "Setting up your team. The first time can take up to a minute; keep this page open." : "Saving your answers…"}
        </p>
      ) : null}
    </form>
  );
}
