"use client";

import { useState } from "react";
import { buildOnboardingPendingPlan } from "../../lib/onboarding";
import type { OnboardingState } from "./onboarding-model";

export function PendingPanel({
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
        <PendingPrimaryAction
          kind={plan.primaryAction.kind}
          label={plan.primaryAction.label}
          checking={checking}
          orgId={state.workspaceOrgId}
          onCheck={onCheck}
          onEdit={onEdit}
        />
        {plan.primaryAction.kind === "join" ? null : <a className="signin-link" href="/invite">Have an invite?</a>}
        <button type="button" className="signin-link" disabled={busy} onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

/** One tap joins the team that invited this email (POST /api/invites/accept-mine). */
function JoinTeamButton({ orgId, label }: { orgId: string | null; label: string }) {
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const join = async () => {
    if (!orgId) return;
    setJoining(true);
    setError("");
    try {
      const response = await fetch("/api/invites/accept-mine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const data = (await response.json().catch(() => ({}))) as { orgId?: string; error?: string };
      if (!response.ok || !data.orgId) {
        setError(data.error ?? "Couldn't join the team. Try again.");
        return;
      }
      window.location.assign(`/dashboard?orgId=${encodeURIComponent(data.orgId)}`);
    } catch {
      setError("Couldn't reach Vantage. Check your connection and try again.");
    } finally {
      setJoining(false);
    }
  };
  return (
    <>
      <button type="button" className="signin-submit" disabled={joining || !orgId} onClick={() => void join()}>
        {joining ? "Joining…" : label}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}

function PendingPrimaryAction({
  kind,
  label,
  checking,
  orgId,
  onCheck,
  onEdit,
}: {
  kind: "check" | "edit" | "invite" | "claim" | "join";
  label: string;
  checking: boolean;
  orgId: string | null;
  onCheck: () => void;
  onEdit: () => void;
}) {
  switch (kind) {
    case "join":
      return <JoinTeamButton orgId={orgId} label={label} />;
    case "check":
      return (
        <button type="button" className="signin-submit" disabled={checking} onClick={onCheck}>
          {checking ? "Checking…" : label}
        </button>
      );
    case "invite":
      return (
        <a className="signin-submit" href="/invite">{label}</a>
      );
    case "claim":
      return (
        <a className="signin-submit" href="/claim">{label}</a>
      );
    case "edit":
      return (
        <button type="button" className="signin-submit" onClick={onEdit}>{label}</button>
      );
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
