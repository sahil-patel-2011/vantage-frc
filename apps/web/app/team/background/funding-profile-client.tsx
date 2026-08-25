"use client";

import { useEffect, useState } from "react";
import { EmptyState, Panel } from "../../../components/ui";
import {
  FUNDING_AFFILIATION_LABELS,
  FUNDING_AFFILIATION_OPTIONS,
  type FundingAffiliation,
  type FundingProfileView,
} from "../../../lib/funding-profile";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";

type Draft = {
  teamAffiliation: FundingAffiliation;
  schoolFunded: boolean;
  outsideGrants: boolean;
  sponsorsAllowed: boolean;
};

const DEFAULT_DRAFT: Draft = {
  teamAffiliation: "community",
  schoolFunded: false,
  outsideGrants: false,
  sponsorsAllowed: true,
};

export default function FundingProfileClient({ orgId }: { orgId: string }) {
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "error">("ok");
  const [loadFailed, setLoadFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    const response = await fetch(
      `/api/organizations/funding-profile?orgId=${encodeURIComponent(orgId)}`,
    );
    const data = (await response.json()) as FundingProfileView | { error?: string };
    if (!response.ok || !("orgId" in data)) {
      setMessage("error" in data && data.error ? data.error : "Could not load funding profile");
      setMessageTone("error");
      setErrorStatus(response.status);
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    setErrorStatus(null);
    setCanEdit(data.canEdit);
    setDraft({
      teamAffiliation: data.teamAffiliation,
      schoolFunded: data.schoolFunded,
      outsideGrants: data.outsideGrants,
      sponsorsAllowed: data.sponsorsAllowed,
    });
    setMessage("");
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit || saving) return;
    setSaving(true);
    setMessage("");
    const response = await fetch("/api/organizations/funding-profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, ...draft }),
    });
    const data = (await response.json()) as { success?: boolean; error?: string };
    if (!response.ok) {
      setMessage(data.error ?? "Could not save funding profile");
      setMessageTone("error");
      setSaving(false);
      return;
    }
    setMessage(
      draft.sponsorsAllowed
        ? "Funding profile saved. Sponsor tools stay visible in Soft-UI."
        : "Funding profile saved. Sponsor tools are hidden for this workspace.",
    );
    setMessageTone("ok");
    setSaving(false);
  }

  const failure = loadFailed
    ? loadFailureCopy(
        classifyLoadFailure({
          status: errorStatus,
          message,
          online: typeof navigator === "undefined" ? true : navigator.onLine,
        }),
        {
          nextPath:
            typeof window === "undefined"
              ? null
              : `${window.location.pathname}${window.location.search}`,
          message,
        },
      )
    : null;

  return (
    <Panel className="team-funding-profile-panel">
      <div className="team-funding-profile-header">
        <div>
          <span className="eyebrow">Business Soft-UI</span>
          <h2>Affiliation &amp; funding</h2>
        </div>
      </div>
      <p className="app-muted">
        Same fields as onboarding. When Sponsors allowed is off, Business tabs and drawer links for sponsor tools stay
        hidden — grants and Media remain available.
      </p>
      {message && !failure ? (
        <p className={messageTone === "error" ? "status-bad" : "status-good"} role="status">
          {message}
        </p>
      ) : null}
      {loading ? (
        <EmptyState soft title="Loading funding profile…" description="Pulling affiliation and funding paths." />
      ) : failure ? (
        <EmptyState soft title={failure.title} description={failure.description}>
          {failure.primary ? (
            <a className="app-button" href={failure.primary.href}>
              {failure.primary.label}
            </a>
          ) : null}
          {failure.showRetry ? (
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
      ) : (
        <form className="auth-policy-form" onSubmit={(event) => void save(event)}>
          <fieldset className="onboarding-affiliation">
            <legend>Affiliation</legend>
            {FUNDING_AFFILIATION_OPTIONS.map((value) => (
              <label key={value} className="check-field">
                <input
                  type="radio"
                  name="teamAffiliation"
                  value={value}
                  checked={draft.teamAffiliation === value}
                  disabled={!canEdit}
                  onChange={() => setDraft((prev) => ({ ...prev, teamAffiliation: value }))}
                />
                {FUNDING_AFFILIATION_LABELS[value]}
              </label>
            ))}
          </fieldset>
          {draft.teamAffiliation === "private_school" ? (
            <p className="app-muted">
              Many private schools self-fund and disallow outside sponsors. Uncheck Sponsors allowed if that matches
              your school.
            </p>
          ) : null}
          <fieldset className="onboarding-funding-paths">
            <legend>
              Funding paths <small>Select at least one</small>
            </legend>
            <label className="check-field">
              <input
                type="checkbox"
                checked={draft.schoolFunded}
                disabled={!canEdit}
                onChange={(event) => setDraft((prev) => ({ ...prev, schoolFunded: event.target.checked }))}
              />
              School funds
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={draft.outsideGrants}
                disabled={!canEdit}
                onChange={(event) => setDraft((prev) => ({ ...prev, outsideGrants: event.target.checked }))}
              />
              Outside grants
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={draft.sponsorsAllowed}
                disabled={!canEdit}
                onChange={(event) => setDraft((prev) => ({ ...prev, sponsorsAllowed: event.target.checked }))}
              />
              Sponsors allowed
            </label>
          </fieldset>
          {canEdit ? (
            <button type="submit" className="app-button" disabled={saving}>
              {saving ? "Saving…" : "Save funding profile"}
            </button>
          ) : (
            <p className="app-muted">View only — ask an owner or admin to change funding paths.</p>
          )}
        </form>
      )}
    </Panel>
  );
}
