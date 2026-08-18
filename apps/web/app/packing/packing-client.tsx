"use client";

import { useCallback, useEffect, useState } from "react";
import { groupPacking, packProgress, type PackingList, type PackingView } from "../../lib/packing";

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
            Teammates submit what they need packed here — the packing lead accepts onto the master list. Never a DEMO inbox.
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
          <button type="submit" className="app-button secondary" disabled={busy || !requestLabel.trim()}>
            Request pack
          </button>
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
        <button type="submit" className="app-button secondary" disabled={busy || !label.trim()}>
          Add to master list
        </button>
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
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");

  const load = useCallback(async () => {
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/packing${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as PackingView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load packing lists.");
        setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
    } catch {
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
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
            <>
              <strong>Could not load packing lists</strong>
              <p className="app-muted">{error || "Check your connection and try again."}</p>
              <button type="button" className="app-button secondary" onClick={() => void load()}>
                Retry
              </button>
            </>
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
        <div className="app-card pack-empty">
          <strong>Select a team workspace</strong>
          <p className="app-muted">{view.message}</p>
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
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
          <button type="button" className="app-button" disabled={busyKey === "create"} onClick={createList}>
            New list
          </button>
        </div>
      </header>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {lists.length === 0 ? (
        <div className="app-card pack-empty">
          <strong>No packing lists yet</strong>
          <p className="app-muted">Create one — it seeds the standard competition load-out (batteries, tools, spares, drive station, safety).</p>
          <button type="button" className="app-button" disabled={busyKey === "create"} onClick={createList}>
            Create competition load-out
          </button>
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
