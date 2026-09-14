"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, FormGrid, FormRow, PageHeader, Panel, StatTile } from "../../components/ui";
import { CallYourShot } from "../../lib/learning/call-your-shot";
import { buildShooterCall } from "../../lib/learning/surfaces";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { interpolateShot, SHOOTER_EXPORT_LANGUAGES, type ShooterExportLanguage } from "../../lib/shooter-table";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Point = {
  id: string;
  tableName: string;
  distanceFt: number;
  rpm: number | null;
  hoodAngle: number | null;
  notes: string;
};

type View =
  | { status: "setup_required"; message: string }
  | {
      status: "ready";
      context: { orgId: string; role: string };
      seasonYear: number;
      points: Point[];
      summary: { count: number; minDistanceFt: number | null; maxDistanceFt: number | null };
    };

const EMPTY = { distanceFt: "", rpm: "", hoodAngle: "", notes: "" };

function isShooterTableView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function shooterTableCacheOrg(data: View, orgHint: string): string {
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

async function persistShooterTableSnapshot(orgHint: string, seasonHint: string, data: View): Promise<void> {
  const cacheOrg = shooterTableCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = data.status === "ready" ? String(data.seasonYear) : seasonHint;
  try {
    await putFeatureSnapshot("shooter-table", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("shooter-table", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Shooter table already painted; IndexedDB is best-effort.
  }
}

function ShooterTableRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related build tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "subsystems", orgId)}>
        Subsystem specs
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "tuning-log", orgId)}>
        Tuning log
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "power-budget", orgId)}>
        Power budget
      </Button>
    </nav>
  );
}

function ShooterTableNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "point",
      label: "Add a calibrated point",
      detail: "Log RPM and hood at a known distance so lookup stays honest.",
      href: "#shooter-table-point",
      primary: true,
    },
    {
      id: "tuning",
      label: "Open Tuning log",
      detail: "Offsets and gains that go with this table live there.",
      href: hubHref("/build", "tuning-log", orgId),
      primary: false,
    },
    {
      id: "subsystems",
      label: "Open Subsystem specs",
      detail: "Attach the shooter motors and reduction to the spec sheet.",
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

export default function ShooterTableClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });
  const [query, setQuery] = useState("");
  const [exportLang, setExportLang] = useState<ShooterExportLanguage>("java");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint = orgId?.trim() ?? "";
    const seasonHint = String(seasonYear);
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("shooter-table", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isShooterTableView(cached.data)) {
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
        `/api/shooter-table?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`,
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
      if (!response.ok || !isShooterTableView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Shooter table. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to load shooter table",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistShooterTableSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Shooter table. Showing the last copy on this device.");
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
    const response = await fetch("/api/shooter-table", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function savePoint(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "save_point", seasonYear, tableName: "Shooter", ...form }, "Point saved.");
    if (view?.status === "ready") setForm({ ...EMPTY });
  }

  const robotHref = hubWorkbenchHref("build", "shooter-table", orgId);

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
              {" / Shooter table"}
            </>
          }
          title="Shooter table"
          description="Calibrated distance → RPM and hood. Missing fields stay missing."
        >
          <ShooterTableRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="Shooter table" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Opening Shooter table"}
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
                {" / Shooter table"}
              </>
            }
            title="Shooter table"
            description="Calibrated distance → RPM and hood. Missing fields stay missing."
          >
            <ShooterTableRelated orgId={orgId} />
          </PageHeader>
          <OfflineBanner feature="Shooter table" fromCache={fromCache} cachedAt={cachedAt} />
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

  const queryFt = Number(query);
  const callPoints = view.points.map((p) => ({ distanceFt: p.distanceFt, rpm: p.rpm, hoodAngle: p.hoodAngle }));
  const shot = query !== "" && Number.isFinite(queryFt) ? interpolateShot(callPoints, queryFt) : null;
  const callSignature = JSON.stringify({
    distanceFt: queryFt,
    points: callPoints.map((p) => [p.distanceFt, p.rpm, p.hoodAngle]),
  });
  const callFieldSet = buildShooterCall({ points: callPoints, distanceFt: queryFt });
  const exportHref = `/api/shooter-table/export?orgId=${encodeURIComponent(view.context.orgId)}&seasonYear=${seasonYear}&lang=${exportLang}`;
  const rpmLogged = view.points.filter((p) => p.rpm != null).length;
  const hoodLogged = view.points.filter((p) => p.hoodAngle != null).length;
  const rangeLabel =
    view.summary.minDistanceFt != null ? `${view.summary.minDistanceFt}–${view.summary.maxDistanceFt} ft` : "—";

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={robotHref}>Build</a>
            {" / Shooter table"}
          </>
        }
        title={`Shooter table — ${seasonYear}`}
        description="Lookup interpolates between logged points. The download writes only logged rows."
      >
        <ShooterTableRelated orgId={view.context.orgId} />
      </PageHeader>
      <OfflineBanner feature="Shooter table" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? (
        <p className="app-muted" role="status">
          {message}
        </p>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <StatTile label="Calibrated points" value={view.summary.count} />
        <StatTile label="Range" value={rangeLabel} />
      </div>

      <Panel>
        <h2>Look up a shot</h2>
        <FormRow label="Distance (ft)">
          <input
            type="number"
            min="0"
            step="0.1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="12.5"
          />
        </FormRow>
        {shot ? (
          <CallYourShot
            surface="shooter_table"
            orgId={view.context.orgId}
            role={view.context.role}
            fieldSet={callFieldSet}
            inputs={{ distanceFt: queryFt, points: callPoints }}
            inputSummary={`${view.summary.count} calibrated point${view.summary.count === 1 ? "" : "s"}, reading ${queryFt} ft`}
            signature={callSignature}
          >
            <p className="app-muted">
              At {queryFt} ft → {shot.rpm != null ? `${shot.rpm} RPM` : "no RPM data"}
              {shot.hoodAngle != null ? ` · ${shot.hoodAngle}° hood` : ""}
              {shot.extrapolated ? " (extrapolated — outside calibrated range)" : ""}
            </p>
          </CallYourShot>
        ) : null}
        <p className="app-muted">
          Values are linearly interpolated between your calibrated points. Add more points to tighten accuracy
          across the field.
        </p>
      </Panel>

      <Panel as="form" id="shooter-table-point" onSubmit={savePoint}>
        <h2>Add or update a point</h2>
        <FormGrid min={160}>
          <FormRow label="Distance (ft)">
            <input
              required
              type="number"
              min="0"
              step="0.1"
              value={form.distanceFt}
              onChange={(e) => setForm({ ...form, distanceFt: e.target.value })}
            />
          </FormRow>
          <FormRow label="Flywheel RPM">
            <input type="number" min="0" value={form.rpm} onChange={(e) => setForm({ ...form, rpm: e.target.value })} />
          </FormRow>
          <FormRow label="Hood angle (°)">
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.hoodAngle}
              onChange={(e) => setForm({ ...form, hoodAngle: e.target.value })}
            />
          </FormRow>
        </FormGrid>
        <FormRow label="Notes" wide>
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </FormRow>
        <Button variant="primary" type="submit">
          Save point
        </Button>
      </Panel>

      <Panel>
        <h2>Robot code</h2>
        <p className="app-muted">
          Download constants built only from logged RPM and hood rows. Missing fields stay missing — this file
          does not interpolate or invent flywheel RPM.
        </p>
        <FormRow label="Language">
          <select value={exportLang} onChange={(e) => setExportLang(e.target.value as ShooterExportLanguage)}>
            {SHOOTER_EXPORT_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang === "java" ? "Java (WPILib)" : lang === "cpp" ? "C++" : "Python"}
              </option>
            ))}
          </select>
        </FormRow>
        <Button as="a" variant="primary" href={exportHref}>
          Download constants
        </Button>
        <p className="app-muted">
          {view.points.length === 0
            ? "No logged points yet — the download is an empty table, not sample RPM."
            : `${rpmLogged} RPM row${rpmLogged === 1 ? "" : "s"}, ${hoodLogged} hood row${hoodLogged === 1 ? "" : "s"} will be written. Lookup interpolation on this page is not included.`}
        </p>
      </Panel>

      <Panel>
        <h2>Calibrated points</h2>
        {view.points.length === 0 ? (
          <p className="app-muted">No points yet — shoot from a few known distances and log RPM/angle here.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
            {view.points.map((p) => (
              <li key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <strong>
                    {p.distanceFt} ft → {p.rpm != null ? `${p.rpm} RPM` : "—"}
                    {p.hoodAngle != null ? ` · ${p.hoodAngle}°` : ""}
                  </strong>
                  {p.notes ? (
                    <small className="app-muted" style={{ display: "block" }}>
                      {p.notes}
                    </small>
                  ) : null}
                </div>
                {view.context.role !== "viewer" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => void post({ action: "delete_point", id: p.id }, "Point removed.")}
                  >
                    Delete
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ShooterTableNextActions orgId={view.context.orgId} />
    </main>
  );
}
