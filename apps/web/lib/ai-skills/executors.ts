/**
 * Ask AI skill executors (server only).
 *
 * Each one calls the feature's existing lib module — the same view loader its page uses — on the
 * request's `withRls` client, and turns the result into a {@link SkillToolOutput}: a one-line
 * summary, plain highlight lines computed without a model, and bounded facts. Executors only
 * read. They never call a model themselves: the chat turn that runs them is the one metered call
 * (`meteredAI`, `feature` = the skill id).
 */
import type { PoolClient } from "@neondatabase/serverless";
import { createVantageToolRegistry, type SkillToolOutput } from "@vantage/agent";
import { withSavepoint } from "@vantage/db";
import { loadInsight } from "../ai-insights-load";
import type { InsightKind } from "../ai-insights";
import { currentBusinessSeason, loadBusinessView } from "../business-data";
import { computeDecisionSearchView } from "../decision-search/compute-decision-search";
import { computeDefensePlannerView } from "../defense-planner/compute-defense-planner";
import { listRecentReviews } from "../github/pr-review-run";
import { computeGrantReportView } from "../grant-report/compute-grant-report";
import { computeImpactEssayView } from "../impact-essay/compute-impact-essay";
import { computeInspectionCopilotView } from "../inspection-copilot/compute-inspection-copilot";
import { computeJudgeSimView } from "../judge-sim/compute-judge-sim";
import { computeKnowledgeGapView } from "../knowledge-gap/compute-knowledge-gap";
import { computeMatchCopilotView } from "../match-copilot/compute-match-copilot";
import { debriefTakeaways, type DebriefForCoach } from "../match-debrief";
import { computeMatchingGiftFinderView } from "../matching-gift-finder/compute-matching-gift-finder";
import { computeMediaKitView } from "../media-kit/compute-media-kit";
import { computeMeetingAutopilotView } from "../meeting-autopilot/compute-meeting-autopilot";
import { computeMockJudgingView } from "../mock-judging/compute-mock-judging";
import { withOrgHref } from "../nav/product-nav";
import { computeOnboardingBuddyView } from "../onboarding-buddy/compute-onboarding-buddy";
import { computeOvernightIntelView } from "../overnight-intel/compute-overnight-intel";
import { buildOrgDigest } from "../parent-comms/send-digest";
import { computePicklistJustifierView } from "../picklist-justifier/compute-picklist-justifier";
import { computePitRepairTriageView } from "../pit-repair-triage/compute-pit-repair-triage";
import { computeRetroView } from "../retro/compute-retro";
import { computeRuleImpactView } from "../rule-impact/compute-rule-impact";
import { computeSeasonReportView } from "../season-report/compute-season-report";
import { computeSpareForecastView } from "../spare-forecast/compute-spare-forecast";
import { computeSpareRobotKitView } from "../spare-robot-kit/compute-spare-robot-kit";
import { computeSponsorRenewalRoiView } from "../sponsor-renewal-roi/compute-sponsor-renewal-roi";
import { computeStandupDigestView } from "../standup-digest/compute-standup-digest";
import { computeTroubleshootView } from "../troubleshoot/compute-troubleshoot";
import { computeWiringDiagnoserView } from "../wiring-diagnoser/compute-wiring-diagnoser";
import { computeWriterView } from "../writer/compute-writer";
import { boundForModel, dollarsOrNull, viewHighlights, viewIsEmpty } from "./bound";
import { aiSkillById, type AiSkill } from "./catalog";
import {
  rankSponsorAsks,
  renewalsComingUp,
  shortDate,
  sponsorNamedIn,
  sponsorshipHighlights,
  type MatchingGiftLine,
} from "./sponsorships";

/** What the page Ask AI was opened from told the skill. Comes from the URL: data, never instructions. */
export type SkillPageContext = {
  from?: string | null;
  about?: string | null;
  sponsorId?: string | null;
  teamKey?: string | null;
  matchKey?: string | null;
};

