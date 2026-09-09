import type { PoolClient } from "@neondatabase/serverless";
import type { OnshapeHttp } from "@vantage/cad";
import { buildCutList, buildHardwareList, fabricationFor } from "./fabrication";
import { buildAssemblyGraph, subAssemblyOf, type AssemblyGraph } from "./graph";
import { ingestAssembly, IngestIncomplete, type IngestCache } from "./ingest";
import {
  boxExtent,
  type AssemblyFacts,
  type FabricationLine,
  type FeasibilityCheck,
  type StepPart,
} from "./model";
import { deriveBuildOrder, type Disagreement, type Unresolved } from "./order";
import { renderManualPdf, type ManualPdfStep } from "./pdf";
import { renderStep, renderWholeAssembly } from "./render";
import { cotsCatalogInstalled, lookupCotsPart } from "./cots";
import { formatInches } from "./units";
import { nameSubAssembly, writeStepSentences, type MeteredInvoke, type StepWriteFacts } from "./write";

/**
 * The worker entry point: seven stages, checkpointed between each and inside
 * the two long ones.
 *
 *   ingest       read the assembly out of Onshape (cached, resumable per call)
 *   graph        mate graph, sub-assemblies, hardware classification
 *   order        two strategies, reconciled, revalidated
 *   fabrication  step rows written, with parts and shop instructions
 *   render       one Onshape shaded view per step (the slow one)
 *   write        the English sentence for each step, in batches
 *   pdf          the printable book
 *
 * SLICES, NOT A LOOP
 *
 * `advanceRun` does as much as fits in its time budget and then returns. It is
 * called again — by the same worker on its next tick, or a different one after
 * the lease expires — and picks up at the checkpoint. That is what makes an
 * hours-long job survivable on a Raspberry Pi that gets unplugged, and it is
 * why nothing in here holds state in a module-level variable.
 */

export type RunStage = "ingest" | "graph" | "order" | "fabrication" | "render" | "write" | "pdf" | "done";

export type PlanStep = {
  stepNumber: number;
  primaryId: string;
  fastenerIds: string[];
  subassembly: string;
  title: string;
  parts: StepPart[];
  fabrication: FabricationLine[];
  feasibility: { prerequisites: string[]; checks: FeasibilityCheck[]; notes: string[] };
  disagreement: { otherPosition: number; strategy: string; note: string } | null;
};

export type RunCheckpoint = {
  stage: RunStage;
  /** Raw Onshape responses, present only while ingest is unfinished. */
  ingestCache?: IngestCache;
  facts?: AssemblyFacts;
  plan?: PlanStep[];
  /** Next step index to render / write. */
  cursor?: number;
  coverPng?: string | null;
  coverNote?: string;
  hiddenOccurrencesSupported?: boolean;
  report?: RunReport;
  /** Set when the checkpoint had to drop the ingest cache to stay in bounds. */
  cacheDropped?: boolean;
};

export type RunReport = {
  strategyUsed: string;
  checksRun: number;
  checksPassed: number;
  disagreements: Disagreement[];
  unresolved: Unresolved[];
  notes: string[];
  gaps: string[];
  renderModes: Record<string, number>;
  sentenceSources: Record<string, number>;
  cutList: ReturnType<typeof buildCutList>;
  hardware: ReturnType<typeof buildHardwareList>;
  cotsCatalog: "used" | "absent";
  onshapeCalls: number;
};

export type RunContext = {
  client: PoolClient;
  runId: string;
  orgId: string;
  teamName: string;
  http: OnshapeHttp;
  /** Null when no model is reachable — the manual still completes. */
  invoke: MeteredInvoke | null;
  /** Wall-clock budget for this slice. */
  deadlineMs: number;
  isCancelled: () => Promise<boolean>;
  /** Called after every checkpoint so the worker can renew its lease. */
  heartbeat: () => Promise<void>;
};

export type AdvanceResult = {
  stage: RunStage;
  finished: boolean;
  cancelled: boolean;
  stepsDone: number;
  stepsTotal: number;
};

/** How many step renders / sentence batches before a checkpoint is written. */
const RENDER_CHECKPOINT_EVERY = 5;
const WRITE_BATCH = 10;
/** Checkpoints larger than this drop the raw ingest cache rather than fail. */
const MAX_CHECKPOINT_BYTES = 6_000_000;

