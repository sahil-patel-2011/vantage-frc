"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Panel,
  Shell,
  SoftBlockSkeleton,
  StatTile,
  type ShellState,
} from "../../components/ui";
import { formatHours } from "../../lib/my-kit/compose";
import type { MyKitSection, MyKitSectionId, MyKitTone, MyKitView } from "../../lib/my-kit/types";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./my-kit.css";

/** The surface each section hands off to — named so the button is not "Open My open work". */
const OPEN_LABEL: Record<MyKitSectionId, string> = {
  tasks: "Open Work",
  packing: "Open Packing",
  calendar: "Open Calendar",
  duties: "Open Duties",
  scouting: "Open Lineup",
  media: "Open Media",
  hours: "Open My hours",
  learning: "Open Learning",
  skills: "Open Skills",
  tools: "Open Tool checkout",
  money: "Open Orders",
  onboarding: "Open Getting started",
};

function isMyKitView(value: unknown): value is MyKitView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function myKitCacheOrg(data: MyKitView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistMyKitSnapshot(orgHint: string, data: MyKitView): Promise<void> {
  const cacheOrg = myKitCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("my-kit", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("my-kit", "_", data);
  } catch {
    // Live My Kit already painted; IndexedDB is best-effort.
  }
}

const TONE_LABEL: Record<MyKitTone, string> = {
  overdue: "Overdue",
  due: "Due soon",
  done: "Done",
  info: "For reference",
  neutral: "",
};

function SectionCard({ section }: { section: MyKitSection }) {
  return (
    <Panel className={["mk-section", section.emphasis ? "emphasis" : ""].filter(Boolean).join(" ")}>
      <div className="mk-section-head">
        <h2>{section.title}</h2>
        {section.actionable > 0 ? (
          <Badge tone="setup">
            {section.actionable} need{section.actionable === 1 ? "s" : ""} attention
          </Badge>
        ) : null}
      </div>
      {section.reason ? <p className="mk-reason">{section.reason}</p> : null}

      {section.rows.length > 0 ? (
        <ul className="mk-rows">
          {section.rows.map((row) => (
            <li key={row.id}>
              <a className={`mk-row tone-${row.tone}`} href={row.href}>
                <span className="mk-row-main">
                  <span className="mk-row-title">
                    {/* Colour is never the only channel — the tone is spoken too. */}
                    {TONE_LABEL[row.tone] ? (
                      <span className="sr-only">{TONE_LABEL[row.tone]}. </span>
                    ) : null}
                    {row.title}
                  </span>
                  {row.detail ? <span className="mk-row-detail">{row.detail}</span> : null}
                </span>
                {row.meta ? <span className="mk-row-meta">{row.meta}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mk-empty">{section.emptyLabel}</p>
      )}

      <div className="mk-section-footer">
        <Button as="a" variant="secondary" href={section.href}>
          {OPEN_LABEL[section.id]}
        </Button>
      </div>
    </Panel>
  );
}

export default function MyKitClient() {
  const [view, setView] = useState<MyKitView | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<MyKitView | null>(null);
  viewRef.current = view;

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const orgHint = params.get("orgId")?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<MyKitView>("my-kit", orgHint || "_");
        if (!viewRef.current && cached?.data && isMyKitView(cached.data)) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      try {
        const query = new URLSearchParams();
        if (orgHint) query.set("orgId", orgHint);
        const response = await fetch(`/api/my-kit${query.toString() ? `?${query.toString()}` : ""}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as MyKitView | { error?: string };
        if (!response.ok || !isMyKitView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setErrorMessage("Could not refresh My Kit. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setErrorMessage("error" in data && data.error ? data.error : "");
            setFetchFailed(true);
          }
          return;
        }
        setErrorMessage("");
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistMyKitSnapshot(orgHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setErrorMessage("Could not refresh My Kit. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const teamHref = hubWorkbenchHref("team", "attendance", orgId);

  const shell: ShellState = fetchFailed
    ? "error"
    : view == null
      ? "loading"
      : view.status === "setup_required"
        ? "setup"
        : "ready";

  const live = view?.status === "live" ? view : null;

  return (
    <main className="module-page mk-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / My Kit"}
          </>
        }
        title="My Kit"
        description="What you need tonight — assignments and packing that belong to you. Read-only, never a template kit."
      >
        <nav className="product-hub-related mk-related" aria-label="Related personal views">
          <Button as="a" variant="secondary" href={withOrgHref("/my-day", orgId)}>
            My Day
          </Button>
          <Button as="a" variant="secondary" href={withOrgHref("/hours-self-view", orgId)}>
            My hours
          </Button>
          <Button as="a" variant="secondary" href={withOrgHref("/start", orgId)}>
            Getting started
          </Button>
        </nav>
      </PageHeader>

      <OfflineBanner feature="My Kit" fromCache={fromCache} cachedAt={cachedAt} />
      {errorMessage && view ? <p className="app-muted">{errorMessage}</p> : null}

      <Shell
        state={shell}
        loading={
          <div aria-busy="true" aria-label="Loading My Kit">
            <SoftBlockSkeleton lines={6} />
          </div>
        }
        setup={
          <EmptyState
            soft
            badge="Needs setup"
            badgeTone="setup"
            title={view?.status === "setup_required" ? view.message : "Choose your team"}
            description="My Kit shows only your assignments on this team."
          >
            {view?.status === "setup_required" && view.steps[0] ? (
              <Button as="a" variant="primary" href={view.steps[0].href}>
                {view.steps[0].label}
              </Button>
            ) : (
              <Button as="a" variant="primary" href="/workspace">
                Choose your team
              </Button>
            )}
          </EmptyState>
        }
        error={{
          title: "Could not load My Kit",
          message: errorMessage,
          onRetry: load,
        }}
      >
        {live ? (
          <>
            <Panel className="mk-tonight" aria-label="What you need tonight">
              <div className="mk-section-head">
                <h2>Tonight · {live.tonight.date}</h2>
                {live.tonight.rows.length > 0 ? (
                  <Badge tone="setup">
                    {live.tonight.rows.length} item{live.tonight.rows.length === 1 ? "" : "s"}
                  </Badge>
                ) : (
                  <Badge tone="good">Nothing assigned</Badge>
                )}
              </div>
              <p className="mk-reason">
                {live.tonight.assignmentCount} assigned
                {live.tonight.assignmentCount === 1 ? " item" : " items"}
                {" · "}
                {live.tonight.packingCount} packing
                {live.tonight.packingCount === 1 ? " item" : " items"} still yours to pack.
              </p>
              {live.tonight.rows.length > 0 ? (
                <ul className="mk-rows">
                  {live.tonight.rows.map((row) => (
                    <li key={row.id}>
                      <a className={`mk-row tone-${row.tone}`} href={row.href}>
                        <span className="mk-row-main">
                          <span className="mk-row-title">
                            {TONE_LABEL[row.tone] ? (
                              <span className="sr-only">{TONE_LABEL[row.tone]}. </span>
                            ) : null}
                            {row.title}
                          </span>
                          {row.detail ? <span className="mk-row-detail">{row.detail}</span> : null}
                        </span>
                        {row.meta ? <span className="mk-row-meta">{row.meta}</span> : null}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  compact
                  badge="Honest empty"
                  badgeTone="good"
                  title="Nothing on your kit tonight"
                  description={live.tonight.emptyLabel}
                />
              )}
              <div className="mk-section-footer">
                <Button as="a" variant="secondary" href={withOrgHref("/todos", orgId)}>
                  Open Work
                </Button>
                <Button as="a" variant="secondary" href={withOrgHref("/packing", orgId)}>
                  Open Packing
                </Button>
              </div>
            </Panel>

            <Panel className="mk-identity" aria-label="Who this kit is for">
              <div className="mk-section-head">
                <h2>{live.person.displayName || "Your kit"}</h2>
                <Badge tone={live.actionableCount > 0 ? "setup" : "good"}>
                  {live.actionableCount > 0
                    ? `${live.actionableCount} need${live.actionableCount === 1 ? "s" : ""} attention`
                    : "Nothing overdue"}
                </Badge>
              </div>
              <ul className="mk-identity-chips">
                <li>
                  <Badge tone="neutral">{live.person.focusLabel}</Badge>
                </li>
                {live.person.teamRole ? (
                  <li>
                    <Badge tone="neutral">{live.person.teamRole}</Badge>
                  </li>
                ) : null}
                {live.person.subteams.map((subteam) => (
                  <li key={subteam.id}>
                    <Badge tone="info">{subteam.name}</Badge>
                  </li>
                ))}
              </ul>
              {live.person.subteams.length === 0 ? (
                <p className="mk-empty">
                  You are not on a subteam yet, so this kit shows the whole-team view.{" "}
                  <a href={withOrgHref("/team/calendar", orgId)}>Join a subteam calendar</a> to sharpen it.
                </p>
              ) : null}
            </Panel>

            <section className="mk-stats" aria-label="My totals">
              <StatTile
                label="Hours logged"
                value={formatHours(live.hours.totalMinutes)}
                href={withOrgHref("/hours-self-view", orgId)}
                footer={
                  live.hours.lastLoggedOn ? `Last ${live.hours.lastLoggedOn}` : "Nothing logged yet"
                }
              />
              <StatTile
                label="Day streak"
                value={live.hours.streakDays}
                unit={live.hours.streakDays === 1 ? "day" : "days"}
                href={withOrgHref("/hours-self-view", orgId)}
                footer="Consecutive days with a log"
              />
              <StatTile
                label="Sessions"
                value={live.hours.sessionCount}
                footer={live.hours.openSession ? "One still open" : "All closed"}
              />
              <StatTile
                label="Needs attention"
                value={live.actionableCount}
                footer="Overdue or due within 3 days"
              />
            </section>

            {live.quickLinks.length > 0 ? (
              <Panel aria-label="Tools for your subteam">
                <div className="mk-section-head">
                  <h2>{live.person.focusLabel} tools</h2>
                </div>
                <nav className="mk-quick-links" aria-label="Subteam tools">
                  {live.quickLinks.map((link) => (
                    <Button as="a" variant="secondary" key={link.id} href={link.href}>
                      {link.label}
                    </Button>
                  ))}
                </nav>
              </Panel>
            ) : null}

            <div className="mk-sections">
              {live.sections.map((section) => (
                <SectionCard key={section.id} section={section} />
              ))}
            </div>

            {live.unavailableSections.length > 0 ? (
              <p className="mk-empty">
                {live.unavailableSections.length} section
                {live.unavailableSections.length === 1 ? "" : "s"} are not part of this deployment yet
                and are shown empty rather than guessed at.
              </p>
            ) : null}
          </>
        ) : null}
      </Shell>
    </main>
  );
}