export type SkillRunContext = {
  client: PoolClient;
  orgId: string;
  userId: string;
  activeEventKey: string | null;
  /** The person's question for this turn. */
  request: string;
  page: SkillPageContext;
  now: Date;
};

type Executor = (ctx: SkillRunContext, skill: AiSkill) => Promise<SkillToolOutput>;

type Next = { label: string; href: string } | null;

function homeNext(skill: AiSkill, orgId: string): Next {
  return { label: skill.home.label, href: withOrgHref(skill.home.path, orgId) };
}

function output(
  skill: AiSkill,
  ctx: SkillRunContext,
  part: Partial<Omit<SkillToolOutput, "kind" | "skill">> & Pick<SkillToolOutput, "status" | "summary">,
): SkillToolOutput {
  return {
    kind: "vantage_skill",
    skill: skill.id,
    classification: part.classification ?? "hard_metric",
    highlights: (part.highlights ?? []).map((line) => line.slice(0, 280)).slice(0, 8),
    data: part.data ?? null,
    next: part.next === undefined ? homeNext(skill, ctx.orgId) : part.next,
    status: part.status,
    summary: part.summary,
  };
}

function setupRequired(skill: AiSkill, ctx: SkillRunContext, message: string, next?: Next): SkillToolOutput {
  return output(skill, ctx, { status: "setup_required", summary: message, next });
}

type AnyView = { status: string; message?: string } & Record<string, unknown>;

/**
 * The common case: one feature view. Live with records → ok; live with every list empty →
 * empty with a pointer to where records get added; anything else → setup_required in the view's
 * own words.
 */
async function fromViews(
  skill: AiSkill,
  ctx: SkillRunContext,
  load: () => Promise<AnyView[]>,
  opts: { emptySummary: string; okSummary?: (views: AnyView[]) => string; highlights?: (views: AnyView[]) => string[] } ,
): Promise<SkillToolOutput> {
  const views = await load();
  const live = views.filter((view) => view.status === "live");
  if (!live.length) {
    const message = views.find((view) => typeof view.message === "string")?.message;
    return setupRequired(skill, ctx, message ?? `${skill.name} isn't set up for your team yet.`);
  }
  if (live.every((view) => viewIsEmpty(view))) {
    return output(skill, ctx, { status: "empty", summary: opts.emptySummary, data: live.map((view) => boundForModel(view)) });
  }
  const highlights = opts.highlights ? opts.highlights(live) : live.flatMap((view) => viewHighlights(view, 4));
  return output(skill, ctx, {
    status: "ok",
    summary: opts.okSummary ? opts.okSummary(live) : `${skill.name}: ${highlights[0] ?? "records found"}`,
    highlights,
    data: live.map((view) => boundForModel(view)),
  });
}

/** One feature view, from its usual `computeXView(client, { userId, requestedOrg })`. */
function viewSkill(
  loaders: Array<(client: PoolClient, input: { userId: string; requestedOrg: string | null }) => Promise<unknown>>,
  emptySummary: string,
): Executor {
  return (ctx, skill) =>
    fromViews(
      skill,
      ctx,
      () =>
        Promise.all(
          loaders.map((loader) =>
            withSavepoint(
              ctx.client,
              async () => (await loader(ctx.client, { userId: ctx.userId, requestedOrg: ctx.orgId })) as AnyView,
              { status: "setup_required", message: `${skill.name} couldn't read your team's records just now.` } as AnyView,
            ),
          ),
        ),
      { emptySummary },
    );
}

/** The robot label a team uses most recently (inspection and blueprint are per robot). */
async function latestRobotLabel(client: PoolClient, orgId: string, table: "inspection_items" | "robot_subsystems"): Promise<string | null> {
  const sql =
    table === "inspection_items"
      ? `SELECT robot_label AS "robotLabel" FROM inspection_items WHERE org_id = $1::uuid GROUP BY robot_label ORDER BY count(*) DESC LIMIT 1`
      : `SELECT robot_label AS "robotLabel" FROM robot_subsystems WHERE org_id = $1::uuid GROUP BY robot_label ORDER BY count(*) DESC LIMIT 1`;
  return withSavepoint(
    client,
    async () => (await client.query<{ robotLabel: string }>(sql, [orgId])).rows[0]?.robotLabel ?? null,
    null,
  );
}

