"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import {
  BIN_SHELF_LOCATION_KINDS,
  binShelfLocationKindLabel,
  decodeLocatorPayload,
  encodeLocatorPayload,
  type BinShelfLocatorView,
} from "../../lib/bin-shelf-locator";
import type { BinShelfFindResult, BinShelfLocationKind } from "../../lib/bin-shelf-locator/types";
import {
  BIN_SHELF_LOCATOR_RELATED_INCLUDE,
  binShelfLocatorNextActions,
  binShelfLocatorRelatedLinks,
  binShelfLocatorSetupSteps,
  binShelfLocatorShellCopy,
  classifyBinShelfLocatorShell,
  formatBinShelfLocatorMetric,
  shouldShowBinShelfLocatorSummaryTiles,
  type BinShelfLocatorNextAction,
  type BinShelfLocatorShellKind,
} from "../../lib/bin-shelf-locator/bin-shelf-locator-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { cameraScanSupported, openRearCamera, renderQrDataUrl, scanQrFromCamera } from "../../lib/scouting/qr-camera";
import "./bin-shelf-locator.css";

type LiveView = Extract<BinShelfLocatorView, { status: "live" }>;

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = binShelfLocatorRelatedLinks(orgId, {
    include: [...BIN_SHELF_LOCATOR_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related bsl-related" aria-label="Related build tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: BinShelfLocatorNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions bsl-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Spare Forecast, Spare Kit, and CAD — never DEMO inventory pins.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LocatorShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: BinShelfLocatorShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = binShelfLocatorNextActions({ orgId, shell });
  const copy = binShelfLocatorShellCopy(shell);
  const buildHref = hubHref("/build", "bin-shelf-locator", orgId);
  const steps = shell === "setup" ? binShelfLocatorSetupSteps(orgId) : [];

  return (
    <main className="module-page bsl-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Bin/Shelf Locator"}
          </>
        }
        title="Bin/Shelf Locator"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading bin/shelf locator">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Setup required" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
              Open Workspace
            </a>
          ) : null}
          {shell === "empty" ? (
            <a className="app-button" href="#bin-shelf-locations">
              Map the first location
            </a>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="bsl-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Spares and CAD — never DEMO inventory pins.</p>
          </header>
          <ul className="bsl-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted bsl-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <NextActionsPanel actions={actions} />
    </main>
  );
}

export default function BinShelfLocatorClient() {
  const [view, setView] = useState<BinShelfLocatorView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/bin-shelf-locator${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as BinShelfLocatorView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const locationCount =
    view?.status === "live" ? view.locations.filter((l) => !l.archived).length : 0;
  const itemCount =
    view?.status === "live"
      ? view.locations.reduce((sum, loc) => sum + (loc.archived ? 0 : loc.itemCount), 0)
      : 0;

  const shell = classifyBinShelfLocatorShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    locationCount,
  });
  const shellCopy = binShelfLocatorShellCopy(shell);
  const nextActions = binShelfLocatorNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    locationCount,
    itemCount,
  });
  const relatedLinks = binShelfLocatorRelatedLinks(orgId, {
    include: [...BIN_SHELF_LOCATOR_RELATED_INCLUDE],
  });
  const buildHref = hubHref("/build", "bin-shelf-locator", orgId);
  const showTiles = shouldShowBinShelfLocatorSummaryTiles(locationCount);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/bin-shelf-locator", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as BinShelfLocatorView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return <LocatorShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <LocatorShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <LocatorShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        {view?.status === "setup_required" && view.steps.length > 0 ? (
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href.startsWith("/") ? (orgId ? withOrgHref(step.href, orgId) : step.href) : step.href}>
                  Open
                </a>
              </li>
            ))}
          </ol>
        ) : null}
      </LocatorShell>
    );
  }

  if (shell === "empty" || view?.status !== "live") {
    return (
      <LocatorShell description={shellCopy.description} orgId={orgId} shell="empty">
        <div id="bin-shelf-locations">
          <CreateLocationForm busy={busy} mutate={mutate} />
        </div>
      </LocatorShell>
    );
  }

  return (
    <main className="module-page bsl-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Bin/Shelf Locator"}
          </>
        }
        title="Bin/Shelf Locator"
        description="Assign put-away locations, print QR labels, and find parts — never DEMO inventory pins. Cross-check Spare Forecast and CAD."
      >
        <div className="bsl-header-actions">
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p className="app-muted" role="alert">
          {error}
        </p>
      ) : null}

      <NextActionsPanel actions={nextActions} />

      {showTiles ? (
        <section className="bsl-stats" aria-label="Bin/shelf counts">
          <StatTile label="Locations" value={formatBinShelfLocatorMetric(locationCount, true)} />
          <StatTile label="Pinned items" value={formatBinShelfLocatorMetric(itemCount, true)} />
        </section>
      ) : null}

      <div id="bin-shelf-find">
        <ScanToFind orgId={view.orgId} />
      </div>
      <div id="bin-shelf-locations">
        <CreateLocationForm busy={busy} mutate={mutate} />
        <LocationsPanel view={view} busy={busy} mutate={mutate} />
      </div>
      <PutAwayForm view={view} busy={busy} mutate={mutate} />
      <LabelPrinter view={view} />
      <PlacementsPanel view={view} />
      <MovesPanel view={view} />
    </main>
  );
}

function CreateLocationForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<BinShelfLocationKind>("bin");
  const [zone, setZone] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!code.trim()) return;
        mutate({ action: "create-location", code, kind, zone: zone || undefined, notes: notes || undefined });
        setCode("");
        setZone("");
        setNotes("");
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <span className="biz-overline">Put-away setup</span>
      <h2>Add a bin/shelf location</h2>
      <FormGrid min={160}>
        <FormRow label="Code">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="A1, Shelf-3, Zone-Elec" required />
        </FormRow>
        <FormRow label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value as BinShelfLocationKind)}>
            {BIN_SHELF_LOCATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {binShelfLocationKindLabel(k)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Zone (optional)">
          <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Electronics bay" />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !code.trim()}>
          Add location
        </button>
      </div>
    </Panel>
  );
}

function LocationsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const active = view.locations.filter((l) => !l.archived);
  if (active.length === 0) {
    return (
      <EmptyState
        soft
        badge="No locations yet"
        badgeTone="setup"
        title="No bin/shelf locations yet"
        description="Add a location above, then assign items to it below."
      />
    );
  }
  return (
    <Panel aria-label="Bin/shelf locations">
      <span className="biz-overline">Locations</span>
      <h2>Bins, shelves &amp; zones</h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
        {active.map((loc) => (
          <li
            key={loc.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              borderBottom: "1px solid var(--border-soft, #e5e5e5)",
              paddingBottom: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <strong>{loc.code}</strong>
              <Badge tone={loc.itemCount > 0 ? "good" : "neutral"} icon={null}>
                {loc.itemCount} item{loc.itemCount === 1 ? "" : "s"}
              </Badge>
              <span className="app-muted">
                {binShelfLocationKindLabel(loc.kind)}
                {loc.zone ? ` · ${loc.zone}` : ""}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Archive location "${loc.code}"?`)) {
                  mutate({ action: "archive-location", locationId: loc.id });
                }
              }}
            >
              Archive
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PutAwayForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [itemId, setItemId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [fromLocationId, setFromLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const activeLocations = view.locations.filter((l) => !l.archived);

  if (view.items.length === 0 || activeLocations.length === 0) return null;

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!itemId || (!toLocationId && !fromLocationId)) return;
        mutate({
          action: "record-move",
          itemId,
          toLocationId: toLocationId || undefined,
          fromLocationId: fromLocationId || undefined,
          quantity: Number(quantity) || 0,
          method: "putaway",
          note: note || undefined,
        });
        setQuantity("");
        setNote("");
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <span className="biz-overline">Put-away / move</span>
      <h2>Assign an item to a location</h2>
      <FormGrid min={160}>
        <FormRow label="Item">
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} required>
            <option value="">Select item…</option>
            {view.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Move from (optional)">
          <select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
            <option value="">—</option>
            {activeLocations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.code}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Put away to">
          <select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
            <option value="">—</option>
            {activeLocations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.code}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Quantity">
          <input type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </FormRow>
      </FormGrid>
      <FormRow label="Note (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Restocked from order #..." />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !itemId || (!toLocationId && !fromLocationId)}>
          Record move
        </button>
      </div>
    </Panel>
  );
}

function LabelPrinter({ view }: { view: LiveView }) {
  const [target, setTarget] = useState<{ kind: "item" | "location"; id: string; label: string } | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    void renderQrDataUrl(encodeLocatorPayload(target.kind, target.id)).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [target]);

  const activeLocations = view.locations.filter((l) => !l.archived);
  if (view.items.length === 0 && activeLocations.length === 0) return null;

  return (
    <Panel aria-label="Printable labels">
      <span className="biz-overline">Labels</span>
      <h2>Printable QR labels</h2>
      <p className="app-muted" style={{ marginTop: 0 }}>
        Generated entirely in the browser — no external label service. Print and stick to a bin, shelf, or item bag.
      </p>
      <FormGrid min={200}>
        <FormRow label="Location label">
          <select
            value={target?.kind === "location" ? target.id : ""}
            onChange={(e) => {
              const loc = activeLocations.find((l) => l.id === e.target.value);
              setTarget(loc ? { kind: "location", id: loc.id, label: loc.code } : null);
            }}
          >
            <option value="">Select location…</option>
            {activeLocations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.code}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Item label">
          <select
            value={target?.kind === "item" ? target.id : ""}
            onChange={(e) => {
              const item = view.items.find((i) => i.id === e.target.value);
              setTarget(item ? { kind: "item", id: item.id, label: item.name } : null);
            }}
          >
            <option value="">Select item…</option>
            {view.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      {dataUrl ? (
        <div style={{ display: "grid", gap: 8, justifyItems: "start", marginTop: 8 }}>
          <div className="print-label" style={{ border: "1px solid var(--border-soft, #ddd)", padding: 12, borderRadius: 8 }}>
            <img src={dataUrl} alt={`QR label for ${target?.label ?? ""}`} width={160} height={160} />
            <div style={{ textAlign: "center", fontWeight: 600, marginTop: 4 }}>{target?.label}</div>
          </div>
          <button type="button" className="app-button secondary" onClick={() => window.print()}>
            Print label
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

function ScanToFind({ orgId }: { orgId: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [result, setResult] = useState<BinShelfFindResult | null>(null);
  const supported = useMemo(() => cameraScanSupported(), []);

  const stopScan = useCallback(() => {
    abortRef.current?.abort();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => stopScan, [stopScan]);

  const startScan = useCallback(async () => {
    setScanError("");
    setResult(null);
    try {
      const stream = await openRearCamera();
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setScanning(true);
      if (!videoRef.current || !canvasRef.current) return;
      const raw = await scanQrFromCamera({ video: videoRef.current, canvas: canvasRef.current, signal: controller.signal });
      const decoded = decodeLocatorPayload(raw);
      stopScan();
      if (!decoded || decoded.kind !== "item") {
        setScanError("Scanned code isn't a Bin/Shelf Locator item label.");
        return;
      }
      const response = await fetch(
        `/api/bin-shelf-locator?orgId=${encodeURIComponent(orgId)}&findItem=${encodeURIComponent(decoded.id)}`,
      );
      const data = (await response.json()) as BinShelfFindResult | { error?: string };
      if (!response.ok || !("itemId" in data)) {
        setScanError("error" in data && data.error ? data.error : "Item not found.");
        return;
      }
      setResult(data);
    } catch {
      stopScan();
      setScanError("Camera access failed. Check permissions and try again.");
    }
  }, [orgId, stopScan]);

  if (!supported) {
    return (
      <EmptyState
        soft
        title="Scan-to-find needs camera access"
        description="This device/browser doesn't support camera-based QR scanning. Use a phone with camera permissions enabled."
      />
    );
  }

  return (
    <Panel aria-label="Scan to find">
      <span className="biz-overline">Mobile scan-to-find</span>
      <h2>Scan an item label to find it</h2>
      <p className="app-muted" style={{ marginTop: 0 }}>
        Point the camera at a printed item QR label to see exactly where it's stocked, and its recent move history.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        <video ref={videoRef} muted playsInline style={{ width: "100%", maxWidth: 360, borderRadius: 8, display: scanning ? "block" : "none" }} />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <div>
          {scanning ? (
            <button type="button" className="app-button secondary" onClick={stopScan}>
              Stop scanning
            </button>
          ) : (
            <button type="button" className="app-button" onClick={() => void startScan()}>
              Start camera scan
            </button>
          )}
        </div>
        {scanError ? <p role="alert" className="app-muted">{scanError}</p> : null}
        {result ? (
          <div style={{ display: "grid", gap: 6 }}>
            <strong>{result.itemName}</strong>
            {result.placements.length === 0 ? (
              <span className="app-muted">Not currently assigned to any bin/shelf location.</span>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {result.placements.map((p) => (
                  <li key={p.id}>
                    {p.locationCode} ({binShelfLocationKindLabel(p.locationKind)}) — qty {p.quantity}, last seen{" "}
                    {new Date(p.lastSeenAt).toLocaleString()}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function PlacementsPanel({ view }: { view: LiveView }) {
  if (view.placements.length === 0) {
    return (
      <EmptyState
        soft
        badge="No placements yet"
        badgeTone="setup"
        title="No items assigned to a location yet"
        description="Use the put-away form above to assign the first item to a bin or shelf."
      />
    );
  }
  return (
    <Panel aria-label="Item placements">
      <span className="biz-overline">Where things live</span>
      <h2>Current placements</h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
        {view.placements.map((p) => (
          <li key={p.id} style={{ borderBottom: "1px solid var(--border-soft, #e5e5e5)", paddingBottom: 8 }}>
            <strong>{p.itemName}</strong>
            <span className="app-muted" style={{ marginLeft: 8 }}>
              {p.locationCode} · qty {p.quantity} · last seen {new Date(p.lastSeenAt).toLocaleDateString()}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function MovesPanel({ view }: { view: LiveView }) {
  if (view.recentMoves.length === 0) return null;
  return (
    <Panel aria-label="Move log">
      <span className="biz-overline">Audit trail</span>
      <h2>Recent moves</h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
        {view.recentMoves.map((mv) => (
          <li key={mv.id} style={{ borderBottom: "1px solid var(--border-soft, #e5e5e5)", paddingBottom: 8 }}>
            <strong>{mv.itemName}</strong>
            <span className="app-muted" style={{ marginLeft: 8 }}>
              {mv.fromLocationCode ?? "—"} → {mv.toLocationCode ?? "—"} · qty {mv.quantity} · {mv.method} ·{" "}
              {new Date(mv.createdAt).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
