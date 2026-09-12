"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, FormGrid, FormRow, PageHeader, Panel, StatTile } from "../../components/ui";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import {
  COMMON_COMPONENTS,
  VERSION_CATEGORIES,
  VERSION_CATEGORY_LABEL,
  inspectionDsCue,
  inspectionRioImageCue,
  staleSeasonStackCue,
  vh109DipSwitchCue,
  vh109FirmwareCue,
  type VersionCategory,
  type VersionStatus,
} from "../../lib/software-versions";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Component = {
  id: string;
  component: string;
  category: VersionCategory;
  installedVersion: string;
  targetVersion: string | null;
  notes: string;
  byName: string | null;
  updatedAt: string;
  status: VersionStatus;
};

type View =
  | { status: "setup_required"; message: string }
  | {
      status: "ready";
      context: { orgId: string; role: string };
      seasonYear: number;
      components: Component[];
      summary: { total: number; ok: number; updateAvailable: number; unknown: number };
    };

const STATUS_LABEL: Record<VersionStatus, string> = {
  ok: "Up to date",
  update_available: "Update available",
  unknown: "No target set",
};

const EMPTY = {
  component: "",
  category: "library" as VersionCategory,
  installedVersion: "",
  targetVersion: "",
  notes: "",
};

function isSoftwareVersionsView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function softwareVersionsCacheOrg(data: View, orgHint: string): string {
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

async function persistSoftwareVersionsSnapshot(orgHint: string, seasonHint: string, data: View): Promise<void> {
  const cacheOrg = softwareVersionsCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = data.status === "ready" ? String(data.seasonYear) : seasonHint;
  try {
    await putFeatureSnapshot("software-versions", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("software-versions", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Software versions already painted; IndexedDB is best-effort.
  }
}

function SoftwareVersionsRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related build tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "wiring-map", orgId)}>
        CAN-bus map
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "code", orgId)}>
        Code
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "tuning-log", orgId)}>
        Tuning log
      </Button>
    </nav>
  );
}

function SoftwareVersionsNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "save",
      label: "Record a version",
      detail: "Installed vs target for WPILib, images, and vendor libraries.",
      href: "#software-version",
      primary: true,
    },
    {
      id: "code",
      label: "Open Code",
      detail: "Flash and review sit next to the versions you logged.",
      href: hubHref("/build", "code", orgId),
      primary: false,
    },
    {
      id: "wiring",
      label: "Open CAN-bus map",
      detail: "Device firmware should match the hardware on the map.",
      href: hubHref("/build", "wiring-map", orgId),
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

export default function SoftwareVersionsClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint = orgId?.trim() ?? "";
    const seasonHint = String(seasonYear);
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("software-versions", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isSoftwareVersionsView(cached.data)) {
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
        `/api/software-versions?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`,
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
      if (!response.ok || !isSoftwareVersionsView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Software versions. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to load software versions",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistSoftwareVersionsSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Software versions. Showing the last copy on this device.");
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
    if (view?.status !== "ready") return;
    const response = await fetch("/api/software-versions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "save_component", seasonYear, ...form }, "Saved.");
    if (view?.status === "ready") setForm({ ...EMPTY });
  }

  const codeHref = hubWorkbenchHref("build", "code", orgId);

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
              <a href={codeHref}>Build</a>
              {" / Software versions"}
            </>
          }
          title="Software versions"
          description="Installed vs target for libraries, images, and firmware."
        >
          <SoftwareVersionsRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="Software versions" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Opening Software versions"}
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
                <a href={codeHref}>Build</a>
                {" / Software versions"}
              </>
            }
            title="Software versions"
            description="Installed vs target for libraries, images, and firmware."
          >
            <SoftwareVersionsRelated orgId={orgId} />
          </PageHeader>
          <OfflineBanner feature="Software versions" fromCache={fromCache} cachedAt={cachedAt} />
          <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
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

  const existing = new Set(view.components.map((c) => c.component));
  const radioFirmwareCue = vh109FirmwareCue(view.components);
  const radioDipCue = vh109DipSwitchCue(view.components);
  const seasonStackCue = staleSeasonStackCue(view.components, view.seasonYear);
  const rioImageCue = inspectionRioImageCue(view.components, view.seasonYear);
  const dsCue = inspectionDsCue(view.components, view.seasonYear);
  const quickAdds = COMMON_COMPONENTS.filter((c) => !existing.has(c.name)).slice(0, 8);

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={codeHref}>Build</a>
            {" / Software versions"}
          </>
        }
        title={`Software versions — ${seasonYear}`}
        description="A mismatch between libraries, the roboRIO image, and device firmware is a classic “it worked yesterday” bug."
      >
        <SoftwareVersionsRelated orgId={view.context.orgId} />
      </PageHeader>
      <OfflineBanner feature="Software versions" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? (
        <p className="app-muted" role="status">
          {message}
        </p>
      ) : null}
      {radioFirmwareCue ? (
        <p className="app-muted" role="status">
          {radioFirmwareCue}
        </p>
      ) : null}
      {radioDipCue ? (
        <p className="app-muted" role="status">
          {radioDipCue}
        </p>
      ) : null}
      {seasonStackCue ? (
        <p className="app-muted" role="status">
          {seasonStackCue}
        </p>
      ) : null}
      {rioImageCue ? (
        <p className="app-muted" role="status">
          {rioImageCue}
        </p>
      ) : null}
      {dsCue ? (
        <p className="app-muted" role="status">
          {dsCue}
        </p>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <StatTile label="Components tracked" value={view.summary.total} />
        <StatTile label="Up to date" value={view.summary.ok} />
        <StatTile label="Update available" value={view.summary.updateAvailable} />
        <StatTile label="No target set" value={view.summary.unknown} />
      </div>

      <Panel as="form" id="software-version" onSubmit={save}>
        <h2>Record a version</h2>
        <FormGrid min={160}>
          <FormRow label="Component">
            <input
              required
              value={form.component}
              onChange={(e) => setForm({ ...form, component: e.target.value })}
              placeholder="WPILib"
            />
          </FormRow>
          <FormRow label="Category">
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as VersionCategory })}
            >
              {VERSION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {VERSION_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Installed">
            <input
              required
              value={form.installedVersion}
              onChange={(e) => setForm({ ...form, installedVersion: e.target.value })}
              placeholder="2026.1.1"
            />
          </FormRow>
          <FormRow label="Target">
            <input
              value={form.targetVersion}
              onChange={(e) => setForm({ ...form, targetVersion: e.target.value })}
              placeholder="2026.2.0"
            />
          </FormRow>
        </FormGrid>
        <FormRow label="Notes" wide>
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </FormRow>
        {quickAdds.length > 0 ? (
          <p className="app-muted">
            Quick add:{" "}
            {quickAdds.map((c) => (
              <Button
                key={c.name}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setForm({ ...EMPTY, component: c.name, category: c.category })}
              >
                {c.name}
              </Button>
            ))}
          </p>
        ) : null}
        <Button variant="primary" type="submit">
          Save version
        </Button>
      </Panel>

      <Panel>
        <h2>Why this matters</h2>
        <p className="app-muted">
          Set a target version for each component and this flags anything that drifts. Empty means nothing is
          on file — not a claimed match.
        </p>
      </Panel>

      <Panel>
        <h2>Components</h2>
        {view.components.length === 0 ? (
          <p className="app-muted">No versions recorded yet — start with WPILib and your vendor libraries.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
            {view.components.map((c) => (
              <li key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <strong>
                    {c.component} · {c.installedVersion}
                    {c.status === "update_available" ? " · update" : ""}
                  </strong>
                  <small className="app-muted" style={{ display: "block" }}>
                    {VERSION_CATEGORY_LABEL[c.category]}
                    {c.targetVersion ? ` · target ${c.targetVersion}` : ""} · {STATUS_LABEL[c.status]}
                    {c.byName ? ` · ${c.byName}` : ""}
                    {c.notes ? ` · ${c.notes}` : ""}
                  </small>
                </div>
                {view.context.role !== "viewer" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => void post({ action: "delete_component", id: c.id }, "Removed.")}
                  >
                    Delete
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <SoftwareVersionsNextActions orgId={view.context.orgId} />
    </main>
  );
}
