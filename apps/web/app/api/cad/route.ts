import { randomUUID } from "node:crypto";
import { auth } from "@vantage/core";
import { withRls, withSavepoint } from "@vantage/db";
import {
  buildDefaultCadPlan,
  cadAiPlanUserMessage,
  CAD_OPERATIONS,
  canAutoRunWithinAllowlist,
  CadRepository,
  DeterministicMockCadAdapter,
  OnshapeHostedCadAdapter,
  parseCadActionPlan,
  createOnshapeApiTransport,
  onshapeSetupStatus,
  cadOsSupportMatrix,
  listOnshapeDocuments,
  listOnshapeElements,
  listOnshapeFeatures,
  listOnshapeNativeEntities,
  listOnshapeAssemblyInstances,
  listOnshapeNativeVariables,
  pickVariableStudioElementId,
  updateOnshapeFeature,
  explainFeatureTreeForStudents,
  FUSION_RELAY_IMPLEMENTED_OPERATIONS,
  fusionRelayImplements,
  type CadAction,
  type CadBrainMode,
  type EngineeringBrief,
  type OnshapeDocumentRef,
} from "@vantage/cad";
import {
  getOrgPromptCachingEnabled,
  resolveOrgChatAdapter,
  type ContextSource,
} from "@vantage/agent";
import { createBridgeTransport } from "../../../lib/ai-bridge/transport";
import { meteredAI } from "@vantage/billing";
import { headers } from "next/headers";
import {
  loadCadAdaptiveContext,
  parseCadTeamProfile,
  parseCadUserPreferences,
} from "../../../lib/cad/adaptive-context";
import { failMeteredAi } from "../../../lib/metered-ai-fail";
import { hostedOnshapeEnvAuth, readHostedOnshapeEnvFlags } from "../../../lib/cad/hosted-auth";
import { loadCadAgentOnshape } from "../../../lib/cad/onshape-tokens";
import { refreshShadedPngBase64 } from "../../../lib/cad/shaded-view";

async function current() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}
const fail = (error: unknown) => failMeteredAi(error, "CAD request failed");

