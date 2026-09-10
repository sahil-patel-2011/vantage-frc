"use client";

import type { ReactNode } from "react";
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import type { LiveView } from "./print-farm-model";

export function NonGoalsNote() {
  return (
    <p className="app-muted pf-nongoals">
      Manual by design: no slicer integration, no G-code upload, no printer telemetry, no
      OctoPrint/Bambu/Prusa API. Printer status is what a teammate last reported — nothing here is
      live machine data.
    </p>
  );
}

type FarmShellKind = "loading" | "error" | "setup";

function farmShellBody({
  kind,
  description,
  orgId,
  error,
  onRetry,
}: {
  kind: FarmShellKind;
  description: string;
  orgId?: string | null;
  error?: string;
  onRetry?: () => void;
}): ReactNode {
  switch (kind) {
    case "loading":
      return (
        <div aria-busy="true" aria-label="Loading the Print Farm">
          <SoftBlockSkeleton lines={4} />
        </div>
      );
    case "error":
      return (
        <ErrorState
          title="Could not load the Print Farm"
          message={error ?? "Could not load the Print Farm."}
          onRetry={onRetry}
        />
      );
    case "setup":
      return (
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title="Select a team"
          description={description}
        >
          <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Choose your team
          </Button>
        </EmptyState>
      );
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

export function FarmShell({
  description,
  orgId,
  kind,
  error,
  onRetry,
}: {
  description: string;
  orgId?: string | null;
  kind: FarmShellKind;
  error?: string;
  onRetry?: () => void;
}) {
  const buildHref = hubWorkbenchHref("build", "print-farm", orgId);
  return (
    <main className="module-page pf-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Print Farm"}
          </>
        }
        title="3D Print Farm"
        description={description}
      />
      {farmShellBody({ kind, description, orgId, error, onRetry })}
      <NonGoalsNote />
    </main>
  );
}

export function PrintFarmReadyHeader({
  orgId,
  error,
}: {
  orgId: string;
  error: string;
}) {
  const buildHref = hubWorkbenchHref("build", "print-farm", orgId);
  return (
    <>
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Print Farm"}
          </>
        }
        title="3D Print Farm"
        description="Queue prints, report printer status, and track filament by hand — nothing here is live machine data."
      />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function PrintFarmSummaryPanel({ view }: { view: LiveView }) {
  return (
    <Panel className="pf-panel">
      <div className="pf-stats">
        <StatTile label="Queued" value={String(view.summary.queuedCount)} />
        <StatTile label="Printing" value={String(view.summary.printingCount)} />
        <StatTile label="At risk" value={String(view.summary.atRiskCount)} />
        <StatTile label="Needs estimate" value={String(view.summary.needsEstimateCount)} />
        <StatTile label="Printers" value={String(view.summary.activePrinterCount)} />
        <StatTile label="Filament left" value={`${Math.round(view.summary.gramsRemainingTotal)} g`} />
      </div>
      {view.estimateBias.value != null ? (
        <p className="app-muted pf-block">
          Estimates run about ×{view.estimateBias.value.toFixed(2)} vs. actual (median of{" "}
          {view.estimateBias.sampleSize} completed jobs). ETAs below use this multiplier.
        </p>
      ) : (
        <p className="app-muted pf-block">Estimate bias not computed yet — {view.estimateBias.reason}.</p>
      )}
    </Panel>
  );
}
