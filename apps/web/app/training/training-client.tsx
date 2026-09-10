"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { trainingCategoryLabel } from "../../lib/training";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  TRAINING_CATEGORIES,
  type TrainingView,
} from "../../lib/training/compute-training";
import type { CertificationStatus, TrainingCategory } from "../../lib/training/types";

const STATUS_LABEL: Record<CertificationStatus, string> = {
  active: "Active",
  expiring_soon: "Expiring soon",
  expired: "Expired",
};

function isTrainingView(value: unknown): value is TrainingView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function trainingCacheOrg(data: TrainingView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistTrainingSnapshot(orgHint: string, data: TrainingView): Promise<void> {
  const cacheOrg = trainingCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("training", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("training", "_", data);
  } catch {
    // Live Training already painted; IndexedDB is best-effort.
  }
}

function statusTone(status: CertificationStatus): string {
  if (status === "active") return "good";
  if (status === "expiring_soon") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<TrainingView, { status: "live" }>;

export default function TrainingClient() {
  const [view, setView] = useState<TrainingView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadErrorMessage, setLoadErrorMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<TrainingView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<TrainingView>("training", orgHint || "_");
      if (!viewRef.current && cached?.data && isTrainingView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setError("");
    setErrorStatus(null);
    setLoadErrorMessage("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      const response = await fetch(`/api/training${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setLoadErrorMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      if (!response.ok || !isTrainingView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Training. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setLoadErrorMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistTrainingSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Training. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/training", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isTrainingView(data)) {
          setError(
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Something went wrong.",
          );
          return;
        }
        setView(data);
        setFromCache(false);
        void persistTrainingSnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  const failure =
    fetchFailed && !view
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: loadErrorMessage,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message:
              loadErrorMessage || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Training Matrix"}
          </>
        }
        title="Training Matrix"
        description="Who is certified on mill, lathe, wiring, drive, and safety — with sign-off and expiry. Coverage reflects only what you record."
      />
      <OfflineBanner feature="Training" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {!view ? (
        failure ? (
        <EmptyState title={failure.title} description={failure.description}>
          {failure.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
        ) : (
        <EmptyState title="Loading…" description="Checking your team." aria-busy />
        )
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <CoveragePanel view={view} />
          <SummaryTiles view={view} />
          {view.canManage ? (
            <>
              <AddSkillForm busy={busy} mutate={mutate} />
              {view.skills.length > 0 ? <CertifyForm view={view} busy={busy} mutate={mutate} /> : null}
            </>
          ) : (
            <p className="app-muted">
              Certifications are recorded by an owner or admin. You can see the whole matrix here.
            </p>
          )}
          <SkillsList view={view} busy={busy || !view.canManage} mutate={mutate} />
          <CertificationsList view={view} busy={busy || !view.canManage} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function CoveragePanel({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <Panel aria-label="Training coverage">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Training coverage signal</h2>
          <small className="app-muted">
            {summary.certifiedMemberCount} member(s) certified across {summary.totalSkills} skill(s)
          </small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(summary.coverageSignal)}</strong>
      </header>
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Skills tracked", value: String(summary.totalSkills) },
    { label: "Certifications", value: String(summary.totalCertifications) },
    { label: "Certified members", value: String(summary.certifiedMemberCount) },
    { label: "Active", value: String(summary.activeCount) },
    { label: "Expiring soon", value: String(summary.expiringSoonCount) },
    { label: "Expired", value: String(summary.expiredCount) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AddSkillForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({ name: "", category: "mill" as TrainingCategory, description: "", validityMonths: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        mutate({
          action: "add-skill",
          name: form.name,
          category: form.category,
          description: form.description || undefined,
          validityMonths: form.validityMonths ? Number(form.validityMonths) : undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add skill</h2>
      <FormGrid min={160}>
        <FormRow label="Name">
          <input value={form.name} onChange={set("name")} placeholder="Manual mill" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {TRAINING_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {trainingCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Renewal window (months, optional)" hint="Leave blank if it never expires">
          <input type="number" min={1} value={form.validityMonths} onChange={set("validityMonths")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Description (optional)">
        <textarea value={form.description} onChange={set("description")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.name.trim()}>
          Add skill
        </Button>
      </div>
    </Panel>
  );
}

function CertifyForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      skillId: view.skills[0]?.id ?? "",
      memberUserId: view.members[0]?.userId ?? "",
      certifiedAt: new Date().toISOString().slice(0, 10),
      expiresAt: "",
      notes: "",
    }),
    [view.skills, view.members],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.skillId || !form.memberUserId || !form.certifiedAt) return;
        mutate({
          action: "certify",
          skillId: form.skillId,
          memberUserId: form.memberUserId,
          certifiedAt: form.certifiedAt,
          expiresAt: form.expiresAt || undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Sign off a certification</h2>
      <FormGrid min={160}>
        <FormRow label="Skill">
          <select value={form.skillId} onChange={set("skillId")}>
            {view.skills.map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.name}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Member">
          <select value={form.memberUserId} onChange={set("memberUserId")}>
            {view.members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Certified on">
          <input type="date" value={form.certifiedAt} onChange={set("certifiedAt")} required />
        </FormRow>
        <FormRow label="Expires (optional)" hint="Leave blank to use the skill's default renewal window">
          <input type="date" value={form.expiresAt} onChange={set("expiresAt")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.skillId || !form.memberUserId || !form.certifiedAt}>
          Sign off
        </Button>
      </div>
    </Panel>
  );
}

function SkillsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.skills.length === 0) {
    return (
      <EmptyState
        badge="No skills yet"
        badgeTone="setup"
        title="Add your first trainable skill"
        description="Mill, lathe, wiring, drive, and safety are common starting points."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Skills</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.skills.map((skill) => {
          const coverage = view.summary.bySkill.find((row) => row.skillId === skill.id);
          return (
            <li
              key={skill.id}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
            >
              <div>
                <strong>{skill.name}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {trainingCategoryLabel(skill.category)}
                  {skill.validityMonths ? ` · renews every ${skill.validityMonths}mo` : " · no expiry"}
                </small>
                <small className="app-muted">
                  {coverage
                    ? `${coverage.activeCount} active · ${coverage.expiringSoonCount} expiring · ${coverage.expiredCount} expired`
                    : "No certifications yet"}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete skill "${skill.name}"? This also removes its certifications.`)) {
                    mutate({ action: "delete-skill", skillId: skill.id });
                  }
                }}
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function CertificationsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.certifications.length === 0) {
    return (
      <EmptyState
        badge="No certifications yet"
        badgeTone="setup"
        title="Sign off your first certification"
        description="Certifications record who is trained, who signed off, and when it expires."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Certifications</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.certifications.slice(0, 40).map((cert) => (
          <li
            key={cert.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <span className={`app-badge ${statusTone(cert.status)}`}>{STATUS_LABEL[cert.status]}</span>
              <strong style={{ marginLeft: 8 }}>
                {cert.memberName} · {cert.skillName}
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                Certified {cert.certifiedAt} by {cert.certifiedByName}
                {cert.expiresAt ? ` · expires ${cert.expiresAt}` : " · no expiry"}
              </small>
              {cert.notes ? <small className="app-muted">{cert.notes}</small> : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Revoke ${cert.memberName}'s ${cert.skillName} certification?`)) {
                  mutate({ action: "revoke-certification", certificationId: cert.id });
                }
              }}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