function timeLeft(context: RunContext): number {
  return context.deadlineMs - Date.now();
}

async function saveCheckpoint(
  context: RunContext,
  checkpoint: RunCheckpoint,
  progress: Record<string, unknown>,
): Promise<void> {
  let payload = checkpoint;
  let serialized = JSON.stringify(payload);
  if (serialized.length > MAX_CHECKPOINT_BYTES && payload.ingestCache) {
    // A very large feature tree can outgrow what belongs in one jsonb column.
    // Dropping the cache costs a re-fetch on resume; silently truncating it
    // would cost correctness, and failing the run would cost the whole job.
    payload = { ...payload, ingestCache: undefined, cacheDropped: true };
    serialized = JSON.stringify(payload);
  }
  await context.client.query(
    `UPDATE assembly_manual_runs
        SET checkpoint = $2::jsonb, progress = $3::jsonb, updated_at = now()
      WHERE id = $1::uuid`,
    [context.runId, serialized, JSON.stringify(progress)],
  );
  await context.heartbeat();
}

function progressOf(stage: RunStage, stepsDone: number, stepsTotal: number, rendersDone: number, note = "") {
  return { stage, stepsDone, stepsTotal, rendersDone, note };
}

// ---------------------------------------------------------------------------
// Stage: fabrication → the plan
// ---------------------------------------------------------------------------

function extentOf(graph: AssemblyGraph, instanceId: string) {
  const box = graph.instances.get(instanceId)?.worldBoxMm;
  if (!box) return null;
  return boxExtent(box).slice().sort((a, b) => b - a) as [number, number, number];
}

function stepPartsFor(graph: AssemblyGraph, primaryId: string, fastenerIds: string[]): StepPart[] {
  const primary = graph.instances.get(primaryId);
  const parts: StepPart[] = [];
  if (primary) {
    parts.push({
      instanceId: primary.id,
      partKey: primary.partKey,
      name: primary.name,
      quantity: 1,
      massKg: primary.massKg,
      extentMm: extentOf(graph, primary.id),
      cots: lookupCotsPart(primary.name),
    });
  }
  // Identical hardware collapses into one callout line with a count, the way a
  // real instruction sheet reads: "4 x 10-32 x 1.00 SHCS", not four rows.
  const byName = new Map<string, StepPart>();
  for (const id of fastenerIds) {
    const fastener = graph.instances.get(id);
    if (!fastener) continue;
    const existing = byName.get(fastener.name);
    if (existing) {
      existing.quantity += 1;
      continue;
    }
    byName.set(fastener.name, {
      instanceId: fastener.id,
      partKey: fastener.partKey,
      name: fastener.name,
      quantity: 1,
      massKg: fastener.massKg,
      extentMm: extentOf(graph, fastener.id),
      cots: lookupCotsPart(fastener.name),
    });
  }
  parts.push(...byName.values());
  return parts;
}

// ---------------------------------------------------------------------------
// The stage machine
// ---------------------------------------------------------------------------