/** A skill built on one of the computed insights the old "Analyze" panels showed. */
function insightSkill(kind: InsightKind, emptySummary: string, robotTable?: "inspection_items" | "robot_subsystems"): Executor {
  return async (ctx, skill) => {
    const robotLabel = robotTable ? await latestRobotLabel(ctx.client, ctx.orgId, robotTable) : "";
    if (robotTable && !robotLabel) return output(skill, ctx, { status: "empty", summary: emptySummary });
    const built = await withSavepoint(
      ctx.client,
      () => loadInsight(ctx.client, { orgId: ctx.orgId, kind, robotLabel: robotLabel ?? "", mode: "computed" }),
      null,
    );
    if (!built) return setupRequired(skill, ctx, `${skill.name} couldn't read your team's records just now.`);
    const lines = built.localText
      .split(/\n+/)
      .map((line) => line.replace(/^[-*•\s]+/, "").trim())
      .filter(Boolean);
    const noData = !built.sources.length || /\bno (?:data|records?|rows?)\b|nothing (?:logged|recorded)/i.test(lines[0] ?? "");
    return output(skill, ctx, {
      status: noData ? "empty" : "ok",
      summary: noData ? emptySummary : (lines[0] ?? `${skill.name} from your records`),
      highlights: noData ? [] : lines.slice(0, 8),
      data: { robotLabel: robotLabel || null, sources: built.sources.map((source) => ({ id: source.id, classification: source.classification, content: source.content.slice(0, 1500) })) },
    });
  };
}

// ─── Sponsorships: the owner's headache, done properly ─────────────────────────

