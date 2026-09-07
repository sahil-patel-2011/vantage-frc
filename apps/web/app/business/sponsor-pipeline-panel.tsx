"use client";

import type { FormEvent, ReactNode } from "react";
import { BusinessRelated } from "../../components/business-related";
import { EmptyState } from "../../components/ui";
import { SPONSOR_CRM_RELATED_INCLUDE } from "../../lib/business/business-related";
import { sponsorCrmNextActions } from "../../lib/business/sponsor-crm-next-actions";
import {
  SPONSOR_PIPELINE_STAGES,
  sponsorHealth,
  type BusinessView,
  type Sponsor,
  type SponsorPipelineStage,
  type SponsorReminder,
} from "../../lib/business-portal";
import {
  groupSponsorsByStage,
  nextPipelineStage,
  pipelineStageLabel,
} from "../../lib/sponsor-pipeline";

type Mutate = (body: Record<string, unknown>) => Promise<void>;
type Submit = (event: FormEvent<HTMLFormElement>, action: string, moneyFields?: string[]) => Promise<void>;

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}

function ToneBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "good" | "warn" | "danger" | "neutral" | "blue" }) {
  return <span className={`biz-badge ${tone}`}>{children}</span>;
}

function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`biz-field${wide ? " wide" : ""}`}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function reminderTone(kind: SponsorReminder["kind"]): "danger" | "warn" | "blue" {
  if (kind === "thank_you") return "warn";
  if (kind === "renewal") return "blue";
  return "danger";
}

function reminderLabel(kind: SponsorReminder["kind"]): string {
  if (kind === "thank_you") return "Thank-you";
  if (kind === "renewal") return "Renewal";
  return "Follow-up";
}