export async function advanceRun(context: RunContext): Promise<AdvanceResult> {
  const loaded = await context.client.query<{
    checkpoint: RunCheckpoint | null;
    documentId: string;
    workspaceId: string;
    elementId: string;
    assemblyName: string;
  }>(
    `SELECT checkpoint, document_id AS "documentId", workspace_id AS "workspaceId",
            element_id AS "elementId", assembly_name AS "assemblyName"
       FROM assembly_manual_runs WHERE id = $1::uuid`,
    [context.runId],
  );
  const row = loaded.rows[0];
  if (!row) throw new Error("Run row disappeared");

  const checkpoint: RunCheckpoint = row.checkpoint && row.checkpoint.stage ? row.checkpoint : { stage: "ingest" };

  if (await context.isCancelled()) {
    return { stage: checkpoint.stage, finished: false, cancelled: true, stepsDone: 0, stepsTotal: 0 };
  }

  // --- ingest ------------------------------------------------------------
  if (checkpoint.stage === "ingest") {
    await saveCheckpoint(context, checkpoint, progressOf("ingest", 0, 0, 0, "Reading the assembly from Onshape"));
    try {
      const result = await ingestAssembly({
        http: context.http,
        documentId: row.documentId,
        workspaceId: row.workspaceId,
        elementId: row.elementId,
        assemblyName: row.assemblyName,
        cache: checkpoint.ingestCache,
        progress: {
          onCall: async ({ calls: made, label }) => {
            if (made % 15 === 0) {
              await saveCheckpoint(
                context,
                { ...checkpoint, ingestCache: undefined },
                progressOf("ingest", 0, 0, 0, `Onshape call ${made}: ${label}`),
              );
            }
          },
          shouldStop: () => timeLeft(context) < 15_000,
        },
      });
      checkpoint.stage = "graph";
      checkpoint.facts = result.facts;
      // The raw cache has done its job; the distilled facts are what the rest
      // of the pipeline needs, and they are an order of magnitude smaller.
      checkpoint.ingestCache = undefined;
      checkpoint.report = {
        strategyUsed: "",
        checksRun: 0,
        checksPassed: 0,
        disagreements: [],
        unresolved: [],
        notes: [],
        gaps: result.facts.gaps,
        renderModes: {},
        sentenceSources: {},
        cutList: [],
        hardware: [],
        cotsCatalog: "absent",
        onshapeCalls: result.calls,
      };
      await saveCheckpoint(context, checkpoint, progressOf("graph", 0, 0, 0, "Assembly read"));
    } catch (error) {
      if (error instanceof IngestIncomplete) {
        await saveCheckpoint(
          context,
          { ...checkpoint, stage: "ingest", ingestCache: error.cache },
          progressOf("ingest", 0, 0, 0, `Paused after ${error.calls} Onshape calls; resumes here`),
        );
        return { stage: "ingest", finished: false, cancelled: false, stepsDone: 0, stepsTotal: 0 };
      }
      throw error;
    }
    if (timeLeft(context) < 10_000) {
      return { stage: "graph", finished: false, cancelled: false, stepsDone: 0, stepsTotal: 0 };
    }
  }

  const facts = checkpoint.facts;
  if (!facts) throw new Error("Checkpoint has no assembly facts to work from");
  const report = checkpoint.report ?? {
    strategyUsed: "",
    checksRun: 0,
    checksPassed: 0,
    disagreements: [],
    unresolved: [],
    notes: [],
    gaps: facts.gaps,
    renderModes: {},
    sentenceSources: {},
    cutList: [],
    hardware: [],
    cotsCatalog: "absent" as const,
    onshapeCalls: 0,
  };
  const graph = buildAssemblyGraph(facts);

  // --- graph + order + fabrication (fast, done in one slice) --------------
  if (checkpoint.stage === "graph" || checkpoint.stage === "order" || checkpoint.stage === "fabrication") {
    const ordered = deriveBuildOrder(graph);

    const featuresByElement = new Map<string, typeof facts.features>();
    for (const feature of facts.features) {
      if (!featuresByElement.has(feature.elementId)) featuresByElement.set(feature.elementId, []);
      featuresByElement.get(feature.elementId)!.push(feature);
    }
    const partsPerElement = new Map<string, number>();
    for (const part of facts.parts) {
      partsPerElement.set(part.elementId, (partsPerElement.get(part.elementId) ?? 0) + 1);
    }

    // Sub-assembly names: one model call for the whole run, not one per step.
    const subNames = new Map<string, string>();
    for (const sub of graph.subAssemblies) {
      const members = sub.instanceIds
        .filter((id) => !graph.fasteners.has(id))
        .map((id) => graph.instances.get(id)?.name ?? "")
        .filter(Boolean);
      const named = await nameSubAssembly(members, sub.name, context.invoke);
      subNames.set(sub.id, named.name);
      if (timeLeft(context) < 8_000) break;
    }

    const disagreementById = new Map(ordered.disagreements.map((entry) => [entry.instanceId, entry]));

    const plan: PlanStep[] = ordered.steps.map((step, index) => {
      const primary = graph.instances.get(step.primaryId);
      const part = primary?.partKey ? (graph.parts.get(primary.partKey) ?? null) : null;
      const sub = subAssemblyOf(graph, step.primaryId);
      const disagreement = disagreementById.get(step.primaryId);
      return {
        stepNumber: index + 1,
        primaryId: step.primaryId,
        fastenerIds: step.fastenerIds,
        subassembly: sub ? (subNames.get(sub.id) ?? sub.name) : "",
        title: primary?.name ?? step.primaryId,
        parts: stepPartsFor(graph, step.primaryId, step.fastenerIds),
        fabrication: fabricationFor({
          part,
          features: part ? (featuresByElement.get(part.elementId) ?? []) : [],
          partsInStudio: part ? (partsPerElement.get(part.elementId) ?? 1) : 1,
          isFastener: graph.fasteners.has(step.primaryId),
        }),
        feasibility: {
          prerequisites: [...(graph.adjacency.get(step.primaryId) ?? [])]
            .filter((id) => !graph.fasteners.has(id))
            .map((id) => graph.instances.get(id)?.name ?? id),
          checks: step.checks,
          notes: step.checks.filter((check) => !check.passed).map((check) => check.detail),
        },
        disagreement: disagreement
          ? {
              otherPosition:
                ordered.strategyUsed === "mate" ? disagreement.geometryPosition : disagreement.matePosition,
              strategy: ordered.strategyUsed === "mate" ? "geometry-first" : "mate dependency",
              note: disagreement.note,
            }
          : null,
      };
    });

    const instanceCount = new Map<string, number>();
    for (const instance of facts.instances) {
      if (!instance.partKey) continue;
      instanceCount.set(instance.partKey, (instanceCount.get(instance.partKey) ?? 0) + 1);
    }
    const fastenerPartKeys = new Set(
      [...graph.fasteners.keys()]
        .map((id) => graph.instances.get(id)?.partKey)
        .filter((key): key is string => Boolean(key)),
    );

    report.strategyUsed = ordered.strategyUsed;
    report.checksRun = ordered.checksRun;
    report.checksPassed = ordered.checksPassed;
    report.disagreements = ordered.disagreements;
    report.unresolved = ordered.unresolved;
    report.notes = ordered.notes;
    report.cutList = buildCutList(facts.parts, instanceCount, featuresByElement, fastenerPartKeys);
    report.hardware = buildHardwareList(facts.parts, instanceCount, fastenerPartKeys);
    report.cotsCatalog = cotsCatalogInstalled() ? "used" : "absent";

    await persistPlan(context, plan);

    checkpoint.stage = "render";
    checkpoint.plan = plan;
    checkpoint.cursor = 0;
    checkpoint.report = report;
    await saveCheckpoint(
      context,
      checkpoint,
      progressOf("render", plan.length, plan.length, 0, "Build order derived; rendering steps"),
    );
  }

  const plan = checkpoint.plan ?? [];

  // --- render -------------------------------------------------------------
  if (checkpoint.stage === "render") {
    if (checkpoint.coverPng === undefined) {
      const cover = await renderWholeAssembly(context.http, {
        documentId: facts.documentId,
        workspaceId: facts.workspaceId,
        elementId: facts.elementId,
      });
      checkpoint.coverPng = cover.pngBase64;
      checkpoint.coverNote = cover.note;
      report.onshapeCalls += 1;
      await saveCheckpoint(context, checkpoint, progressOf("render", plan.length, plan.length, 0, "Cover rendered"));
    }

    let cursor = checkpoint.cursor ?? 0;
    let hiddenSupported = checkpoint.hiddenOccurrencesSupported !== false;

    while (cursor < plan.length) {
      if (timeLeft(context) < 12_000) break;
      if (await context.isCancelled()) {
        return { stage: "render", finished: false, cancelled: true, stepsDone: cursor, stepsTotal: plan.length };
      }
      const step = plan[cursor]!;
      const placedByNow = new Set<string>();
      for (const earlier of plan.slice(0, cursor + 1)) {
        placedByNow.add(earlier.primaryId);
        for (const id of earlier.fastenerIds) placedByNow.add(id);
      }
      const hidden = facts.instances.map((instance) => instance.id).filter((id) => !placedByNow.has(id));

      const primary = graph.instances.get(step.primaryId);
      const part = primary?.partKey ? (graph.parts.get(primary.partKey) ?? null) : null;

      const rendered = await renderStep({
        http: context.http,
        assembly: { documentId: facts.documentId, workspaceId: facts.workspaceId, elementId: facts.elementId },
        hiddenInstanceIds: hidden,
        part: part
          ? {
              documentId: part.documentId,
              wvm: part.wvm,
              wvmId: part.workspaceId,
              elementId: part.elementId,
              partId: part.partId,
            }
          : null,
        partName: step.title,
        fullAssemblyPng: checkpoint.coverPng ?? null,
        tryHiddenOccurrences: hiddenSupported,
      });
      hiddenSupported = rendered.hiddenOccurrencesSupported;
      report.onshapeCalls += 1;
      report.renderModes[rendered.mode] = (report.renderModes[rendered.mode] ?? 0) + 1;

      await context.client.query(
        `UPDATE assembly_manual_steps
            SET render_png = $3::bytea, render_mode = $4::text, render_note = $5::text
          WHERE run_id = $1::uuid AND step_number = $2::int`,
        [
          context.runId,
          step.stepNumber,
          rendered.pngBase64 ? Buffer.from(rendered.pngBase64, "base64") : null,
          rendered.mode,
          rendered.note,
        ],
      );

      cursor += 1;
      if (cursor % RENDER_CHECKPOINT_EVERY === 0) {
        checkpoint.cursor = cursor;
        checkpoint.hiddenOccurrencesSupported = hiddenSupported;
        checkpoint.report = report;
        await saveCheckpoint(
          context,
          checkpoint,
          progressOf("render", plan.length, plan.length, cursor, `Rendered ${cursor} of ${plan.length} steps`),
        );
      }
    }

    checkpoint.cursor = cursor;
    checkpoint.hiddenOccurrencesSupported = hiddenSupported;
    checkpoint.report = report;
    if (cursor < plan.length) {
      await saveCheckpoint(
        context,
        checkpoint,
        progressOf("render", plan.length, plan.length, cursor, `Rendered ${cursor} of ${plan.length} steps`),
      );
      return { stage: "render", finished: false, cancelled: false, stepsDone: cursor, stepsTotal: plan.length };
    }
    checkpoint.stage = "write";
    checkpoint.cursor = 0;
    await saveCheckpoint(context, checkpoint, progressOf("write", plan.length, plan.length, cursor, "Writing steps"));
  }

  // --- write --------------------------------------------------------------
  if (checkpoint.stage === "write") {
    let cursor = checkpoint.cursor ?? 0;
    while (cursor < plan.length) {
      if (timeLeft(context) < 12_000) break;
      if (await context.isCancelled()) {
        return { stage: "write", finished: false, cancelled: true, stepsDone: cursor, stepsTotal: plan.length };
      }
      const batch = plan.slice(cursor, cursor + WRITE_BATCH);
      const facts0: StepWriteFacts[] = batch.map((step) => ({
        stepNumber: step.stepNumber,
        primaryName: step.title,
        quantity: 1,
        subassembly: step.subassembly,
        attachesTo: step.feasibility.prerequisites.slice(0, 4),
        hardware: step.parts
          .filter((part) => part.instanceId !== step.primaryId)
          .map((part) => `${part.quantity} x ${part.name}`),
        fabrication: step.fabrication.map((line) => line.text),
        cautions: step.feasibility.notes,
      }));

      const written = await writeStepSentences(facts0, context.invoke);
      if (written.note && !report.notes.includes(written.note)) report.notes.push(written.note);
      for (const item of written.steps) {
        report.sentenceSources[item.source] = (report.sentenceSources[item.source] ?? 0) + 1;
        await context.client.query(
          `UPDATE assembly_manual_steps
              SET sentence = $3::text, sentence_source = $4::text
            WHERE run_id = $1::uuid AND step_number = $2::int`,
          [context.runId, item.stepNumber, item.sentence, item.source],
        );
      }

      cursor += batch.length;
      checkpoint.cursor = cursor;
      checkpoint.report = report;
      await saveCheckpoint(
        context,
        checkpoint,
        progressOf("write", cursor, plan.length, plan.length, `Wrote ${cursor} of ${plan.length} steps`),
      );
    }
    if (cursor < plan.length) {
      return { stage: "write", finished: false, cancelled: false, stepsDone: cursor, stepsTotal: plan.length };
    }
    checkpoint.stage = "pdf";
    await saveCheckpoint(context, checkpoint, progressOf("pdf", plan.length, plan.length, plan.length, "Building the PDF"));
  }

  // --- pdf ----------------------------------------------------------------
  if (checkpoint.stage === "pdf") {
    const rows = await context.client.query<{
      stepNumber: number;
      subassembly: string;
      title: string;
      sentence: string;
      parts: StepPart[];
      fabrication: FabricationLine[];
      feasibility: { notes?: string[] };
      renderNote: string;
      png: Buffer | null;
    }>(
      `SELECT step_number AS "stepNumber", subassembly, title, sentence, parts,
              fabrication, feasibility, render_note AS "renderNote", render_png AS png
         FROM assembly_manual_steps
        WHERE run_id = $1::uuid
        ORDER BY step_number`,
      [context.runId],
    );

    const steps: ManualPdfStep[] = rows.rows.map((step) => ({
      stepNumber: step.stepNumber,
      subassembly: step.subassembly,
      title: step.title,
      sentence: step.sentence,
      parts: (step.parts ?? []).map((part) => ({
        name: part.name,
        quantity: part.quantity,
        detail: part.cots
          ? `${part.cots.vendor} ${part.cots.sku}`
          : part.extentMm
            ? `${formatInches(part.extentMm[0])} long`
            : "",
      })),
      fabrication: (step.fabrication ?? []).map((line) => ({ text: line.text, confirmed: line.confirmed })),
      notes: step.feasibility?.notes ?? [],
      png: step.png ?? null,
      renderNote: step.renderNote,
    }));

    const pdf = renderManualPdf({
      teamName: context.teamName,
      assemblyName: facts.name,
      generatedAt: new Date(),
      coverPng: checkpoint.coverPng ? Buffer.from(checkpoint.coverPng, "base64") : null,
      coverNote: checkpoint.coverNote ?? "",
      cutList: report.cutList.map((entry) => ({
        partName: entry.partName,
        material: entry.material,
        quantity: entry.quantity,
        length: entry.lengthMm === null ? null : formatInches(entry.lengthMm),
        profile: entry.profile,
        confirmed: entry.lengthConfirmed,
      })),
      hardware: report.hardware,
      steps,
      report: {
        checksRun: report.checksRun,
        checksPassed: report.checksPassed,
        disagreements: report.disagreements.length,
        unresolved: report.unresolved.length,
        strategyUsed: report.strategyUsed,
        notes: report.notes,
        gaps: report.gaps,
      },
    });

    await context.client.query(
      `UPDATE assembly_manual_runs
          SET pdf = $2::bytea, pdf_byte_size = $3::int, report = $4::jsonb,
              status = 'completed', completed_at = now(), updated_at = now(),
              checkpoint = jsonb_build_object('stage', 'done'),
              progress = $5::jsonb,
              lease_owner = NULL, lease_expires_at = NULL
        WHERE id = $1::uuid`,
      [
        context.runId,
        pdf,
        pdf.length,
        JSON.stringify(report),
        JSON.stringify(progressOf("done", plan.length, plan.length, plan.length, "Manual ready")),
      ],
    );
    return { stage: "done", finished: true, cancelled: false, stepsDone: plan.length, stepsTotal: plan.length };
  }

  return {
    stage: checkpoint.stage,
    finished: checkpoint.stage === "done",
    cancelled: false,
    stepsDone: checkpoint.cursor ?? 0,
    stepsTotal: plan.length,
  };
}

