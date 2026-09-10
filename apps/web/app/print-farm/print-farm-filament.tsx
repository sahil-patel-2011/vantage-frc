"use client";

import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, Panel, ProgressMeter } from "../../components/ui";
import { FILAMENT_MATERIALS, materialLabel } from "../../lib/print-farm";
import type { FilamentView } from "../../lib/print-farm/compute-print-farm";
import type { FilamentMaterial } from "../../lib/print-farm/types";
import { spoolLabel, type LiveView, type Mutate } from "./print-farm-model";

export function FilamentPanel({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  return (
    <Panel id="print-farm-filament" className="pf-panel">
      <h2>Filament</h2>
      {view.filaments.length === 0 ? (
        <EmptyState
          soft
          badge="No spools yet"
          badgeTone="setup"
          title="Add your first spool"
          description="Track grams by hand — every finish/fail entry decrements the spool it used."
        />
      ) : (
        <ul className="pf-list">
          {view.filaments.map((filament) => (
            <FilamentRow key={filament.id} filament={filament} busy={busy} mutate={mutate} />
          ))}
        </ul>
      )}
      <AddSpoolForm busy={busy} mutate={mutate} />
    </Panel>
  );
}

function FilamentRow({ filament, busy, mutate }: { filament: FilamentView; busy: boolean; mutate: Mutate }) {
  const [adjustGrams, setAdjustGrams] = useState("");
  const [adjustReason, setAdjustReason] = useState<"restock" | "audit" | "waste" | "purge">("audit");
  return (
    <li className="pf-row">
      <div className="pf-row-main">
        <div>
          {filament.spool.low ? <Badge tone="danger">Low</Badge> : null}{" "}
          <strong className="pf-name">{spoolLabel(filament)}</strong>
        </div>
        <small className="app-muted pf-block">
          {[
            filament.diameterMm != null ? `${filament.diameterMm}mm` : undefined,
            filament.vendor ?? undefined,
            filament.unitCostUsd != null ? `$${filament.unitCostUsd.toFixed(2)}/spool` : undefined,
            filament.openedOn ? `opened ${filament.openedOn}` : undefined,
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
        <div className="pf-meter">
          {filament.spoolGramsTotal != null ? (
            <ProgressMeter
              label="Remaining"
              value={Math.round(filament.gramsRemaining)}
              target={Math.round(filament.spoolGramsTotal)}
              unit="g"
            />
          ) : (
            <small className="app-muted">{Math.round(filament.gramsRemaining)} g remaining (spool total unknown)</small>
          )}
        </div>
        <small className="app-muted pf-block">
          {filament.runwayDays.value != null
            ? `~${filament.runwayDays.value.toFixed(1)} days left at the observed burn rate (${filament.runwayDays.sampleSize} usage entries)`
            : `Runway not computed — ${filament.runwayDays.reason}`}
        </small>
      </div>
      <form
        className="pf-inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          const grams = Number(adjustGrams);
          if (!Number.isFinite(grams) || grams === 0) return;
          mutate({ action: "adjust-spool", filamentId: filament.id, grams, reason: adjustReason });
          setAdjustGrams("");
        }}
      >
        <label>
          Adjust grams (+/−)
          <input
            type="number"
            step="1"
            value={adjustGrams}
            onChange={(e) => setAdjustGrams(e.target.value)}
            aria-label={`Adjust grams for ${spoolLabel(filament)}`}
          />
        </label>
        <label>
          Reason
          <select
            value={adjustReason}
            onChange={(e) => setAdjustReason(e.target.value as typeof adjustReason)}
            aria-label={`Adjustment reason for ${spoolLabel(filament)}`}
          >
            <option value="audit">Audit (weighed it)</option>
            <option value="restock">Restock</option>
            <option value="waste">Waste</option>
            <option value="purge">Purge</option>
          </select>
        </label>
        <Button type="submit" size="sm" disabled={busy || !adjustGrams}>
          Log
        </Button>
      </form>
    </li>
  );
}

function AddSpoolForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({
      material: "pla" as FilamentMaterial,
      brand: "",
      color: "",
      spoolGramsTotal: "",
      gramsRemaining: "",
      vendor: "",
      unitCostUsd: "",
      openedOn: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <form
      className="pf-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        mutate({
          action: "add-spool",
          material: form.material,
          brand: form.brand || undefined,
          color: form.color || undefined,
          spoolGramsTotal: form.spoolGramsTotal ? Number(form.spoolGramsTotal) : undefined,
          gramsRemaining: form.gramsRemaining ? Number(form.gramsRemaining) : undefined,
          vendor: form.vendor || undefined,
          unitCostUsd: form.unitCostUsd ? Number(form.unitCostUsd) : undefined,
          openedOn: form.openedOn || undefined,
        });
        setForm(empty);
      }}
    >
      <label>
        Material
        <select value={form.material} onChange={set("material")}>
          {FILAMENT_MATERIALS.map((material) => (
            <option key={material} value={material}>
              {materialLabel(material)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Brand (optional)
        <input value={form.brand} onChange={set("brand")} placeholder="Polymaker" />
      </label>
      <label>
        Color (optional)
        <input value={form.color} onChange={set("color")} placeholder="Black" />
      </label>
      <label>
        Spool grams
        <input type="number" min={1} value={form.spoolGramsTotal} onChange={set("spoolGramsTotal")} placeholder="1000" />
      </label>
      <label>
        Grams remaining (if partly used)
        <input type="number" min={0} value={form.gramsRemaining} onChange={set("gramsRemaining")} />
      </label>
      <label>
        Opened on (optional)
        <input type="date" value={form.openedOn} onChange={set("openedOn")} />
      </label>
      <Button type="submit" size="sm" disabled={busy}>
        Add spool
      </Button>
    </form>
  );
}