/**
 * CAD planning can reach a real upstream model (BYOK/hosted adapter). A bridged turn (a paired device with
 * coverage 'everything') holds the request open for the bridge poll budget
 * (BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS, 240s), so this function declares 300s to keep
 * headroom above it; the adapter's own timeout still fires first and returns a
 * classified error instead of the platform killing the function mid-request.
 *
 * 300s is only honored where the hosting plan's Node function cap reaches it. Below
 * that cap set VANTAGE_BRIDGE_MAX_WAIT_MS so the turn falls through to the team's own
 * keys instead of 504-ing — see docs/AI_BRIDGE.md "Function duration".
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const session = await current();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const jobId = url.searchParams.get("jobId");
    if (!orgId) throw new Error("orgId is required");
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const jobs = await client.query(
        `SELECT id,title,platform,execution_mode AS "executionMode",status,brief,brief_confirmed_at AS "briefConfirmedAt",current_checkpoint_id AS "currentCheckpointId",updated_at AS "updatedAt" FROM cad_jobs WHERE org_id=$1 AND created_by=$2 ORDER BY updated_at DESC LIMIT 30`,
        [orgId, session.user.id],
      );
      const detail = jobId
        ? {
            steps: (
              await client.query(
                `SELECT id,sequence,operation,parameters,status,requires_approval AS "requiresApproval",approval_status AS "approvalStatus",progress,output,error FROM cad_job_steps WHERE org_id=$1 AND job_id=$2 ORDER BY sequence`,
                [orgId, jobId],
              )
            ).rows,
            artifacts: (
              await client.query(
                `SELECT id,type,title,version,content,checksum,created_at AS "createdAt" FROM cad_artifacts WHERE org_id=$1 AND job_id=$2 ORDER BY created_at DESC`,
                [orgId, jobId],
              )
            ).rows,
            checkpoints: (
              await client.query(
                `SELECT id,external_version_ref AS "externalVersionRef",topology,human_edit_detected AS "humanEditDetected",created_at AS "createdAt" FROM cad_checkpoints WHERE org_id=$1 AND job_id=$2 ORDER BY created_at DESC`,
                [orgId, jobId],
              )
            ).rows,
            contextLinks: (
              await client.query(
                `SELECT source_kind AS "sourceKind",source_id AS "sourceId",relation,metadata,created_at AS "createdAt"
                 FROM feature_context_links
                 WHERE org_id=$1 AND target_kind='cad_job' AND target_id=$2
                 ORDER BY created_at DESC LIMIT 80`,
                [orgId, jobId],
              )
            ).rows,
          }
        : null;
      const devices = await client.query(
        `SELECT id,machine_name AS "machineName",platform,status,cli_version AS "cliVersion",last_seen_at AS "lastSeenAt",revoked_at AS "revokedAt" FROM cad_relay_devices WHERE org_id=$1 ORDER BY created_at DESC`,
        [orgId],
      );
      const usage = await client.query(
        `SELECT id,feature,model,key_source AS "keySource",cost_usd::text AS "costUsd",metadata,created_at AS "createdAt"
         FROM ai_usage_events WHERE org_id=$1 AND feature='cad' ORDER BY created_at DESC LIMIT 12`,
        [orgId],
      );
      return {
        jobs: jobs.rows,
        detail,
        devices: devices.rows,
        usage: usage.rows,
        mechanisms: (
          await client.query(
            `SELECT id,name,category,description,version,updated_at AS "updatedAt" FROM cad_mechanisms WHERE org_id=$1 ORDER BY category,name`,
            [orgId],
          )
        ).rows,
        onshapeConnections: (
          await client.query(
            `SELECT id,status,label,external_account_ref AS "externalAccountRef",last_tested_at AS "lastTestedAt"
             FROM cad_connections
             WHERE org_id=$1 AND user_id=$2 AND platform='onshape' AND disabled_at IS NULL ORDER BY updated_at DESC LIMIT 5`,
            [orgId, session.user.id],
          )
        ).rows,
        adaptive: await loadCadAdaptiveContext(client, orgId, session.user.id),
      };
    });
    const hosted = hostedOnshapeEnvAuth(readHostedOnshapeEnvFlags());
    return Response.json({
      ...data,
      onshape: {
        ...onshapeSetupStatus(),
        configured: hosted.configured,
        setupRequired: hosted.setupRequired,
        message: hosted.setupRequired
          ? "Connect Onshape with OAuth in /cad/connections. Server API keys do not count as hosted CAD."
          : onshapeSetupStatus().message,
      },
      onshapeConfigured: hosted.configured,
      osSupport: cadOsSupportMatrix(),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await current();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    if (!orgId) throw new Error("orgId is required");
    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2`, [
        orgId,
        session.user.id,
      ]);
      if (!member.rowCount) throw new Error("Organization access denied");
      const repository = new CadRepository(client);
      const action = String(body.action ?? "");
      if (action === "save-user-preferences") {
        const preferences = parseCadUserPreferences(body);
        await client.query(
          `INSERT INTO cad_user_preferences(
             org_id,user_id,response_style,explanation_depth,preferred_units,preferred_platform,custom_instructions
           ) VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT(org_id,user_id) DO UPDATE SET
             response_style=excluded.response_style,explanation_depth=excluded.explanation_depth,
             preferred_units=excluded.preferred_units,preferred_platform=excluded.preferred_platform,
             custom_instructions=excluded.custom_instructions,updated_at=now()`,
          [
            orgId,session.user.id,preferences.responseStyle,preferences.explanationDepth,
            preferences.preferredUnits,preferences.preferredPlatform,preferences.customInstructions,
          ],
        );
        return { preferences };
      }
      if (action === "save-team-profile") {
        const adaptive = await loadCadAdaptiveContext(client, orgId, session.user.id);
        if (!adaptive.canManageTeamProfile) throw new Error("Owner or admin role required to change team CAD standards");
        const profile = parseCadTeamProfile(body);
        await client.query(
          `INSERT INTO cad_team_profiles(
             org_id,default_platform,preferred_units,manufacturing_processes,preferred_materials,
             standard_components,design_rules,updated_by
           ) VALUES($1,$2,$3,$4::text[],$5::text[],$6::text[],$7::text[],$8)
           ON CONFLICT(org_id) DO UPDATE SET
             default_platform=excluded.default_platform,preferred_units=excluded.preferred_units,
             manufacturing_processes=excluded.manufacturing_processes,
             preferred_materials=excluded.preferred_materials,standard_components=excluded.standard_components,
             design_rules=excluded.design_rules,updated_by=excluded.updated_by,updated_at=now()`,
          [
            orgId,profile.defaultPlatform,profile.preferredUnits,profile.manufacturingProcesses,
            profile.preferredMaterials,profile.standardComponents,profile.designRules,session.user.id,
          ],
        );
        return { profile };
      }
      if (action === "brief") {
        const adaptive = await loadCadAdaptiveContext(client, orgId, session.user.id);
        const teamKey = String(body.teamKey ?? "");
        const sources: ContextSource[] = [];
        if (teamKey) {
          const metrics = (
            await client.query(
              `SELECT team_key,event_key,epa_total,epa_auto,epa_teleop,epa_endgame,rank,wins,losses,ties,source,synced_at FROM team_event_metrics WHERE team_key=$1 ORDER BY synced_at DESC LIMIT 6`,
              [teamKey],
            )
          ).rows;
          metrics.forEach((value, index) =>
            sources.push({
              type: "module_data",
              id: `metric:${teamKey}:${index}`,
              content: JSON.stringify(value),
              importance: 1,
              classification: "hard_metric",
            }),
          );
          const scouting = (
            await client.query(
              `SELECT id,payload,confidence,match_key,created_at FROM match_scout_entries WHERE org_id=$1 AND team_key=$2 ORDER BY created_at DESC LIMIT 12`,
              [orgId, teamKey],
            )
          ).rows;
          scouting.forEach((value) =>
            sources.push({
              type: "module_data",
              id: String(value.id),
              content: JSON.stringify(value),
              importance: 0.9,
              classification: "scout_observation",
            }),
          );
          const findings = (
            await client.query(
              `SELECT id,summary,confidence,source_url,found_at FROM research_findings WHERE team_key=$1 ORDER BY found_at DESC LIMIT 8`,
              [teamKey],
            )
          ).rows;
          findings.forEach((value) =>
            sources.push({
              type: "module_data",
              id: String(value.id),
              content: String(value.summary),
              importance: Number(value.confidence),
              classification: "researched_claim",
              sourceUrl: String(value.source_url),
              observedAt: new Date(String(value.found_at)).toISOString(),
            }),
          );
        }

        // FMEA unavailable — continue without invented risks. Savepointed, because
        // createBriefJob writes below and a plain catch would have left the
        // transaction aborted and thrown the brief away at COMMIT.
        await withSavepoint(client, async () => {
          const { loadRepeatFailureAlerts } = await import("../../../lib/fmea/repeat-failures");
          const alerts = await loadRepeatFailureAlerts(client, orgId, { limit: 8 });
          for (const alert of alerts) {
            sources.push({
              type: "module_data",
              id: `fmea:repeat:${alert.subsystemName}`,
              content: [
                alert.message,
                alert.openCount ? `${alert.openCount} still open` : null,
                alert.recentTitles.length ? `Recent: ${alert.recentTitles.join("; ")}` : null,
                `Max RPN ${alert.maxRpn} (${alert.level})`,
              ]
                .filter(Boolean)
                .join(" · "),
              importance: 0.95,
              classification: "hard_metric",
            });
          }
        }, undefined);
        const matchKey = body.matchKey ? String(body.matchKey).trim() : "";
        const seasonYearRaw = body.seasonYear != null ? Number(body.seasonYear) : NaN;
        const seasonYear =
          Number.isInteger(seasonYearRaw) && seasonYearRaw >= 1992 && seasonYearRaw <= 2100
            ? seasonYearRaw
            : undefined;
        return repository.createBriefJob({
          orgId,
          userId: session.user.id,
          threadId: body.threadId ? String(body.threadId) : undefined,
          requestId: randomUUID(),
          title: String(body.title ?? "Engineering concept"),
          request: String(body.request ?? ""),
          sources,
          platform: (body.platform ?? adaptive.userPreferences.preferredPlatform ?? adaptive.teamProfile.defaultPlatform) as "onshape" | "fusion360" | "mock",
          executionMode: (body.executionMode ?? "hosted") as "hosted" | "local",
          selected: {
            ...(teamKey ? { teamKey } : {}),
            ...(matchKey ? { matchKey } : {}),
          },
          seasonYear,
          teamProfile: adaptive.teamProfile,
          userPreferences: { preferredUnits: adaptive.userPreferences.preferredUnits },
        });
      }
      if (action === "confirm")
        return repository.confirmBrief(orgId, String(body.jobId), session.user.id, body.brief as EngineeringBrief);
      if (action === "plan")
        return repository.savePlan(orgId, String(body.jobId), session.user.id, body.actions as CadAction[]);
      if (action === "plan-default") {
        const adaptive = await loadCadAdaptiveContext(client, orgId, session.user.id);
        const job = (
          await client.query<{ brief: EngineeringBrief; platform: string }>(
            `SELECT brief,platform FROM cad_jobs WHERE id=$1 AND org_id=$2 AND brief_confirmed_at IS NOT NULL`,
            [body.jobId, orgId],
          )
        ).rows[0];
        if (!job) throw new Error("Confirm the engineering brief before planning");
        const includeExportRaw = String(body.includeExport ?? "");
        const includeExport =
          includeExportRaw === "step" || includeExportRaw === "stl" || includeExportRaw === "gltf"
            ? includeExportRaw
            : job.platform === "onshape" && body.includeExport !== false
              ? ("step" as const)
              : false;
        const plan = buildDefaultCadPlan(job.brief, {
          autoRunVerify: Boolean(body.autoRunVerify),
          includeExport,
          teamProfile: adaptive.teamProfile,
          userPreferences: adaptive.userPreferences,
        });
        await repository.savePlan(orgId, String(body.jobId), session.user.id, plan);
        return { actions: plan, planner: "starter" as const };
      }
      if (action === "plan-ai") {
        const brainMode = String(body.brainMode ?? "managed_api") as CadBrainMode;
        if (brainMode === "mock") {
          throw new Error("Mock brain uses the starter plan. Switch AI brain to Vantage managed API for a metered CAD plan.");
        }
        const adaptive = await loadCadAdaptiveContext(client, orgId, session.user.id);
        const job = (
          await client.query<{ brief: EngineeringBrief; platform: string }>(
            `SELECT brief,platform FROM cad_jobs WHERE id=$1 AND org_id=$2 AND brief_confirmed_at IS NOT NULL`,
            [body.jobId, orgId],
          )
        ).rows[0];
        if (!job) throw new Error("Confirm the engineering brief before planning");
        const includeExportRaw = String(body.includeExport ?? "");
        const includeExport =
          includeExportRaw === "step" || includeExportRaw === "stl" || includeExportRaw === "gltf"
            ? includeExportRaw
            : job.platform === "onshape" && body.includeExport !== false
              ? ("step" as const)
              : false;
        const promptCachingEnabled = await getOrgPromptCachingEnabled(client, orgId);
        const adapter = await resolveOrgChatAdapter(client, {
          orgId,
          promptCachingEnabled,
          feature: "cad",
          bridgeTransport: createBridgeTransport(),
        });
        const requestId = randomUUID();
        const message = cadAiPlanUserMessage(job.brief, {
          autoRunVerify: Boolean(body.autoRunVerify),
          includeExport,
          teamProfile: adaptive.teamProfile,
          userPreferences: adaptive.userPreferences,
        });
        const text = await meteredAI({
          client,
          orgId,
          userId: session.user.id,
          feature: "cad",
          requestId,
          estimatedCostUsd: 0.02,
          estimatedPromptTokens: Math.ceil(message.length / 4),
          estimatedCompletionTokens: 800,
          provider: adapter.provider,
          model: adapter.model,
          metadata: {
            jobId: body.jobId,
            action: "plan-ai",
            ledgerTag: `cad:plan-ai:${String(body.jobId).slice(0, 8)}`,
          },
          invoke: async () => {
            const result = await adapter.complete({
              message,
              context: [],
              promptCachingEnabled,
            });
            return {
              value: result.text,
              promptTokens: result.promptTokens,
              completionTokens: result.completionTokens,
              costUsd: result.costUsd,
              model: adapter.model,
              provider: adapter.provider,
              cacheReadInputTokens: result.cacheReadInputTokens,
              cacheWriteInputTokens: result.cacheWriteInputTokens,
              uncachedInputTokens: result.uncachedInputTokens,
            };
          },
        });
        const plan = parseCadActionPlan(text, {
          autoRunVerify: Boolean(body.autoRunVerify),
          includeExport,
          teamProfile: adaptive.teamProfile,
          userPreferences: adaptive.userPreferences,
        });
        await repository.savePlan(orgId, String(body.jobId), session.user.id, plan);
        return { actions: plan, planner: "ai" as const, provider: adapter.provider, model: adapter.model };
      }
      if (action === "append-step") {
        const operation = String(body.operation ?? "");
        if (!CAD_OPERATIONS.includes(operation as (typeof CAD_OPERATIONS)[number])) {
          throw new Error("Choose an allowlisted CAD operation");
        }
        if (operation === "feature_script") {
          throw new Error(
            "FeatureScript is not allowed from hosted CAD. Use a native Onshape operation a human can re-edit.",
          );
        }
        const job = (
          await client.query<{ platform: string }>(
            `SELECT platform FROM cad_jobs WHERE id=$1 AND org_id=$2 AND created_by=$3`,
            [body.jobId, orgId, session.user.id],
          )
        ).rows[0];
        if (!job) throw new Error("CAD job not found");
        // Single source of truth: FUSION_RELAY_IMPLEMENTED_OPERATIONS in
        // packages/cad/src/fusion-relay.ts, kept in lockstep with the add-in's own
        // IMPLEMENTED set. A local list here drifted once already and let steps be
        // planned for operations the add-in refuses at execution time.
        if (job.platform === "fusion360" && !fusionRelayImplements(operation)) {
          throw new Error(
            `${operation} is not implemented by the Fusion desktop add-in. Fusion runs: ${FUSION_RELAY_IMPLEMENTED_OPERATIONS.join(", ")}. Use an Onshape job for anything else.`,
          );
        }
        const parameters = body.parameters && typeof body.parameters === "object" && !Array.isArray(body.parameters)
          ? (body.parameters as Record<string, unknown>)
          : {};
        if (JSON.stringify(parameters).length > 20_000) throw new Error("CAD parameters exceed the complexity limit");
        const reason = String(body.reason ?? "User-added reviewed CAD operation").trim().slice(0, 1000);
        const cadAction: CadAction = {
          operation: operation as CadAction["operation"],
          parameters,
          reason,
          requiresApproval: !canAutoRunWithinAllowlist(operation as CadAction["operation"], Boolean(body.autoRunVerify)),
        };
        return repository.appendPlanStep(orgId, String(body.jobId), session.user.id, cadAction);
      }
      if (action === "approve")
        return repository.approveStep(
          orgId,
          String(body.jobId),
          String(body.stepId),
          session.user.id,
          Boolean(body.approved),
        );
      if (action === "execute-mock")
        return repository.executeStep(
          orgId,
          String(body.jobId),
          String(body.stepId),
          session.user.id,
          new DeterministicMockCadAdapter(),
        );
      if (action === "execute-api-stub") {
        const executed = await repository.executeStep(
          orgId,
          String(body.jobId),
          String(body.stepId),
          session.user.id,
          new DeterministicMockCadAdapter(),
        );
        return {
          ...executed,
          keySource: "local" as const,
          costUsd: 0,
          note: "Mock adapter execute — AI planning is plan-ai. Live geometry is Onshape/Fusion, not this path.",
        };
      }
      if (action === "set-document") {
        const documentRef = body.documentRef as OnshapeDocumentRef;
        if (!documentRef?.documentId || !documentRef?.workspaceId || !documentRef?.elementId) {
          throw new Error("documentRef requires documentId, workspaceId, and elementId");
        }
        const { connectionId } = await loadCadAgentOnshape(client, orgId, session.user.id);
        await client.query(
          `UPDATE cad_jobs SET document_ref=$3::jsonb,connection_id=$4,updated_at=now()
           WHERE id=$1 AND org_id=$2 AND created_by=$5 AND platform='onshape'`,
          [body.jobId, orgId, JSON.stringify(documentRef), connectionId, session.user.id],
        );
        return { success: true, documentRef };
      }
      if (action === "execute-onshape") {
        const job = (
          await client.query<{ document_ref: OnshapeDocumentRef | null; platform: string }>(
            `SELECT document_ref,platform FROM cad_jobs WHERE id=$1 AND org_id=$2 AND created_by=$3`,
            [body.jobId, orgId, session.user.id],
          )
        ).rows[0];
        if (!job || job.platform !== "onshape") throw new Error("Onshape job not found");
        if (!job.document_ref?.documentId) {
          throw new Error("Select an Onshape document/workspace/element before execute");
        }
        const onshape = await loadCadAgentOnshape(client, orgId, session.user.id);
        const adapter = new OnshapeHostedCadAdapter(
          createOnshapeApiTransport({
            http: onshape.http,
            document: job.document_ref,
          }),
        );
        const executed = await repository.executeStep(
          orgId,
          String(body.jobId),
          String(body.stepId),
          session.user.id,
          adapter,
        );
        await client.query(
          `INSERT INTO ai_usage_events
            (org_id, user_id, feature, model, provider, key_source, prompt_tokens, completion_tokens, total_tokens, cost_usd, request_id, metadata)
           VALUES ($1,$2,'cad','onshape-hosted','onshape','platform',0,0,0,0,$3,$4::jsonb)`,
          [
            orgId,
            session.user.id,
            randomUUID(),
            JSON.stringify({
              ledgerTag: `cad:onshape:${String(body.jobId).slice(0, 8)}`,
              action: "execute-onshape",
              authPath: onshape.via,
              jobId: body.jobId,
              stepId: body.stepId,
            }),
          ],
        );
        const shadedPngBase64 = await refreshShadedPngBase64(onshape.http, job.document_ref);
        return { ...executed, shadedPngBase64 };
      }
      if (action === "list-onshape-documents") {
        const onshape = await loadCadAgentOnshape(client, orgId, session.user.id);
        const documents = await listOnshapeDocuments(onshape.http);
        return {
          documents,
          configured: true,
          setupRequired: false,
          message: `Onshape connected via ${onshape.via === "oauth" ? "OAuth" : "server API key"}.`,
          authPath: onshape.via,
        };
      }
      if (action === "list-onshape-elements") {
        const documentId = String(body.documentId ?? "");
        const workspaceId = String(body.workspaceId ?? "");
        if (!documentId || !workspaceId) throw new Error("documentId and workspaceId are required");
        const onshape = await loadCadAgentOnshape(client, orgId, session.user.id);
        const elements = await listOnshapeElements(onshape.http, documentId, workspaceId);
        return { elements, authPath: onshape.via };
      }
      if (action === "update-onshape-feature") {
        const documentRef = body.documentRef as OnshapeDocumentRef | undefined;
        const jobId = body.jobId ? String(body.jobId) : "";
        let ref = documentRef;
        if (!ref?.documentId && jobId) {
          const job = (
            await client.query<{ document_ref: OnshapeDocumentRef | null }>(
              `SELECT document_ref FROM cad_jobs WHERE id=$1 AND org_id=$2 AND created_by=$3`,
              [jobId, orgId, session.user.id],
            )
          ).rows[0];
          ref = job?.document_ref ?? undefined;
        }
        if (!ref?.documentId || !ref.workspaceId || !ref.elementId) {
          throw new Error("Bind an Onshape document/workspace/element first");
        }
        const onshape = await loadCadAgentOnshape(client, orgId, session.user.id);
        const updated = await updateOnshapeFeature(onshape.http, {
          document: ref,
          featureId: body.featureId,
          depthMm: body.depthMm ?? body.depth,
          widthMm: body.widthMm ?? body.width,
          heightMm: body.heightMm ?? body.height,
          radiusMm: body.radiusMm ?? body.radius,
          diameterMm: body.diameterMm ?? body.diameter,
          thicknessMm: body.thicknessMm ?? body.thickness,
        } as Parameters<typeof updateOnshapeFeature>[1]);
        const shadedPngBase64 = await refreshShadedPngBase64(onshape.http, ref);
        return { ...updated, documentRef: ref, authPath: onshape.via, shadedPngBase64 };
      }
      if (action === "explain-onshape-features") {
        const documentRef = body.documentRef as OnshapeDocumentRef | undefined;
        const jobId = body.jobId ? String(body.jobId) : "";
        let ref = documentRef;
        if (!ref?.documentId && jobId) {
          const job = (
            await client.query<{ document_ref: OnshapeDocumentRef | null }>(
              `SELECT document_ref FROM cad_jobs WHERE id=$1 AND org_id=$2 AND created_by=$3`,
              [jobId, orgId, session.user.id],
            )
          ).rows[0];
          ref = job?.document_ref ?? undefined;
        }
        if (!ref?.documentId || !ref.workspaceId || !ref.elementId) {
          throw new Error("Bind an Onshape document/workspace/element first");
        }
        const onshape = await loadCadAgentOnshape(client, orgId, session.user.id);
        const features = await listOnshapeFeatures(onshape.http, ref);
        return {
          features,
          explain: explainFeatureTreeForStudents(features),
          documentRef: ref,
          authPath: onshape.via,
        };
      }
      if (action === "list-onshape-entities") {
        const documentRef = body.documentRef as OnshapeDocumentRef | undefined;
        const jobId = body.jobId ? String(body.jobId) : "";
        let ref = documentRef;
        if (!ref?.documentId && jobId) {
          const job = (
            await client.query<{ document_ref: OnshapeDocumentRef | null }>(
              `SELECT document_ref FROM cad_jobs WHERE id=$1 AND org_id=$2 AND created_by=$3`,
              [jobId, orgId, session.user.id],
            )
          ).rows[0];
          ref = job?.document_ref ?? undefined;
        }
        if (!ref?.documentId || !ref.workspaceId || !ref.elementId) {
          throw new Error("Bind an Onshape document/workspace/element first");
        }
        const onshape = await loadCadAgentOnshape(client, orgId, session.user.id);
        const entities = await listOnshapeNativeEntities(onshape.http, ref);
        return { entities, documentRef: ref, authPath: onshape.via };
      }
      if (action === "list-onshape-variables") {
        const documentRef = body.documentRef as OnshapeDocumentRef | undefined;
        const jobId = body.jobId ? String(body.jobId) : "";
        let ref = documentRef;
        if (!ref?.documentId && jobId) {
          const job = (
            await client.query<{ document_ref: OnshapeDocumentRef | null }>(
              `SELECT document_ref FROM cad_jobs WHERE id=$1 AND org_id=$2 AND created_by=$3`,
              [jobId, orgId, session.user.id],
            )
          ).rows[0];
          ref = job?.document_ref ?? undefined;
        }
        if (!ref?.documentId || !ref.workspaceId || !ref.elementId) {
          throw new Error("Bind an Onshape document/workspace/element first");
        }
        const onshape = await loadCadAgentOnshape(client, orgId, session.user.id);
        const elements = await listOnshapeElements(onshape.http, ref.documentId, ref.workspaceId);
        const variableStudioElementId = pickVariableStudioElementId(
          elements,
          body.variableStudioElementId ?? body.elementId,
        );
        if (!variableStudioElementId) {
          return { variables: [], documentRef: ref, variableStudioElementId: null, authPath: onshape.via };
        }
        const target = {
          documentId: ref.documentId,
          workspaceId: ref.workspaceId,
          elementId: variableStudioElementId,
        };
        const variables = await listOnshapeNativeVariables(onshape.http, target);
        return {
          variables,
          documentRef: ref,
          variableStudioElementId,
          authPath: onshape.via,
        };
      }
      if (action === "list-onshape-assembly") {
        const documentRef = body.documentRef as OnshapeDocumentRef | undefined;
        const jobId = body.jobId ? String(body.jobId) : "";
        let ref = documentRef;
        if (!ref?.documentId && jobId) {
          const job = (
            await client.query<{ document_ref: OnshapeDocumentRef | null }>(
              `SELECT document_ref FROM cad_jobs WHERE id=$1 AND org_id=$2 AND created_by=$3`,
              [jobId, orgId, session.user.id],
            )
          ).rows[0];
          ref = job?.document_ref ?? undefined;
        }
        if (!ref?.documentId || !ref.workspaceId || !ref.elementId) {
          throw new Error("Bind an Onshape document/workspace/element first");
        }
        const assemblyElementId = String(body.assemblyElementId ?? "").trim();
        if (!assemblyElementId) {
          return { instances: [], assemblyElementId: "", documentRef: ref };
        }
        const onshape = await loadCadAgentOnshape(client, orgId, session.user.id);
        const instances = await listOnshapeAssemblyInstances(onshape.http, {
          documentId: ref.documentId,
          workspaceId: ref.workspaceId,
          elementId: assemblyElementId,
        });
        return { instances, documentRef: ref, assemblyElementId, authPath: onshape.via };
      }
      if (action === "cancel") {
        await client.query(
          `UPDATE cad_jobs SET cancel_requested_at=now(),status='cancelled',updated_at=now() WHERE id=$1 AND org_id=$2 AND created_by=$3`,
          [body.jobId, orgId, session.user.id],
        );
        await client.query(
          `UPDATE cad_job_steps SET status='cancelled',error=COALESCE(error,'Cancelled by user')
           WHERE job_id=$1 AND org_id=$2 AND status IN ('planned','running')`,
          [body.jobId, orgId],
        );
        await client.query(
          `INSERT INTO ai_usage_events
            (org_id, user_id, feature, model, provider, key_source, prompt_tokens, completion_tokens, total_tokens, cost_usd, request_id, metadata)
           VALUES ($1,$2,'cad','cad-control','vantage-cad','platform',0,0,0,0,$3,$4::jsonb)`,
          [
            orgId,
            session.user.id,
            randomUUID(),
            JSON.stringify({
              ledgerTag: `cad:cancel:${String(body.jobId).slice(0, 8)}`,
              action: "cancel",
              jobId: body.jobId,
            }),
          ],
        );
        return { success: true };
      }
      if (action === "retry") {
        const stepId = String(body.stepId ?? "");
        if (!stepId) throw new Error("stepId is required to retry");
        const updated = await client.query(
          `UPDATE cad_job_steps
           SET status='planned',progress=0,error=NULL,output=NULL,started_at=NULL,completed_at=NULL,
               approval_status=CASE WHEN requires_approval THEN 'pending' ELSE 'approved' END,
               approved_by=NULL,approved_at=NULL
           WHERE id=$1 AND job_id=$2 AND org_id=$3 AND status IN ('failed','cancelled')
           RETURNING id,operation`,
          [stepId, body.jobId, orgId],
        );
        if (!updated.rowCount) throw new Error("Only failed or cancelled steps can be retried");
        await client.query(
          `UPDATE cad_jobs SET status='awaiting_action_approval',cancel_requested_at=NULL,updated_at=now()
           WHERE id=$1 AND org_id=$2 AND created_by=$3`,
          [body.jobId, orgId, session.user.id],
        );
        await client.query(
          `INSERT INTO ai_usage_events
            (org_id, user_id, feature, model, provider, key_source, prompt_tokens, completion_tokens, total_tokens, cost_usd, request_id, metadata)
           VALUES ($1,$2,'cad','cad-control','vantage-cad','platform',0,0,0,0,$3,$4::jsonb)`,
          [
            orgId,
            session.user.id,
            randomUUID(),
            JSON.stringify({
              ledgerTag: `cad:retry:${String(body.jobId).slice(0, 8)}`,
              action: "retry",
              jobId: body.jobId,
              stepId,
              operation: updated.rows[0]?.operation,
            }),
          ],
        );
        return { success: true, stepId };
      }
      if (action === "revoke-device") {
        await client.query(
          `UPDATE cad_relay_devices SET revoked_at=now(),status='revoked',updated_at=now() WHERE id=$1 AND org_id=$2 AND (user_id=$3 OR has_org_role($2,ARRAY['owner','admin']::org_role[]))`,
          [body.deviceId, orgId, session.user.id],
        );
        return { success: true };
      }
      throw new Error("Invalid CAD action");
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
