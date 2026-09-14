import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  FAILURE_REASONS,
  FILAMENT_MATERIALS,
  JOB_PRIORITIES,
  JOB_PURPOSES,
  PRINTER_STATUSES,
} from "../../../lib/print-farm";
import {
  addPrinter,
  addSpool,
  adjustSpool,
  cancelJob,
  claimJob,
  computePrintFarmView,
  failJob,
  finishJob,
  loadFilament,
  queueJob,
  setPrinterStatus,
  startJob,
  updateJob,
  updatePrinter,
  type PrintFarmView,
} from "../../../lib/print-farm/compute-print-farm";
import type {
  FailureReason,
  FilamentMaterial,
  JobPriority,
  JobPurpose,
  PrinterStatus,
} from "../../../lib/print-farm/types";

export type { PrintFarmView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function positiveIntOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function positiveNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonNegativeNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computePrintFarmView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the Print Farm. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies PrintFarmView,
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = trimmedOrNull(body.orgId, 64);
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = session.user.id;

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "add-printer": {
          const name = trimmedOrNull(body.name, 200);
          if (!name) throw new Error("name is required");
          await addPrinter(client, {
            orgId,
            userId,
            name,
            model: trimmedOrNull(body.model, 200),
            nozzleMm: positiveNumberOrNull(body.nozzleMm),
            buildXMm: positiveIntOrNull(body.buildXMm),
            buildYMm: positiveIntOrNull(body.buildYMm),
            buildZMm: positiveIntOrNull(body.buildZMm),
            equipmentAssetId: trimmedOrNull(body.equipmentAssetId, 64),
          });
          break;
        }
        case "update-printer": {
          const printerId = trimmedOrNull(body.printerId, 64);
          if (!printerId) throw new Error("printerId is required");
          await updatePrinter(client, {
            orgId,
            printerId,
            name: trimmedOrNull(body.name, 200),
            model: trimmedOrNull(body.model, 200),
            active: boolOrNull(body.active),
          });
          break;
        }
        case "set-printer-status": {
          const printerId = trimmedOrNull(body.printerId, 64);
          const status = oneOf<PrinterStatus>(PRINTER_STATUSES, body.status);
          if (!printerId) throw new Error("printerId is required");
          if (!status) throw new Error("status is required");
          await setPrinterStatus(client, { orgId, printerId, status });
          break;
        }
        case "load-filament": {
          const printerId = trimmedOrNull(body.printerId, 64);
          if (!printerId) throw new Error("printerId is required");
          await loadFilament(client, { orgId, printerId, filamentId: trimmedOrNull(body.filamentId, 64) });
          break;
        }
        case "add-spool": {
          const material = oneOf<FilamentMaterial>(FILAMENT_MATERIALS, body.material) ?? "pla";
          const gramsRemaining = nonNegativeNumberOrNull(body.gramsRemaining);
          const spoolGramsTotal = positiveNumberOrNull(body.spoolGramsTotal);
          await addSpool(client, {
            orgId,
            userId,
            material,
            brand: trimmedOrNull(body.brand, 200),
            color: trimmedOrNull(body.color, 100),
            diameterMm: positiveNumberOrNull(body.diameterMm),
            spoolGramsTotal,
            gramsRemaining: gramsRemaining ?? spoolGramsTotal ?? 0,
            unitCostUsd: nonNegativeNumberOrNull(body.unitCostUsd),
            vendor: trimmedOrNull(body.vendor, 200),
            openedOn: isoDateOrNull(body.openedOn),
          });
          break;
        }
        case "adjust-spool": {
          const filamentId = trimmedOrNull(body.filamentId, 64);
          const grams = Number(body.grams);
          const reason = oneOf(["restock", "audit", "waste", "purge"] as const, body.reason) ?? "audit";
          if (!filamentId) throw new Error("filamentId is required");
          if (!Number.isFinite(grams) || grams === 0) throw new Error("grams must be a non-zero number");
          await adjustSpool(client, { orgId, userId, filamentId, grams, reason });
          break;
        }
        case "queue-job": {
          const partName = trimmedOrNull(body.partName, 300);
          if (!partName) throw new Error("partName is required");
          const seasonYear = positiveIntOrNull(body.seasonYear) ?? new Date().getUTCFullYear();
          await queueJob(client, {
            orgId,
            userId,
            seasonYear,
            partName,
            quantity: positiveIntOrNull(body.quantity) ?? 1,
            purpose: oneOf<JobPurpose>(JOB_PURPOSES, body.purpose) ?? "competition_robot",
            priority: oneOf<JobPriority>(JOB_PRIORITIES, body.priority) ?? "normal",
            subsystemName: trimmedOrNull(body.subsystemName, 200),
            printerId: trimmedOrNull(body.printerId, 64),
            filamentId: trimmedOrNull(body.filamentId, 64),
            estimatedMinutes: positiveIntOrNull(body.estimatedMinutes),
            estimatedGrams: positiveNumberOrNull(body.estimatedGrams),
            neededBy: isoDateOrNull(body.neededBy),
            reprintOfJobId: trimmedOrNull(body.reprintOfJobId, 64),
          });
          break;
        }
        case "update-job": {
          const jobId = trimmedOrNull(body.jobId, 64);
          if (!jobId) throw new Error("jobId is required");
          await updateJob(client, {
            orgId,
            jobId,
            priority: oneOf<JobPriority>(JOB_PRIORITIES, body.priority),
            printerId: trimmedOrNull(body.printerId, 64),
            filamentId: trimmedOrNull(body.filamentId, 64),
            estimatedMinutes: positiveIntOrNull(body.estimatedMinutes),
            estimatedGrams: positiveNumberOrNull(body.estimatedGrams),
            neededBy: isoDateOrNull(body.neededBy),
          });
          break;
        }
        case "claim-job": {
          const jobId = trimmedOrNull(body.jobId, 64);
          if (!jobId) throw new Error("jobId is required");
          await claimJob(client, { orgId, userId, jobId });
          break;
        }
        case "start-job": {
          const jobId = trimmedOrNull(body.jobId, 64);
          if (!jobId) throw new Error("jobId is required");
          await startJob(client, {
            orgId,
            jobId,
            printerId: trimmedOrNull(body.printerId, 64),
            filamentId: trimmedOrNull(body.filamentId, 64),
          });
          break;
        }
        case "finish-job": {
          const jobId = trimmedOrNull(body.jobId, 64);
          if (!jobId) throw new Error("jobId is required");
          await finishJob(client, {
            orgId,
            userId,
            jobId,
            actualMinutes: positiveIntOrNull(body.actualMinutes),
            actualGrams: positiveNumberOrNull(body.actualGrams),
          });
          break;
        }
        case "fail-job": {
          const jobId = trimmedOrNull(body.jobId, 64);
          if (!jobId) throw new Error("jobId is required");
          const failureReason = oneOf<FailureReason>(FAILURE_REASONS, body.failureReason) ?? "other";
          await failJob(client, {
            orgId,
            userId,
            jobId,
            failureReason,
            actualMinutes: positiveIntOrNull(body.actualMinutes),
            wastedGrams: positiveNumberOrNull(body.wastedGrams),
          });
          break;
        }
        case "cancel-job": {
          const jobId = trimmedOrNull(body.jobId, 64);
          if (!jobId) throw new Error("jobId is required");
          await cancelJob(client, { orgId, jobId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computePrintFarmView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Print Farm request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
