"use client";

import {
  flagsFromFundingModel,
  FUNDING_MODEL_LABELS,
  FUNDING_MODEL_OPTIONS,
} from "../../lib/funding-profile";
import type { OnboardingDraft } from "../../lib/onboarding";
import { AFFILIATIONS } from "./onboarding-model";

export function FundingFields({
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
        Required for owners and admins. This decides which Business tools you see — a school that cannot have
        sponsors will not see sponsor pages.
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
          Many private schools pay for the team themselves and cannot have sponsors. Pick that option below if it
          matches your school.
        </p>
      ) : null}
      <fieldset className="onboarding-funding-paths">
        <legend>How is the team funded?</legend>
        {FUNDING_MODEL_OPTIONS.map((value) => (
          <label key={value} className="check-field">
            <input
              type="radio"
              name="fundingModel"
              value={value}
              checked={draft.fundingModel === value}
              onChange={() =>
                patch({
                  fundingModel: value,
                  ...flagsFromFundingModel(value),
                })
              }
            />
            {FUNDING_MODEL_LABELS[value]}
          </label>
        ))}
      </fieldset>
    </fieldset>
  );
}
