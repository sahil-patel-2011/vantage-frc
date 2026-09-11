"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, Panel, Button } from "../../../components/ui";
import {
  FUNDING_AFFILIATION_LABELS,
  FUNDING_AFFILIATION_OPTIONS,
  FUNDING_MODEL_LABELS,
  FUNDING_MODEL_OPTIONS,
  flagsFromFundingModel,
  isFundingModel,
  type FundingAffiliation,
  type FundingModel,
  type FundingProfileView,
} from "../../../lib/funding-profile";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";

type Draft = {
  teamAffiliation: FundingAffiliation;
  fundingModel: FundingModel;
  schoolFunded: boolean;
  outsideGrants: boolean;
  sponsorsAllowed: boolean;
};

const DEFAULT_DRAFT: Draft = {
  teamAffiliation: "community",
  fundingModel: "self_funded",
  schoolFunded: false,
  outsideGrants: true,
  sponsorsAllowed: false,
};

function isFundingProfileView(value: unknown): value is FundingProfileView {
  if (!value || typeof value !== "object") return false;
  const row = value as { orgId?: unknown; teamAffiliation?: unknown };
  return typeof row.orgId === "string" && typeof row.teamAffiliation === "string";
}

function draftFromView(data: FundingProfileView): Draft {
  return {
    teamAffiliation: data.teamAffiliation,
    fundingModel: isFundingModel(data.fundingModel) ? data.fundingModel : "self_funded",
    schoolFunded: data.schoolFunded,
    outsideGrants: data.outsideGrants,
    sponsorsAllowed: data.sponsorsAllowed,
  };
}

async function persistFundingProfileSnapshot(orgId: string, data: FundingProfileView): Promise<void> {
  const cacheOrg = data.orgId.trim() || orgId;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("funding-profile", cacheOrg, data);
  } catch {
    // Live funding profile already painted; IndexedDB is best-effort.
  }
}

export default function FundingProfileClient({ orgId }: { orgId: string }) {
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "error">("ok");
  const [loadFailed, setLoadFailed] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const readyRef = useRef(false);
  readyRef.current = ready;

  const load = useCallback(async () => {
    let hadCache = readyRef.current;
    try {
      const cached = await getFeatureSnapshot<FundingProfileView>("funding-profile", orgId);
      if (!readyRef.current && cached?.data && isFundingProfileView(cached.data)) {
        setDraft(draftFromView(cached.data));
        setCanEdit(cached.data.canEdit);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        setReady(true);
        hadCache = true;
        setLoading(false);
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setLoadFailed(false);
    try {
      const response = await fetch(
        `/api/organizations/funding-profile?orgId=${encodeURIComponent(orgId)}`,
        { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
      );
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setReady(false);
        setFromCache(false);
        setCachedAt(null);
        setMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load funding profile",
        );
        setMessageTone("error");
        setErrorStatus(response.status);
        setLoadFailed(true);
        return;
      }
      if (!response.ok || !isFundingProfileView(data)) {
        if (hadCache || readyRef.current) {
          setFromCache(true);
          return;
        }
        setMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load funding profile",
        );
        setMessageTone("error");
        setErrorStatus(response.status);
        setLoadFailed(true);
        return;
      }
      setErrorStatus(null);
      setCanEdit(data.canEdit);
      setDraft(draftFromView(data));
      setMessage("");
      setReady(true);
      setFromCache(false);
      setCachedAt(null);
      await persistFundingProfileSnapshot(orgId, data);
    } catch {
      if (hadCache || readyRef.current) {
        setFromCache(true);
        return;
      }
      setMessage("Could not load funding profile");
      setMessageTone("error");
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

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
        ? "Funding profile saved. Sponsor tools stay visible."
        : "Funding profile saved. Sponsor tools are hidden for this team.",
    );
    setMessageTone("ok");
    setSaving(false);
  }

  const failure = loadFailed && !ready
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
          <span className="eyebrow">Business</span>
          <h2>Affiliation &amp; funding</h2>
        </div>
      </div>
      <p className="app-muted">
        Same fields as onboarding. When Sponsors allowed is off, Business tabs and drawer links for sponsor tools stay
        hidden — grants and Media remain available.
      </p>
      <OfflineBanner feature="Funding profile" fromCache={fromCache} cachedAt={cachedAt} />
      {message && !failure ? (
        <p className={messageTone === "error" ? "status-bad" : "status-good"} role="status">
          {message}
        </p>
      ) : null}
      {loading && !ready ? (
        <EmptyState soft title="Loading funding profile…" description="Pulling affiliation and funding paths." />
      ) : failure ? (
        <EmptyState soft title={failure.title} description={failure.description}>
          {failure.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : failure.showRetry ? (
            <Button variant="primary" type="button" onClick={() => void load()}>
              Retry
            </Button>
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
              Many private schools pay for the team themselves and cannot have sponsors. Choose that option below if it
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
                  disabled={!canEdit}
                  onChange={() =>
                    setDraft((prev) => ({
                      ...prev,
                      fundingModel: value,
                      ...flagsFromFundingModel(value),
                    }))
                  }
                />
                {FUNDING_MODEL_LABELS[value]}
              </label>
            ))}
          </fieldset>
          {canEdit ? (
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save funding profile"}
            </Button>
          ) : (
            <p className="app-muted">View only — ask an owner or admin to change funding paths.</p>
          )}
        </form>
      )}
    </Panel>
  );
}
