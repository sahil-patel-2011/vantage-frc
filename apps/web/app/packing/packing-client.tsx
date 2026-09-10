"use client";
import { Button } from "../../components/ui";

import { useCallback, useEffect, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { withOrgHref } from "../../lib/nav/product-nav";
import {
  QUEUED_ON_DEVICE,
  getFeatureSnapshot,
  isBrowserOffline,
  putFeatureSnapshot,
  queueProductWrite,
  syncOutbox,
} from "../../lib/offline";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  applyPackingLocalWrite,
  groupPacking,
  isPackingQueueableAction,
  packProgress,
  type PackingList,
  type PackingView,
} from "../../lib/packing";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ListDetail({
  list,
  orgId,
  busyKey,
  run,
}: {
  list: PackingList;
  orgId: string;
  busyKey: string | null;
  run: (body: ActionBody, key: string) => Promise<void>;
}) {
  const [category, setCategory] = useState("Other");
  const [label, setLabel] = useState("");
  const [quantity, setQuantity] = useState("");
  const [requestLabel, setRequestLabel] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const progress = packProgress(list.items);
  const groups = groupPacking(list.items);
  const pending = list.requests ?? [];
  const busy = busyKey != null;

  return (
    <section className="pack-detail app-card">
      <header className="pack-detail-head">
        <div>
          <h2>{list.title}</h2>
          <p className="app-muted">
            {progress.packed}/{progress.total} packed
            {list.eventKey ? ` · ${list.eventKey}` : ""}
            {list.createdByName ? ` · by ${list.createdByName}` : ""}
          </p>
        </div>
        <div className="pack-head-actions">
          {progress.done ? <span className="app-badge good">All packed</span> : null}
          {list.canManageMaster ? (
          <button
            type="button"
            className="pack-link"
            disabled={busy}
            onClick={() => {
              if (confirm("Unpack everything (reset for the next event)?")) {
                void run({ action: "reset_list", orgId, id: list.id }, "reset");
              }
            }}
          >
            Reset
          </button>
          ) : null}
          <button
            type="button"
            className="pack-link danger"
            disabled={busy}
            onClick={() => {
              if (confirm(`Delete list "${list.title}"?`)) {
                void run({ action: "delete_list", orgId, id: list.id }, "delete");
              }
            }}
          >
            Delete
          </button>
        </div>
      </header>

      <div className="pack-track" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${progress.percent}%` }} className={progress.done ? "done" : undefined} />
      </div>

      <section className="pack-inbox" aria-label="Packing requests">
        <h3>
          Requested items
          <span>{pending.length} pending</span>
        </h3>
        {pending.length === 0 ? (
          <p className="app-muted pack-inbox-empty">
            Teammates submit what they need packed here — the packing lead accepts onto the master list.
          </p>
        ) : (
          <ul>
            {pending.map((request) => (
              <li key={request.id}>
                <div>
                  <strong>{request.label}</strong>
                  {request.quantity > 1 ? <b className="pack-qty">×{request.quantity}</b> : null}
                  <small className="app-muted pack-inbox-meta">
                    {request.requestedName}
                    {request.category && request.category !== "Other" ? ` · ${request.category}` : ""}
                    {request.note ? ` · ${request.note}` : ""}
                  </small>
                </div>
                <div className="pack-inbox-actions">
                  {list.canManageMaster ? (
                    <>
                      <button
                        type="button"
                        className="pack-link"
                        disabled={busy}
                        onClick={() => void run({ action: "accept_request", orgId, id: request.id }, `req:${request.id}`)}
                      >
                        Add to list
                      </button>
                      <button
                        type="button"
                        className="pack-link danger"
                        disabled={busy}
                        onClick={() => void run({ action: "dismiss_request", orgId, id: request.id }, `req:${request.id}`)}
                      >
                        Dismiss
                      </button>
                    </>
                  ) : (
                    <small className="app-muted">Waiting on packing lead</small>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <form
          className="pack-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (!requestLabel.trim()) return;
            void run(
              {
                action: "request_item",
                orgId,
                listId: list.id,
                category: "Other",
                label: requestLabel.trim(),
                quantity: 1,
                note: requestNote.trim() || null,
              },
              "request-item",
            ).then(() => {
              setRequestLabel("");
              setRequestNote("");
            });
          }}
        >
          <input
            value={requestLabel}
            disabled={busy}
            placeholder="What should we pack? (fast request)"
            onChange={(event) => setRequestLabel(event.target.value)}
          />
          <input
            value={requestNote}
            disabled={busy}
            placeholder="Optional note"
            onChange={(event) => setRequestNote(event.target.value)}
          />
          <Button variant="secondary" type="submit" disabled={busy || !requestLabel.trim()}>
            Request pack
          </Button>
        </form>
      </section>

      {groups.map((group) => {
        const groupProgress = packProgress(group.items);
        return (
          <article key={group.category} className="pack-group">
            <h3>
              {group.category}
              <span>
                {groupProgress.packed}/{groupProgress.total}
              </span>
            </h3>
            <ul>
              {group.items.map((item) => (
                <li key={item.id} className={item.packed ? "packed" : undefined}>
                  <label>
                    <input
                      type="checkbox"
                      checked={item.packed}
                      disabled={busyKey === `item:${item.id}`}
                      onChange={(event) =>
                        void run({ action: "toggle_item", orgId, id: item.id, packed: event.target.checked }, `item:${item.id}`)
                      }
                    />
                    <span>
                      {item.label}
                      {item.quantity > 1 ? <b className="pack-qty">×{item.quantity}</b> : null}
                      {item.packed && item.packedByName ? (
                        <small className="app-muted">
                          {" "}
                          · {item.packedByName} {fmtWhen(item.packedAt)}
                        </small>
                      ) : null}
                    </span>
                  </label>
                  {list.canManageMaster ? (
                  <button
                    type="button"
                    className="pack-link danger"
                    aria-label="Remove item"
                    disabled={busy}
                    onClick={() => void run({ action: "delete_item", orgId, id: item.id }, `item:${item.id}`)}
                  >
                    ✕
                  </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </article>
        );
      })}

      {list.canManageMaster ? (
      <form
        className="pack-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!label.trim()) return;
          void run(
            {
              action: "add_item",
              orgId,
              listId: list.id,
              category: category.trim() || "Other",
              label: label.trim(),
              quantity: quantity === "" ? 1 : Number(quantity),
            },
            "add-item",
          ).then(() => {
            setLabel("");
            setQuantity("");
          });
        }}
      >
        <input value={category} disabled={busy} placeholder="Category" onChange={(e) => setCategory(e.target.value)} />
        <input value={label} disabled={busy} placeholder="Item (e.g. Spare intake wheels)" onChange={(e) => setLabel(e.target.value)} />
        <input
          type="number"
          min={1}
          step={1}
          placeholder="Qty"
          className="pack-qty-input"
          value={quantity}
          disabled={busy}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <Button variant="secondary" type="submit" disabled={busy || !label.trim()}>
          Add to master list
        </Button>
      </form>
      ) : (
        <p className="app-muted">Need something packed? Submit a request above — only the packing lead edits the master list.</p>
      )}
    </section>
  );
}

export default function PackingClient() {
  const [view, setView] = useState<PackingView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFetchFailed(false);
    setErrorStatus(null);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId") ?? "";
    const cached = orgId ? await getFeatureSnapshot<PackingView>("packing", orgId) : null;
    if (cached?.data) {
      setView(cached.data);
      setFromCache(true);
      setCachedAt(cached.cachedAt);
    }
    try {
      const response = await fetch(`/api/packing${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as PackingView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load packing lists.");
        setErrorStatus(response.status);
        if (!cached) setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      const cacheOrg = data.context.orgId || orgId;
      if (cacheOrg) await putFeatureSnapshot("packing", cacheOrg, data);
    } catch {
      if (!cached) setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId") ?? "";
    if (!orgId) return;
    const onOnline = () => {
      void syncOutbox({ orgId }).then(() => load());
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      if (isBrowserOffline() && isPackingQueueableAction(body.action) && body.orgId) {
        await queueProductWrite({
          feature: "packing_action",
          orgId: body.orgId,
          payload: body,
        });
        setView((current) => (current ? applyPackingLocalWrite(current, body, new Date().toISOString()) : current));
        setError(QUEUED_ON_DEVICE);
        return;
      }
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/packing", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string; id?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return;
        }
        if (body.action === "create_list" && data.id) setSelectedId(data.id);
        if (body.action === "delete_list") setSelectedId(null);
        await load();
      } catch {
        if (isBrowserOffline() && isPackingQueueableAction(body.action) && body.orgId) {
          await queueProductWrite({
            feature: "packing_action",
            orgId: body.orgId,
            payload: body,
          });
          setView((current) => (current ? applyPackingLocalWrite(current, body, new Date().toISOString()) : current));
          setError(QUEUED_ON_DEVICE);
          return;
        }
        setError("Network error — changes were not saved.");
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  if (fetchFailed || !view) {
    return (
      <main className="module-page pack-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Packing</span>
            <h1>Packing Lists</h1>
          </div>
        </header>
        <div className="app-card pack-empty">
          {fetchFailed ? (
            (() => {
              const copy = loadFailureCopy(
                classifyLoadFailure({
                  status: errorStatus,
                  message: error,
                  online: typeof navigator === "undefined" ? true : navigator.onLine,
                }),
                {
                  nextPath:
                    typeof window === "undefined"
                      ? null
                      : `${window.location.pathname}${window.location.search}`,
                  message: error || "Check your connection and try again.",
                },
              );
              return (
                <>
                  <strong>{copy.title}</strong>
                  <p className="app-muted">{copy.description}</p>
                  {copy.primary ? (
                    <Button as="a" variant="primary" href={copy.primary.href}>
                      {copy.primary.label}
                    </Button>
                  ) : null}
                  {copy.showRetry ? (
                    <Button variant="secondary" type="button" onClick={() => void load()}>
                      Retry
                    </Button>
                  ) : null}
                </>
              );
            })()
          ) : (
            <p className="app-muted">Loading packing lists…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page pack-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Packing</span>
            <h1>Packing Lists</h1>
            <p>Competition load-out checklists so nothing gets left in the shop.</p>
          </div>
        </header>
        <OfflineBanner feature="Packing" fromCache={fromCache} cachedAt={cachedAt} />
        <div className="app-card pack-empty">
          <strong>Select a team</strong>
          <p className="app-muted">{view.message}</p>
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </div>
      </main>
    );
  }

  const orgId = view.context.orgId ?? "";
  const lists = view.lists;
  const selected = lists.find((list) => list.id === selectedId) ?? lists[0] ?? null;

  const createList = () => {
    const title = newTitle.trim() || (view.context.eventKey ? `Load-out · ${view.context.eventKey}` : "Competition load-out");
    void run(
      { action: "create_list", orgId, title, eventKey: view.context.eventKey, seedTemplate: true },
      "create",
    ).then(() => setNewTitle(""));
  };

  return (
    <main className="module-page pack-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Competition / Packing</span>
          <h1>Packing Lists</h1>
          <p>
            Load-out checklists for {view.context.orgName ?? "your team"}
            {view.context.teamNumber ? ` (Team ${view.context.teamNumber})` : ""} — seeded with the standard FRC
            competition kit. Teammates request extras; the packing lead owns the master list.
          </p>
          {/* Packing sits between the shelf it draws from and the trip it loads
              into. Both were a hamburger away from a page you work standing up
              in the shop. */}
          <nav className="product-hub-related" aria-label="Related packing tools">
            <Button as="a" variant="secondary" href={withOrgHref("/spares", view.context.orgId)}>
              Consumables
            </Button>
            <Button as="a" variant="secondary" href={withOrgHref("/logistics", view.context.orgId)}>
              Logistics
            </Button>
          </nav>
        </div>
        <div className="pack-header-actions">
          <input
            value={newTitle}
            placeholder="New list name"
            disabled={busyKey === "create"}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") createList();
            }}
          />
          <Button variant="primary" type="button" disabled={busyKey === "create"} onClick={createList}>
            New list
          </Button>
        </div>
      </header>
      <OfflineBanner feature="Packing" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {lists.length === 0 ? (
        <div className="app-card pack-empty">
          <strong>No packing lists yet</strong>
          <p className="app-muted">Create one — it seeds the standard competition load-out (batteries, tools, spares, drive station, safety).</p>
          <Button variant="primary" type="button" disabled={busyKey === "create"} onClick={createList}>
            Create competition load-out
          </Button>
        </div>
      ) : (
        <div className="pack-layout">
          <aside className="pack-list-nav">
            {lists.map((list) => {
              const progress = packProgress(list.items);
              return (
                <button
                  key={list.id}
                  type="button"
                  className={list.id === selected?.id ? "pack-nav-item active" : "pack-nav-item"}
                  onClick={() => setSelectedId(list.id)}
                >
                  <strong>{list.title}</strong>
                  <span className="pack-nav-sub">
                    {progress.packed}/{progress.total} packed{progress.done ? " ✓" : ""}
                    {(list.requests?.length ?? 0) > 0 ? ` · ${list.requests.length} requested` : ""}
                  </span>
                  <span className="pack-nav-track">
                    <i style={{ width: `${progress.percent}%` }} className={progress.done ? "done" : undefined} />
                  </span>
                </button>
              );
            })}
          </aside>
          {selected ? <ListDetail key={selected.id} list={selected} orgId={orgId} busyKey={busyKey} run={run} /> : null}
        </div>
      )}
    </main>
  );
}
