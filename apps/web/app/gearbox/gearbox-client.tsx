"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { compoundReduction, describeStages, outputRpm, type Stage } from "../../lib/gearbox";
import { CallYourShot } from "../../lib/learning/call-your-shot";
import { buildGearboxCall } from "../../lib/learning/surfaces";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Gearbox = {
  id: string;
  name: string;
  subsystem: string;
  stages: Stage[];
  motorFreeRpm: number | null;
  notes: string;
  byName: string | null;
  reduction: number;
  outputRpm: number | null;
};

type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; gearboxes: Gearbox[] };

type StageDraft = { driving: string; driven: string };
const EMPTY = { name: "", subsystem: "", motorFreeRpm: "", notes: "" };

function isGearboxView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function gearboxCacheOrg(data: View, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return orgHint;
    case "ready":
      return data.context.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistGearboxSnapshot(orgHint: string, seasonHint: string, data: View): Promise<void> {
  const cacheOrg = gearboxCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = data.status === "ready" ? String(data.seasonYear) : seasonHint;
  try {
    await putFeatureSnapshot("gearbox", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("gearbox", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Gearbox calculator already painted; IndexedDB is best-effort.
  }
}

function GearboxRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related build tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "weight-budget", orgId)}>
        Weight budget
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "power-budget", orgId)}>
        Power budget
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "subsystems", orgId)}>
        Subsystem specs
      </Button>
    </nav>
  );
}

function GearboxNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "save",
      label: "Save a gearbox",
      detail: "Name the reduction and the stages so the next person can reuse it.",
      href: "#gearbox-design",
      primary: true,
    },
    {
      id: "weight",
      label: "Open Weight budget",
      detail: "Heavy gearboxes show up on the planned-weight board.",
      href: hubHref("/build", "weight-budget", orgId),
      primary: false,
    },
    {
      id: "subsystems",
      label: "Open Subsystem specs",
      detail: "Attach this reduction to the subsystem it drives.",
      href: hubHref("/build", "subsystems", orgId),
      primary: false,
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function GearboxClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });
  const [stages, setStages] = useState<StageDraft[]>([{ driving: "", driven: "" }]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint = orgId?.trim() ?? "";
    const seasonHint = String(seasonYear);
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("gearbox", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isGearboxView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setLoadError("");
    setErrorStatus(null);
    try {
      const response = await fetch(
        `/api/gearbox?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
      );
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isGearboxView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Gearbox calculator. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to load gearboxes",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistGearboxSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Gearbox calculator. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, [orgId, seasonYear]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return false;
    const response = await fetch("/api/gearbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = (await response.json()) as { error?: string; wrote?: "insert" | "update" };
    if (!response.ok) {
      setMessage(data.error ?? "Gearbox request failed");
      return false;
    }
    setMessage(data.wrote === "update" ? "Gearbox updated." : okMessage);
    await load();
    return true;
  }

  const parsedStages: Stage[] = stages
    .map((s) => ({ driving: Number(s.driving), driven: Number(s.driven) }))
    .filter((s) => s.driving > 0 && s.driven > 0);
  const previewReduction = parsedStages.length ? compoundReduction(parsedStages) : null;
  const freeRpm = Number(form.motorFreeRpm) > 0 ? Number(form.motorFreeRpm) : null;
  const previewOut = previewReduction && freeRpm != null ? outputRpm(freeRpm, previewReduction) : null;
  const callSignature = JSON.stringify({ stages: parsedStages, freeRpm });
  const callFieldSet = buildGearboxCall({ stages: parsedStages, motorFreeRpm: freeRpm });

  function editGearbox(g: Gearbox) {
    setEditingId(g.id);
    setForm({
      name: g.name,
      subsystem: g.subsystem,
      motorFreeRpm: g.motorFreeRpm != null ? String(g.motorFreeRpm) : "",
      notes: g.notes,
    });
    setStages(g.stages.map((s) => ({ driving: String(s.driving), driven: String(s.driven) })));
    setMessage("");
  }

  function resetDraft() {
    setEditingId(null);
    setForm({ ...EMPTY });
    setStages([{ driving: "", driven: "" }]);
  }

  async function saveGearbox(event: React.FormEvent) {
    event.preventDefault();
    const ok = await post(
      { action: "save_gearbox", seasonYear, ...form, stages: parsedStages, ...(editingId ? { id: editingId } : {}) },
      "Gearbox saved.",
    );
    if (ok) resetDraft();
  }

  const robotHref = hubWorkbenchHref("build", "gearbox", orgId);

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs={
            <>
              <a href={robotHref}>Build</a>
              {" / Gearbox calculator"}
            </>
          }
          title="Gearbox calculator"
          description="Compound reduction from the tooth counts you type."
        >
          <GearboxRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="Gearbox calculator" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading gearboxes…"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          <PageHeader
            breadcrumbs={
              <>
                <a href={robotHref}>Build</a>
                {" / Gearbox calculator"}
              </>
            }
            title="Gearbox calculator"
            description="Compound reduction from the tooth counts you type."
          >
            <GearboxRelated orgId={orgId} />
          </PageHeader>
          <OfflineBanner feature="Gearbox calculator" fromCache={fromCache} cachedAt={cachedAt} />
          <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
            <Button as="a" variant="primary" href="/workspace">
              Choose your team
            </Button>
          </EmptyState>
        </main>
      );
    case "ready":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={robotHref}>Build</a>
            {" / Gearbox calculator"}
          </>
        }
        title={`Gearbox calculator — ${seasonYear}`}
        description="Each stage's ratio is driven ÷ driving teeth. Output speed is motor RPM ÷ the compound reduction."
      >
        <GearboxRelated orgId={view.context.orgId} />
      </PageHeader>
      <OfflineBanner feature="Gearbox calculator" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? <p className="app-muted" role="status">{message}</p> : null}

      <Panel as="form" id="gearbox-design" onSubmit={saveGearbox}>
        <h2>{editingId ? "Update gearbox" : "Design a gearbox"}</h2>
        <FormGrid min={160}>
          <FormRow label="Name">
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="SDS MK4i L2" />
          </FormRow>
          <FormRow label="Subsystem">
            <input value={form.subsystem} onChange={(e) => setForm({ ...form, subsystem: e.target.value })} placeholder="Drivetrain" />
          </FormRow>
        </FormGrid>
        <p className="app-muted">Stages (driving : driven teeth)</p>
        {stages.map((s, i) => (
          <FormGrid min={120} key={i}>
            <FormRow label="Driving">
              <input type="number" min="1" value={s.driving} onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, driving: e.target.value } : x)))} />
            </FormRow>
            <FormRow label="Driven">
              <input type="number" min="1" value={s.driven} onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, driven: e.target.value } : x)))} />
            </FormRow>
            {stages.length > 1 ? (
              <Button type="button" variant="secondary" onClick={() => setStages(stages.filter((_, j) => j !== i))}>
                Remove
              </Button>
            ) : null}
          </FormGrid>
        ))}
        {stages.length < 8 ? (
          <Button type="button" variant="secondary" onClick={() => setStages([...stages, { driving: "", driven: "" }])}>
            Add stage
          </Button>
        ) : null}
        <FormRow label="Motor free RPM (optional)">
          <input type="number" min="0" value={form.motorFreeRpm} onChange={(e) => setForm({ ...form, motorFreeRpm: e.target.value })} placeholder="6000" />
        </FormRow>
        <FormRow label="Notes">
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </FormRow>
        <p className="app-muted">Saving the same subsystem and name again updates that gearbox in place — it does not create a second copy.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" type="submit">{editingId ? "Update gearbox" : "Save gearbox"}</Button>
          {editingId ? (
            <Button type="button" variant="secondary" onClick={resetDraft}>Cancel edit</Button>
          ) : null}
        </div>
      </Panel>

      {previewReduction != null ? (
        <Panel>
          <CallYourShot
            surface="gearbox"
            orgId={view.context.orgId}
            role={view.context.role}
            fieldSet={callFieldSet}
            inputs={{ stages: parsedStages, motorFreeRpm: freeRpm }}
            inputSummary={`${describeStages(parsedStages)}${freeRpm != null ? ` from a ${freeRpm} RPM free speed` : ""}`}
            signature={callSignature}
          >
            <p className="app-muted">
              Compound reduction: {previewReduction}:1{previewOut != null ? ` · output ${previewOut} RPM` : ""} · torque ×{previewReduction}
            </p>
          </CallYourShot>
        </Panel>
      ) : null}

      <Panel>
        <h2>Saved gearboxes</h2>
        {view.gearboxes.length === 0 ? (
          <p className="app-muted">No gearboxes yet — design your drivetrain reduction above.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
            {view.gearboxes.map((g) => (
              <li key={g.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <strong>{g.name} · {g.reduction}:1{g.outputRpm != null ? ` · ${g.outputRpm} RPM out` : ""}</strong>
                  <small className="app-muted" style={{ display: "block" }}>
                    {describeStages(g.stages)}{g.subsystem ? ` · ${g.subsystem}` : ""}{g.notes ? ` · ${g.notes}` : ""}
                  </small>
                </div>
                {view.context.role !== "viewer" ? (
                  <span style={{ display: "flex", gap: 8 }}>
                    <Button type="button" size="sm" onClick={() => editGearbox(g)}>Edit</Button>
                    <Button type="button" size="sm" variant="danger" onClick={() => void post({ action: "delete_gearbox", id: g.id }, "Gearbox removed.")}>
                      Delete
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <GearboxNextActions orgId={view.context.orgId} />
    </main>
  );
}