const sponsorships: Executor = async (ctx, skill) => {
  const seasonYear = currentBusinessSeason(ctx.now);
  const view = await loadBusinessView(ctx.client, { userId: ctx.userId, requestedOrg: ctx.orgId, seasonYear });
  if (view.status !== "live") return setupRequired(skill, ctx, view.message);
  if (view.sponsorsAllowed === false) {
    return setupRequired(
      skill,
      ctx,
      "Sponsor tools are turned off for your team. An owner can turn them on in Team profile.",
      { label: "Open Team profile", href: withOrgHref("/team?tab=profile", ctx.orgId) },
    );
  }

  const [roi, gifts] = await Promise.all([
    withSavepoint(ctx.client, () => computeSponsorRenewalRoiView(ctx.client, { userId: ctx.userId, requestedOrg: ctx.orgId, seasonYear }), null),
    withSavepoint(ctx.client, () => computeMatchingGiftFinderView(ctx.client, { userId: ctx.userId, requestedOrg: ctx.orgId, seasonYear }), null),
  ]);
  const renewalRisk = new Map<string, "low" | "moderate" | "high">();
  if (roi?.status === "live") for (const row of roi.sponsors) renewalRisk.set(row.sponsorId, row.risk.tier);
  const matches: MatchingGiftLine[] =
    gifts?.status === "live"
      ? gifts.matches.filter((match) => !match.hasPledge).map((match) => ({ contactName: match.contactName, employer: match.program.employerName }))
      : [];

  const askNext = rankSponsorAsks({ sponsors: view.sponsors, reminders: view.sponsorReminders, prospects: view.prospects, renewalRisk, now: ctx.now });
  const comingUp = renewalsComingUp(view.sponsors, ctx.now);
  const named =
    (ctx.page.sponsorId ? view.sponsors.find((sponsor) => sponsor.id === ctx.page.sponsorId) : null) ??
    sponsorNamedIn(`${ctx.request} ${ctx.page.about ?? ""}`, view.sponsors);
  const goal = view.fundraisingProgress.goalCents > 0 ? { goalCents: view.fundraisingProgress.goalCents, actualCents: view.fundraisingProgress.actualCents } : null;

  const data = {
    team: { name: view.orgName, number: view.teamNumber, seasonYear },
    askNext,
    remindersDue: view.sponsorReminders.slice(0, 10).map((reminder) => ({ ...reminder, dueLabel: shortDate(reminder.dueOn) })),
    renewalsComingUp: comingUp,
    focusSponsor: named
      ? {
          id: named.id,
          name: named.name,
          stage: named.pipelineStage,
          status: named.status,
          tier: named.tier,
          industry: named.industry,
          contactName: named.contactName,
          relationshipOwner: named.relationshipOwner,
          lastContactOn: named.lastContactOn,
          nextFollowUpOn: named.nextFollowUpOn,
          renewalDueOn: named.renewalDueOn,
          thankYouDueOn: named.thankYouDueOn,
          recordedAsk: dollarsOrNull(named.askCents),
          recordedPledge: dollarsOrNull(named.pledgedCents),
          givenThisSeason: dollarsOrNull(named.seasonCents),
          givenLifetime: dollarsOrNull(named.lifetimeCents),
          notes: named.notes?.slice(0, 600) ?? null,
          recentContact: view.interactions
            .filter((interaction) => interaction.sponsorId === named.id)
            .slice(0, 5)
            .map((interaction) => ({ type: interaction.interactionType, on: interaction.occurredOn, summary: interaction.summary.slice(0, 300), nextStep: interaction.nextStep })),
          renewalRisk: renewalRisk.get(named.id) ?? null,
        }
      : null,
    sponsorCount: view.sponsors.filter((sponsor) => sponsor.status !== "declined").length,
    matchingGifts: matches.slice(0, 10),
    matchingGiftSummary: gifts?.status === "live" ? { contacts: gifts.summary.totalContacts, programs: gifts.summary.totalPrograms, unpledgedMatches: gifts.summary.unmatchedMatchCount } : null,
    seasonGoal: goal ? { goal: dollarsOrNull(goal.goalCents), raised: dollarsOrNull(goal.actualCents) } : null,
    awardsOnRecord: view.awards.slice(0, 6).map((award) => ({ award: award.awardName, season: award.seasonYear, event: award.eventName })),
    impact: view.impact.activities > 0 ? view.impact : null,
  };

  const highlights = sponsorshipHighlights({ askNext, comingUp, matches, goal });
  if (!data.sponsorCount && !view.prospects.length) {
    return output(skill, ctx, {
      status: "empty",
      summary: "No sponsor records yet. Add your first sponsor (even a prospect) on Business › Sponsors and I can suggest who to ask and draft the email.",
      highlights: matches.length ? highlights : [],
      data,
      next: { label: "Add a sponsor", href: withOrgHref("/business?tab=sponsors", ctx.orgId) },
    });
  }
  const lead = askNext[0];
  return output(skill, ctx, {
    status: "ok",
    summary: lead
      ? `${askNext.length} sponsor${askNext.length === 1 ? "" : "s"} to act on — start with ${lead.name}.`
      : `${data.sponsorCount} sponsor record${data.sponsorCount === 1 ? "" : "s"}; nothing is due right now.`,
    highlights: highlights.length ? highlights : ["Nothing is overdue. Every sponsor is up to date."],
    data,
  });
};

const matchingGifts: Executor = async (ctx, skill) => {
  const view = await computeMatchingGiftFinderView(ctx.client, { userId: ctx.userId, requestedOrg: ctx.orgId, seasonYear: currentBusinessSeason(ctx.now) });
  if (view.status !== "live") return setupRequired(skill, ctx, view.message);
  if (!view.contacts.length) {
    return output(skill, ctx, {
      status: "empty",
      summary: "No family or mentor employers on file yet. Add contacts and their employers in Matching gifts and I can check each one.",
      data: { programs: view.programs.length },
    });
  }
  const open = view.matches.filter((match) => !match.hasPledge);
  const highlights = [
    ...open.slice(0, 5).map((match) => `${match.contactName} works at ${match.program.employerName} — ${match.program.matchRatio} match${match.program.annualDeadline ? `, deadline ${match.program.annualDeadline}` : ""}`),
    ...view.pledges.filter((pledge) => pledge.status === "requested" || pledge.status === "submitted").slice(0, 3).map((pledge) => `${pledge.contactName} (${pledge.employerName}) — ${pledge.status}`),
  ];
  return output(skill, ctx, {
    status: "ok",
    summary: open.length
      ? `${open.length} contact${open.length === 1 ? "" : "s"} work${open.length === 1 ? "s" : ""} somewhere with a matching-gift program you haven't asked about yet.`
      : "Every employer match on file already has a pledge started.",
    highlights,
    data: boundForModel({ matches: view.matches, pledges: view.pledges, summary: view.summary }),
  });
};