/**
 * Write the step rows. Replaces any rows from an earlier attempt at the same
 * run — a re-derived order must not leave orphaned steps behind, which would
 * show the team a manual that mixes two different build orders.
 */
async function persistPlan(context: RunContext, plan: PlanStep[]): Promise<void> {
  await context.client.query(`DELETE FROM assembly_manual_steps WHERE run_id = $1::uuid`, [context.runId]);
  for (const step of plan) {
    await context.client.query(
      `INSERT INTO assembly_manual_steps
         (org_id, run_id, step_number, subassembly, title, sentence, sentence_source,
          parts, fabrication, feasibility, disagreement, render_mode, render_note)
       VALUES ($1::uuid, $2::uuid, $3::int, $4::text, $5::text, $6::text, 'deterministic',
               $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, 'none', '')`,
      [
        context.orgId,
        context.runId,
        step.stepNumber,
        step.subassembly,
        step.title,
        // A placeholder that is already true. If the writing stage never runs,
        // the manual still reads correctly rather than showing empty steps.
        `Fit ${step.title}.`,
        JSON.stringify(step.parts),
        JSON.stringify(step.fabrication),
        JSON.stringify(step.feasibility),
        step.disagreement ? JSON.stringify(step.disagreement) : null,
      ],
    );
  }
}