function NextActions({ view }: { view: BusinessView }) {
  const actions = sponsorCrmNextActions({
    orgId: view.orgId,
    surface: "sponsors",
    canManage: view.canManageFinance,
    sponsorCount: view.sponsors.filter((s) => s.status !== "declined").length,
    reminderCount: view.sponsorReminders.length,
    fundraisingGoalCents: view.fundraisingProgress.goalCents,
  });
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions biz-next-actions" aria-label="Next actions">
      <header>
        <span className="biz-overline">Next actions</span>
        <h2>Keep the pipeline moving with real team data</h2>
        <p>Only contacts, amounts, and dates you already recorded — never fabricated pipeline revenue.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={`Open ${action.label}`}>Open</a>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function SponsorPipelinePanel({
  view,
  busy,
  submit,
  mutate,
  research,
}: {
  view: BusinessView;
  busy: boolean;
  submit: Submit;
  mutate: Mutate;
  research: () => Promise<void>;
}) {
  const byStage = groupSponsorsByStage(view.sponsors);
  const progress = view.fundraisingProgress;
  const reminders = view.sponsorReminders;
  const activeSponsors = view.sponsors.filter((s) => s.status !== "declined");

  return (
    <div className="biz-stack">
      <BusinessRelated
        orgId={view.orgId}
        active="sponsors"
        include={SPONSOR_CRM_RELATED_INCLUDE}
        ariaLabel="Related fundraising tools"
      />

      <NextActions view={view} />

      <section className="app-card soft-panel biz-pipeline-goal">
        <header className="biz-card-head">
          <div>
            <span className="biz-overline">Season fundraising</span>
            <h2>Goal vs actual — this team only</h2>
          </div>
          <ToneBadge tone={progress.percentOfGoal >= 100 ? "good" : progress.percentOfGoal >= 50 ? "blue" : "warn"}>
            {progress.percentOfGoal}% of goal
          </ToneBadge>
        </header>
        <div className="biz-pipeline-goal-stats">
          <b>
            {money(progress.goalCents)}
            <small>season goal</small>
          </b>
          <b>
            {money(progress.actualCents)}
            <small>
              actual in ({money(progress.actualCashCents)} sponsors · {money(progress.grantIncomeCents)} grants)
            </small>
          </b>
          <b>
            {money(progress.pledgedPipelineCents)}
            <small>pledged in pipeline</small>
          </b>
          <b>
            {money(progress.remainingCents)}
            <small>remaining to goal</small>
          </b>
        </div>
        <div className="biz-meter" aria-label="Fundraising progress">
          <span style={{ width: `${percent(progress.actualCents, progress.goalCents || 1)}%` }} />
        </div>
        <p className="app-muted">Pipeline stages stay inside your org workspace. Other teams&apos; sponsors never appear here.</p>
      </section>

      {!activeSponsors.length ? (
        <EmptyState
          soft
          badge={view.canManageFinance ? "Get started" : "Setup"}
          badgeTone={view.canManageFinance ? "" : "setup"}
          title={view.canManageFinance ? "No sponsors in the CRM yet" : "Sponsor CRM is empty"}
          description={
            view.canManageFinance
              ? "Add a partner below, run source-linked research, or open Fundraisers and Grants. Pipeline totals only reflect recorded contributions."
              : "A finance lead adds CRM rows. You can still open related fundraising tools while the board is empty."
          }
        >
          <BusinessRelated
            orgId={view.orgId}
            include={["fundraisers", "grants", "placements", "finance-ai"]}
            ariaLabel="Empty CRM next links"
          />
        </EmptyState>
      ) : null}

      {reminders.length ? (
        <section className="app-card biz-reminder-panel">
          <header className="biz-card-head">
            <div>
              <span className="biz-overline">CRM nudges</span>
              <h2>Thank-yous, renewals, and overdue follow-ups</h2>
            </div>
            <span className="biz-count">{reminders.length}</span>
          </header>
          <ul className="biz-reminder-list">
            {reminders.slice(0, 8).map((reminder) => (
              <li key={`${reminder.kind}-${reminder.sponsorId}-${reminder.dueOn}`}>
                <ToneBadge tone={reminderTone(reminder.kind)}>{reminderLabel(reminder.kind)}</ToneBadge>
                <div>
                  <strong>{reminder.sponsorName}</strong>
                  <span>
                    {reminder.message} · due {reminder.dueOn}
                  </span>
                </div>
                {reminder.kind === "thank_you" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void mutate({ action: "mark-thank-you-sent", sponsorId: reminder.sponsorId })}
                  >
                    Mark sent
                  </button>
                ) : reminder.kind === "renewal" ? (
                  <button
                    type="button"
                    disabled={busy || !view.canManageFinance}
                    onClick={() =>
                      void mutate({
                        action: "set-pipeline-stage",
                        sponsorId: reminder.sponsorId,
                        pipelineStage: "renewal",
                      })
                    }
                  >
                    Open renewal
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => document.getElementById("biz-log-touch")?.scrollIntoView({ behavior: "smooth" })}
                  >
                    Log touch
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="app-card">
        <header className="biz-card-head">
          <div>
            <span className="biz-overline">Sponsor pipeline CRM</span>
            <h2>Prospect → ask → visit → pledged → active → renewal</h2>
          </div>
          <span className="biz-count">{activeSponsors.length}</span>
        </header>
        <div className="biz-sponsor-board">
          {SPONSOR_PIPELINE_STAGES.map((stage) => (
            <div key={stage}>
              <header>
                <span>{pipelineStageLabel(stage)}</span>
                <span>{byStage[stage].length}</span>
              </header>
              {byStage[stage].map((sponsor) => (
                <PipelineCard key={sponsor.id} sponsor={sponsor} stage={stage} view={view} busy={busy} mutate={mutate} />
              ))}
              {!byStage[stage].length ? <p className="biz-empty-inline">No partners in this stage</p> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="biz-grid two">
        <article className="app-card">
          <header className="biz-card-head">
            <div>
              <span className="biz-overline">Add partner</span>
              <h2>Start them in the right stage.</h2>
            </div>
            {view.canManageFinance ? <ToneBadge tone="blue">Lead controls</ToneBadge> : <ToneBadge>Team view</ToneBadge>}
          </header>
          <form className="biz-form-grid" onSubmit={(event) => void submit(event, "add-sponsor", ["ask", "pledged"])}>
            <Field label="Organization">
              <input name="name" required placeholder="Acme Manufacturing" disabled={!view.canManageFinance} />
            </Field>
            <Field label="Pipeline stage">
              <select name="pipelineStage" defaultValue="prospect" disabled={!view.canManageFinance}>
                {SPONSOR_PIPELINE_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {pipelineStageLabel(stage)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ask amount ($)">
              <input name="askDollars" type="number" min="0" step="0.01" placeholder="2500" disabled={!view.canManageFinance} />
            </Field>
            <Field label="Pledged amount ($)">
              <input name="pledgedDollars" type="number" min="0" step="0.01" placeholder="0" disabled={!view.canManageFinance} />
            </Field>
            <Field label="Website">
              <input name="website" type="url" placeholder="https://…" disabled={!view.canManageFinance} />
            </Field>
            <Field label="Industry">
              <input name="industry" placeholder="Manufacturing" disabled={!view.canManageFinance} />
            </Field>
            <Field label="Contact">
              <input name="contactName" placeholder="Name" disabled={!view.canManageFinance} />
            </Field>
            <Field label="Contact email">
              <input name="contactEmail" type="email" placeholder="name@company.com" disabled={!view.canManageFinance} />
            </Field>
            <Field label="Relationship owner">
              <input name="relationshipOwner" placeholder="Student / mentor owner" disabled={!view.canManageFinance} />
            </Field>
            <Field label="Next follow-up">
              <input name="nextFollowUpOn" type="date" disabled={!view.canManageFinance} />
            </Field>
            <Field label="Relationship notes" wide>
              <textarea
                name="notes"
                rows={3}
                placeholder="Why they care, history, recognition preferences…"
                disabled={!view.canManageFinance}
              />
            </Field>
            <button className="app-button" disabled={busy || !view.canManageFinance}>
              Add to pipeline
            </button>
          </form>
        </article>
        <article className="app-card biz-research-card">
          <span className="biz-overline">Source-linked discovery</span>
          <h2>Find the next best sponsor from the team&apos;s real relationship pattern.</h2>
          <p>
            The research agent uses the team number, prior sponsor industries, and robotics/STEM fit. It stores the source and
            reasoning—never auto-contacts anyone.
          </p>
          <button className="app-button" type="button" disabled={busy} onClick={() => void research()}>
            {busy ? "Researching…" : "Research sponsor prospects"}
          </button>
          <div className="biz-prospect-list">
            {view.prospects.map((prospect) => (
              <article key={prospect.id}>
                <header>
                  <strong>{prospect.name}</strong>
                  <ToneBadge tone={prospect.fitScore >= 75 ? "good" : "blue"}>{prospect.fitScore}% fit</ToneBadge>
                </header>
                <p>{prospect.summary}</p>
                <small>{prospect.fitReason}</small>
                <footer>
                  <a href={prospect.website} target="_blank" rel="noreferrer">
                    Verify source ↗
                  </a>
                  {view.canManageFinance ? (
                    <button disabled={busy} onClick={() => void mutate({ action: "save-prospect", prospectId: prospect.id })}>
                      Add to CRM
                    </button>
                  ) : null}
                  <button disabled={busy} onClick={() => void mutate({ action: "dismiss-prospect", prospectId: prospect.id })}>
                    Dismiss
                  </button>
                </footer>
              </article>
            ))}
            {!view.prospects.length ? (
              <p className="biz-empty-inline">Run research to build a review queue of source-linked candidates.</p>
            ) : null}
          </div>
        </article>
      </section>

      {view.sponsors.length ? (
        <section className="biz-grid two" id="biz-log-touch">
          <article className="app-card">
            <span className="biz-overline">Log a touchpoint</span>
            <h2>Capture what happened and what happens next.</h2>
            <form className="biz-form-grid" onSubmit={(event) => void submit(event, "log-interaction")}>
              <Field label="Sponsor">
                <select name="sponsorId" required>
                  {view.sponsors.map((sponsor) => (
                    <option key={sponsor.id} value={sponsor.id}>
                      {sponsor.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Type">
                <select name="interactionType" defaultValue="email">
                  <option value="email">Email</option>
                  <option value="call">Call</option>
                  <option value="meeting">Meeting</option>
                  <option value="visit">Visit</option>
                  <option value="thank_you">Thank-you</option>
                  <option value="note">Note</option>
                </select>
              </Field>
              <Field label="Date">
                <input name="occurredOn" type="date" defaultValue={today()} required />
              </Field>
              <Field label="Next follow-up">
                <input name="nextFollowUpOn" type="date" />
              </Field>
              <Field label="What happened" wide>
                <textarea name="summary" rows={3} required placeholder="Who attended, what mattered, what they asked for…" />
              </Field>
              <Field label="Next step" wide>
                <input name="nextStep" placeholder="Send impact update and invite to shop tour" />
              </Field>
              <button className="app-button" disabled={busy}>
                Log interaction
              </button>
            </form>
          </article>
          <article className="app-card">
            <span className="biz-overline">Contribution ledger</span>
            <h2>Add cash and in-kind support to the season.</h2>
            <form className="biz-form-grid" onSubmit={(event) => void submit(event, "add-contribution", ["amount"])}>
              <Field label="Sponsor">
                <select name="sponsorId" required disabled={!view.canManageFinance}>
                  {view.sponsors.map((sponsor) => (
                    <option key={sponsor.id} value={sponsor.id}>
                      {sponsor.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Type">
                <select name="contributionType" disabled={!view.canManageFinance}>
                  <option value="cash">Cash</option>
                  <option value="in_kind">In-kind value</option>
                </select>
              </Field>
              <Field label="Value">
                <input name="amountDollars" type="number" min="0" step="0.01" required disabled={!view.canManageFinance} />
              </Field>
              <Field label="Received">
                <input name="receivedOn" type="date" defaultValue={today()} required disabled={!view.canManageFinance} />
              </Field>
              <Field label="Description" wide>
                <input name="description" placeholder="Check, machining time, materials…" disabled={!view.canManageFinance} />
              </Field>
              <button className="app-button" disabled={busy || !view.canManageFinance}>
                Record contribution
              </button>
            </form>
          </article>
        </section>
      ) : null}

      <div className="biz-detail-link">
        <span>Need packages, walls, or recognition surfaces?</span>
        <a href={`/business?tab=placements&orgId=${encodeURIComponent(view.orgId)}`}>Partner packages →</a>
        <a href={`/sponsor-suite?orgId=${encodeURIComponent(view.orgId)}`}>Sponsor Suite →</a>
        <a href={`/media-kit?orgId=${encodeURIComponent(view.orgId)}`}>Media kit →</a>
        <a href={`/business?tab=sponsorship&orgId=${encodeURIComponent(view.orgId)}`}>Sponsorship one-pager →</a>
      </div>
    </div>
  );
}

function PipelineCard({
  sponsor,
  stage,
  view,
  busy,
  mutate,
}: {
  sponsor: Sponsor;
  stage: SponsorPipelineStage;
  view: BusinessView;
  busy: boolean;
  mutate: Mutate;
}) {
  const health = sponsorHealth(sponsor);
  const next = nextPipelineStage(stage);
  return (
    <article>
      <header>
        <div>
          <strong>{sponsor.name}</strong>
          <span>{sponsor.industry ?? sponsor.tier ?? "Community partner"}</span>
        </div>
        <ToneBadge tone={health === "healthy" ? "good" : health === "due" ? "danger" : "warn"}>{health}</ToneBadge>
      </header>
      <div className="biz-sponsor-money">
        <b>
          {money(sponsor.seasonCents)}
          <small>this season</small>
        </b>
        <b>
          {money(sponsor.pledgedCents || sponsor.askCents)}
          <small>{sponsor.pledgedCents ? "pledged" : "ask"}</small>
        </b>
      </div>
      <dl>
        <div>
          <dt>Owner</dt>
          <dd>{sponsor.relationshipOwner ?? "Assign one"}</dd>
        </div>
        <div>
          <dt>Next</dt>
          <dd>{sponsor.nextFollowUpOn ?? "—"}</dd>
        </div>
      </dl>
      {view.canManageFinance ? (
        <footer className="biz-pipeline-actions">
          <select
            aria-label={`Move ${sponsor.name}`}
            value={stage}
            disabled={busy}
            onChange={(event) =>
              void mutate({
                action: "set-pipeline-stage",
                sponsorId: sponsor.id,
                pipelineStage: event.target.value,
              })
            }
          >
            {SPONSOR_PIPELINE_STAGES.map((option) => (
              <option key={option} value={option}>
                {pipelineStageLabel(option)}
              </option>
            ))}
          </select>
          {next ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void mutate({ action: "set-pipeline-stage", sponsorId: sponsor.id, pipelineStage: next })}
            >
              → {pipelineStageLabel(next)}
            </button>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}