const sponsorRoi: Executor = async (ctx, skill) => {
  const view = await computeSponsorRenewalRoiView(ctx.client, { userId: ctx.userId, requestedOrg: ctx.orgId, seasonYear: currentBusinessSeason(ctx.now) });
  if (view.status !== "live") return setupRequired(skill, ctx, view.message);
  if (!view.sponsors.length) {
    return output(skill, ctx, { status: "empty", summary: "No sponsors to score yet. Add sponsors on Business › Sponsors first.", next: { label: "Add a sponsor", href: withOrgHref("/business?tab=sponsors", ctx.orgId) } });
  }
  const ranked = [...view.sponsors].sort((a, b) => b.risk.score - a.risk.score);
  return output(skill, ctx, {
    status: "ok",
    summary: `${ranked.filter((row) => row.risk.tier === "high").length} sponsor(s) at high renewal risk.`,
    highlights: ranked.slice(0, 6).map((row) => `${row.sponsorName}: ${row.risk.tier} risk (${row.risk.score}/100)${row.risk.noLinkedActivity ? " — no activity logged" : ""}${row.latestReport ? " · ROI report saved" : ""}`),
    data: boundForModel({ sponsors: ranked.map((row) => ({ name: row.sponsorName, tier: row.tier, status: row.status, risk: row.risk, latestReport: row.latestReport ? { title: row.latestReport.title, sections: row.latestReport.sections } : null })) }),
  });
};

const grants: Executor = async (ctx, skill) => {
  const seasonYear = currentBusinessSeason(ctx.now);
  const view = await loadBusinessView(ctx.client, { userId: ctx.userId, requestedOrg: ctx.orgId, seasonYear });
  if (view.status !== "live") return setupRequired(skill, ctx, view.message);
  if (!view.grants.length) {
    return output(skill, ctx, {
      status: "empty",
      summary: "No grant applications on record this season. Add one on Business › Grants and I can track its deadline and help answer its questions.",
      data: { awards: view.awards.length, impact: view.impact },
    });
  }
  const open = view.grants.filter((grant) => grant.status !== "awarded" && grant.status !== "declined");
  const dated = [...open].sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  return output(skill, ctx, {
    status: "ok",
    summary: `${open.length} open grant application${open.length === 1 ? "" : "s"}${dated[0]?.deadline ? `; next deadline ${shortDate(dated[0].deadline)} (${dated[0].funder})` : ""}.`,
    highlights: dated.slice(0, 6).map((grant) => `${grant.funder} — ${grant.title}: ${grant.status}${grant.deadline ? `, due ${shortDate(grant.deadline)}` : ", no deadline recorded"}`),
    data: boundForModel({
      grants: view.grants.map((grant) => ({ funder: grant.funder, title: grant.title, status: grant.status, deadline: grant.deadline, requested: dollarsOrNull(grant.requestedCents), awarded: dollarsOrNull(grant.awardedCents), purpose: grant.purpose, requirements: grant.requirements, eligibility: grant.eligibility })),
      awards: view.awards,
      impact: view.impact,
    }),
  });
};

