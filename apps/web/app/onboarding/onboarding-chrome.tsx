"use client";

import { VantageLogo } from "../../components/brand";
import type { OnboardingLoadCopy } from "../../lib/onboarding";

export function OnboardingLoadShell({
  copy,
  membershipTitle,
  membershipBody,
  onRetry,
}: {
  copy: OnboardingLoadCopy;
  membershipTitle: string;
  membershipBody: string;
  onRetry: () => void;
}) {
  return (
    <main className="onboarding-page onboarding-flow-page">
      <section
        className="onboarding-card onboarding-flow-card"
        aria-labelledby="onboarding-load-title"
        aria-busy={copy.kind === "loading"}
      >
        <header className="onboarding-flow-header">
          <div className="onboarding-brand"><VantageLogo /></div>
          <span>{copy.eyebrow}</span>
          <h1 id="onboarding-load-title">{copy.title}</h1>
          <p className="onboarding-sub">{copy.description}</p>
        </header>
        <div className={`onboarding-load-shell${copy.kind === "loading" ? " loading" : ""}`}>
          {copy.badge ? (
            <span className={`onboarding-load-badge${copy.kind === "setup_required" ? " setup" : ""}`}>
              {copy.badge}
            </span>
          ) : null}
          <p className="onboarding-membership-blurb">
            <strong>{membershipTitle}</strong>
            <span>{membershipBody}</span>
          </p>
          {copy.kind === "error" || copy.kind === "setup_required" ? (
            <div className="onboarding-pending-actions">
              {copy.kind === "error" ? (
                <button type="button" className="signin-submit" onClick={onRetry}>Try again</button>
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
