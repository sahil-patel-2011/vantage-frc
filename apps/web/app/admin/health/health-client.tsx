"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, EmptyState, PageHeader, SoftBlockSkeleton } from "../../../components/ui";
import { Chevron, SidePanel, StatusPill, api, when } from "../admin-console-kit";
import "../admin-console.css";

type Status = "healthy" | "degraded" | "down" | "not_set_up";
type ModuleItem = { id: string; label: string; status: Status; summary: string; checked: "live" | "settings"; checkedAt: string; since: string | null };
type ModuleDetail = ModuleItem & {
  lastSuccessAt: string | null;
  problem: string | null;
  fix: string[];
  fixLink: { label: string; href: string } | null;
  logs: Array<{ at: string | null; source: string; message: string }>;
};
type List = { checkedAt: string; summary: Record<Status, number>; modules: ModuleItem[] };

const ORDER: Record<Status, number> = { down: 0, degraded: 1, not_set_up: 2, healthy: 3 };

function ModulePanel({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<ModuleDetail | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const load = useCallback(async (moduleId: string) => {
    setChecking(true);
    setError("");
    const result = await api<{ module: ModuleDetail }>(`/api/admin/health?module=${encodeURIComponent(moduleId)}`);
    setChecking(false);
    if (result.ok) setDetail(result.data.module);
    else setError(result.error);
  }, []);

  useEffect(() => {
    setDetail(null);
    if (id) void load(id);
  }, [id, load]);

  if (!id) return null;
  return (
    <SidePanel open onClose={onClose} title={detail?.label ?? "Module"} description={detail?.summary}>
      {error ? <p className="ac-message" data-tone="error">{error}</p> : null}
      {!detail && !error ? <p className="ac-message ac-muted">Checking…</p> : null}
      {detail ? (
        <>
          <dl className="ac-facts">
            <dt>Status</dt>
            <dd>
              <StatusPill status={detail.status} />
            </dd>
            <dt>Checked</dt>
            <dd>
              {when(detail.checkedAt)} · {detail.checked === "live" ? "from what actually happened" : "from its settings (it can't be tested without real traffic)"}
            </dd>
            {detail.since ? (
              <>
                <dt>Since</dt>
                <dd>{when(detail.since)}</dd>
              </>
            ) : null}
            {detail.lastSuccessAt ? (
              <>
                <dt>Last worked</dt>
                <dd>{when(detail.lastSuccessAt)}</dd>
              </>
            ) : null}
          </dl>
          {detail.problem ? (
            <section className="ac-panel-section">
              <h3>What&rsquo;s wrong</h3>
              <p className="ac-message">{detail.problem}</p>
            </section>
          ) : null}
          {detail.fix.length ? (
            <section className="ac-panel-section">
              <h3>How to fix it</h3>
              <ol className="ac-steps">
                {detail.fix.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {detail.fixLink ? (
                <a className="ac-small" href={detail.fixLink.href}>
                  {detail.fixLink.label}
                </a>
              ) : null}
            </section>
          ) : null}
          <section className="ac-panel-section">
            <h3>Recent errors and log lines</h3>
            {detail.logs.length ? (
              <ul className="ac-logs">
                {detail.logs.map((line, index) => (
                  <li key={`${line.source}-${index}`}>
                    <small>
                      {line.source}
                      {line.at ? ` · ${when(line.at)}` : ""}
                    </small>
                    <code>{line.message}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ac-message ac-muted">Nothing logged.</p>
            )}
            <p className="ac-table-note">Keys, tokens and connection strings are removed from these lines.</p>
          </section>
          <div className="ac-actions">
            <Button variant="secondary" type="button" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" type="button" disabled={checking} onClick={() => void load(detail.id)}>
              {checking ? "Checking…" : "Check again"}
            </Button>
          </div>
        </>
      ) : null}
    </SidePanel>
  );
}

function HealthInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const openId = searchParams.get("module");

  const load = useCallback(async () => {
    setChecking(true);
    setError("");
    const result = await api<List>("/api/admin/health");
    setChecking(false);
    if (result.ok) setList(result.data);
    else setError(result.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The open module lives in the URL, so a link from the Overview opens it and Back closes it.
  const openModule = (id: string | null) => router.push(id ? `${pathname}?module=${id}` : pathname, { scroll: false });

  if (error && !list) {
    return (
      <main className="module-page admin-control ac-page">
        <PageHeader title="Health" />
        <EmptyState soft title="Health didn't load" description={error}>
          <Button variant="secondary" type="button" onClick={() => void load()}>
            Try again
          </Button>
        </EmptyState>
      </main>
    );
  }
  if (!list) {
    return (
      <main className="module-page admin-control ac-page" aria-busy="true">
        <PageHeader title="Health" />
        <SoftBlockSkeleton />
      </main>
    );
  }

  const modules = [...list.modules].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const parts = [
    list.summary.down ? `${list.summary.down} down` : null,
    list.summary.degraded ? `${list.summary.degraded} degraded` : null,
    list.summary.not_set_up ? `${list.summary.not_set_up} not set up` : null,
    `${list.summary.healthy} healthy`,
  ].filter(Boolean);

  return (
    <main className="module-page admin-control ac-page">
      <PageHeader title="Health" description={`${parts.join(" · ")}. Checked ${when(list.checkedAt)}. Open a module for the problem, its logs and the fix.`}>
        <Button variant="primary" type="button" disabled={checking} onClick={() => void load()}>
          {checking ? "Checking…" : "Check again"}
        </Button>
      </PageHeader>
      <ul className="ac-list">
        {modules.map((module) => (
          <li key={module.id}>
            <button type="button" className="ac-row" onClick={() => openModule(module.id)} aria-haspopup="dialog">
              <span className="ac-dot" data-status={module.status} aria-hidden="true" />
              <span className="ac-row-main">
                <strong>{module.label}</strong>
                <small>
                  {module.summary}
                  {module.since ? ` Since ${when(module.since)}.` : ""}
                </small>
              </span>
              <span className="ac-row-end">
                <StatusPill status={module.status} />
                <Chevron />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <ModulePanel id={openId} onClose={() => openModule(null)} />
    </main>
  );
}

export default function HealthClient() {
  return (
    <Suspense fallback={<SoftBlockSkeleton />}>
      <HealthInner />
    </Suspense>
  );
}