const writing: Executor = async (ctx, skill) => {
  const view = await computeWriterView(ctx.client, { userId: ctx.userId, requestedOrg: ctx.orgId, seasonYear: currentBusinessSeason(ctx.now) });
  if (view.status !== "live") return setupRequired(skill, ctx, view.message);
  const profile = view.profile;
  const missing = [
    !profile.mission ? "mission" : null,
    !profile.achievements.length ? "achievements" : null,
    !profile.fundingNeed ? "what the money pays for" : null,
  ].filter(Boolean) as string[];
  return output(skill, ctx, {
    status: "ok",
    summary: missing.length
      ? `Team profile is missing ${missing.join(", ")} — drafts will leave [brackets] there. Fill it in under Writer.`
      : `Writing from ${profile.teamName}'s team profile.`,
    highlights: [
      profile.mission ? `Mission: ${profile.mission}` : "No mission on the team profile yet",
      ...profile.achievements.slice(0, 3).map((line) => `Achievement: ${line}`),
      profile.fundingAskUsd ? `Usual ask: $${profile.fundingAskUsd.toLocaleString("en-US")}` : "",
      view.drafts.length ? `${view.drafts.length} saved draft${view.drafts.length === 1 ? "" : "s"}` : "",
    ].filter(Boolean),
    data: boundForModel({ profile, savedDrafts: view.drafts.map((draft) => ({ title: draft.title, kind: draft.kind, status: draft.status, targetName: draft.targetName })) }),
  });
};

const parentUpdates: Executor = async (ctx, skill) => {
  const org = (
    await ctx.client.query<{ name: string; teamNumber: number | null }>(
      `SELECT name, team_number AS "teamNumber" FROM organizations WHERE id = $1::uuid`,
      [ctx.orgId],
    )
  ).rows[0];
  const built = await withSavepoint(
    ctx.client,
    () => buildOrgDigest(ctx.client, { orgId: ctx.orgId, orgName: org?.name ?? "Your team", teamNumber: org?.teamNumber ?? null, now: ctx.now }),
    null,
  );
  if (!built) {
    return output(skill, ctx, {
      status: "empty",
      summary: "Nothing is on the whole-team calendar for the next 7 days, so there's no update to send yet.",
      next: { label: "Open Calendar", href: withOrgHref("/team?tab=calendar", ctx.orgId) },
    });
  }
  return output(skill, ctx, {
    status: "ok",
    summary: built.digest.subject,
    highlights: built.digest.text.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 8),
    data: { subject: built.digest.subject, text: built.digest.text.slice(0, 3000), period: built.period },
  });
};

const codeReview: Executor = async (ctx, skill) => {
  const rows = await withSavepoint(ctx.client, () => listRecentReviews(ctx.client, ctx.orgId, 8), null);
  if (rows === null) return setupRequired(skill, ctx, "Code reviews need GitHub connected. Connect it under Build › Code.");
  if (!rows.length) {
    return output(skill, ctx, { status: "empty", summary: "No pull request reviews yet. Connect GitHub on Build › Code and review a pull request there." });
  }
  return output(skill, ctx, {
    status: "ok",
    summary: `${rows.length} recent pull request review${rows.length === 1 ? "" : "s"}.`,
    highlights: rows.slice(0, 6).map((row) => `#${row.prNumber} ${row.title} — ${row.status}${row.risk ? `, ${row.risk} risk` : ""}${row.findings.length ? `, ${row.findings.length} finding${row.findings.length === 1 ? "" : "s"}` : ""}`),
    data: boundForModel({ reviews: rows.map((row) => ({ repo: row.repoFullName, pr: row.prNumber, title: row.title, status: row.status, risk: row.risk, summary: row.summary, findings: row.findings, reviewedAt: row.reviewedAt, url: row.htmlUrl })) }),
  });
};

/** CAD: pointers, plus the briefs and vault the shared registry tools already read. */
const cad: Executor = async (ctx, skill) => {
  const registry = createVantageToolRegistry({ requestText: ctx.request });
  const tool = { client: ctx.client, orgId: ctx.orgId, userId: ctx.userId, activeEventKey: ctx.activeEventKey };
  const [briefs, vault] = await Promise.all([
    withSavepoint(ctx.client, async () => (await registry.invoke("cad.briefs", tool, { limit: 6 })) as unknown[], []),
    withSavepoint(ctx.client, async () => (await registry.invoke("cad.vault", tool, { query: "", limit: 8 })) as unknown[], []),
  ]);
  const pointer = "CAD changes happen in the CAD agent on Build › CAD (Edit in Onshape), never from this chat.";
  return output(skill, ctx, {
    status: briefs.length || vault.length ? "ok" : "empty",
    summary: briefs.length || vault.length ? `${briefs.length} CAD brief(s) and ${vault.length} vault document(s). ${pointer}` : `No CAD briefs or vault documents yet. ${pointer}`,
    highlights: [pointer, ...viewHighlights({ briefs, vaultDocuments: vault } as Record<string, unknown>, 2)],
    data: boundForModel({ briefs, vault }),
  });
};

/** Retros, plus this season's match debriefs (the coach that used to sit on Match debrief). */
const retros: Executor = async (ctx, skill) => {
  const [retro, debriefs] = await Promise.all([
    viewSkill([computeRetroView], "No retros yet. Start one after your next event.")(ctx, skill),
    withSavepoint(
      ctx.client,
      async () =>
        (
          await ctx.client.query<DebriefForCoach>(
            `SELECT d.match_label AS "matchLabel", d.result, d.points_scored AS "pointsScored", d.cycle_count AS "cycleCount",
                    d.drivetrain_ok AS "drivetrainOk", d.mechanisms_ok AS "mechanismsOk", d.auto_ok AS "autoOk",
                    d.what_worked AS "whatWorked", d.what_broke AS "whatBroke", d.action_items AS "actionItems"
             FROM match_debriefs d
             WHERE d.org_id = $1::uuid AND d.season_year = $2::int
             ORDER BY d.created_at DESC LIMIT 40`,
            [ctx.orgId, ctx.now.getUTCFullYear()],
          )
        ).rows,
      [] as DebriefForCoach[],
    ),
  ]);
  if (!debriefs.length) return retro;
  const takeaways = debriefTakeaways(debriefs);
  return output(skill, ctx, {
    status: "ok",
    summary: `${debriefs.length} match debrief${debriefs.length === 1 ? "" : "s"} this season. ${takeaways.split(/(?<=\.)\s/)[0] ?? ""}`.trim(),
    highlights: [...takeaways.split(/\n+|(?<=\.)\s+/).map((line) => line.trim()).filter(Boolean).slice(0, 4), ...retro.highlights].slice(0, 8),
    data: { matchDebriefs: boundForModel(debriefs), takeaways, retros: retro.data },
  });
};

const judgingPractice = viewSkill([computeJudgeSimView, computeMockJudgingView], "No judging practice sessions yet. Run one in Judging practice and I can build on it.");

const EXECUTORS: Record<string, Executor> = {
  sponsorships,
  "matching-gifts": matchingGifts,
  "sponsor-roi": sponsorRoi,
  "media-kit": viewSkill([computeMediaKitView], "No media kit yet. Add your mission, bio and logo in Media kit."),
  "grant-reports": viewSkill([computeGrantReportView], "No awarded grants to report on yet."),
  "impact-essay": viewSkill([computeImpactEssayView], "Nothing logged to write an impact essay from yet. Log outreach, hours or events first."),
  "judging-practice": judgingPractice,
  grants,
  "defense-planner": viewSkill([computeDefensePlannerView], "No defense matchups yet — they need an active event with scouting."),
  "pick-list-reasons": viewSkill([computePicklistJustifierView], "No pick list yet. Start one on the Pick desk."),
  "rule-impact": viewSkill([computeRuleImpactView], "No rule changes assessed yet for this season."),
  "prediction-accuracy": insightSkill("model_accuracy", "No played matches with a stored prediction yet, so there's nothing to grade."),
  "match-prep": viewSkill([computeMatchCopilotView], "No upcoming match found for your team at the active event."),
  wiring: viewSkill([computeWiringDiagnoserView], "No wiring checks logged yet."),
  inspection: async (ctx, skill) => {
    const [copilot, advisor] = await Promise.all([
      viewSkill([computeInspectionCopilotView], "No inspection checklist yet.")(ctx, skill),
      insightSkill("inspection_advisor", "No inspection checklist yet.", "inspection_items")(ctx, skill),
    ]);
    const best = advisor.status === "ok" ? advisor : copilot;
    return { ...best, highlights: [...advisor.highlights, ...copilot.highlights].slice(0, 8), data: { checklist: advisor.data, copilot: copilot.data } };
  },
  "repair-triage": viewSkill([computePitRepairTriageView], "No pit repairs logged. Report what broke in Pit repairs and I can help triage it."),
  troubleshooting: viewSkill([computeTroubleshootView], "No troubleshooting sessions yet."),
  spares: async (ctx, skill) => {
    const [forecast, stock] = await Promise.all([
      viewSkill([computeSpareForecastView, computeSpareRobotKitView], "No spares forecast or kit checklist yet.")(ctx, skill),
      insightSkill("stock_advisor", "No inventory with low-stock levels yet.")(ctx, skill),
    ]);
    const okOne = [forecast, stock].find((part) => part.status === "ok");
    return { ...(okOne ?? forecast), highlights: [...stock.highlights, ...forecast.highlights].slice(0, 8), data: { forecast: forecast.data, stock: stock.data } };
  },
  "robot-review": insightSkill("robot_blueprint", "No robot blueprint yet. Add subsystems on Build › Robot.", "robot_subsystems"),
  "parent-updates": parentUpdates,
  standups: viewSkill([computeStandupDigestView], "No stand-up notes today yet."),
  meetings: viewSkill([computeMeetingAutopilotView], "No open blockers, overdue tasks or open decisions — nothing for an agenda yet."),
  retros,
  "season-report": viewSkill([computeSeasonReportView], "Not enough logged this season for a report yet."),
  "check-ins": insightSkill("engagement_digest", "No hours logged yet, so there's no one to check in with."),
  "schedule-risk": insightSkill("schedule_risk", "No season milestones yet. Add them to the season calendar."),
  "team-knowledge": viewSkill([computeDecisionSearchView, computeKnowledgeGapView, computeOnboardingBuddyView], "No decisions, knowledge-gap scans or onboarding pairings yet."),
  "code-review": codeReview,
  cad,
  "scouting-insight": async (ctx, skill) => {
    const [intel, video] = await Promise.all([
      viewSkill([computeOvernightIntelView], "No overnight intel brief yet.")(ctx, skill),
      insightSkill("video_scout_summary", "No video review notes yet.")(ctx, skill),
    ]);
    const okOne = [intel, video].find((part) => part.status === "ok");
    return {
      ...(okOne ?? intel),
      classification: "scout_observation",
      summary: okOne ? okOne.summary : "No overnight intel or video notes yet. Scouting entries for a team still come through when you name the team.",
      highlights: [...intel.highlights, ...video.highlights].slice(0, 8),
      data: { overnightIntel: intel.data, videoNotes: video.data },
    };
  },
  writing,
};

/** Run one skill. Never throws: a broken read becomes a setup state in plain words. */
export async function runAiSkill(skillId: string, ctx: SkillRunContext): Promise<SkillToolOutput | null> {
  const skill = aiSkillById(skillId);
  const executor = skill ? EXECUTORS[skill.id] : undefined;
  if (!skill || !executor) return null;
  // A savepoint, not a bare try/catch: a failed read would otherwise leave the request's one
  // transaction aborted and empty every later tool in the turn.
  const result = await withSavepoint(
    ctx.client,
    async () => {
      try {
        return await executor(ctx, skill);
      } catch (error) {
        console.warn(`[ai-skills] ${skill.id} could not read records:`, error instanceof Error ? error.message : error);
        throw error;
      }
    },
    null,
  );
  return (
    result ??
    setupRequired(skill, ctx, `${skill.name} couldn't read your team's records just now. Try again, or open ${skill.home.label.replace(/^Open /, "")}.`)
  );
}

/** For the registry test: every catalog skill has an executor. */
export function aiSkillExecutorIds(): string[] {
  return Object.keys(EXECUTORS);
}
