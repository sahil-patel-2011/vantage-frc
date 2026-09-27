"use client";

import { useEffect, useRef, useState } from "react";
import { deviceStorageSummary, formatBytes, type DeviceStorage } from "../../lib/scouting/device-storage";
import { GB, OFFLINE_BUDGET_KEY, readOfflineBudget, saveOfflineBudget } from "../../lib/offline/storage-budget";
import "./offline-storage.css";

const OPTIONS = Array.from({ length: 19 }, (_, index) => index + 2);

export default function OfflineStoragePanel() {
  const [budget, setBudget] = useState(2);
  const [storage, setStorage] = useState<DeviceStorage | null>(null);
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const wheel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    function refresh() {
      setBudget(readOfflineBudget());
      void deviceStorageSummary().then(value => { if (!cancelled) setStorage(value); });
      setLoaded(true);
    }
    function changed(event: StorageEvent) { if (event.key === OFFLINE_BUDGET_KEY) refresh(); }
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", changed);
    return () => { cancelled = true; window.removeEventListener("focus", refresh); window.removeEventListener("storage", changed); };
  }, []);

  useEffect(() => {
    const selected = wheel.current?.querySelector<HTMLElement>(`[data-budget="${budget}"]`);
    if (selected && wheel.current) wheel.current.scrollTop = selected.offsetTop - 48;
  }, [loaded, budget]);

  function choose(value: number) {
    try {
      saveOfflineBudget(value);
      setBudget(value);
      setNotice("Saved on this device. Uploaded changes are removed from the queue automatically.");
    } catch { setNotice("This browser could not save the preference. Your previous limit is unchanged."); }
  }

  return (
    <section className="appearance-group offline-storage" aria-labelledby="offline-storage-title">
      <div className="offline-storage-heading">
        <div><h3 id="offline-storage-title">Offline storage</h3><p>Set a cache budget for this browser, from 2 to 20 GB.</p></div>
        <span className="offline-device-mode"><span className="offline-device-touch">Touch layout</span><span className="offline-device-pointer">Desktop layout</span> · automatic</span>
      </div>
      <div className="offline-storage-controls">
        <div className="offline-budget-wheel" ref={wheel} role="group" aria-label="Offline cache size choices">
          {OPTIONS.map(value => <button key={value} type="button" data-budget={value} aria-pressed={value === budget}
            tabIndex={value === budget ? 0 : -1} disabled={!loaded}
            onKeyDown={event => {
              const next = event.key === "ArrowDown" ? Math.min(20, value + 1) : event.key === "ArrowUp" ? Math.max(2, value - 1)
                : event.key === "Home" ? 2 : event.key === "End" ? 20 : null;
              if (next != null) { event.preventDefault(); choose(next); wheel.current?.querySelector<HTMLButtonElement>(`[data-budget="${next}"]`)?.focus({ preventScroll: true }); }
            }} onClick={() => choose(value)}>{value} <span>GB</span></button>)}
        </div>
        <div className="offline-budget-range">
          <label htmlFor="offline-budget">Cache budget <strong>{budget} GB</strong></label>
          <input id="offline-budget" type="range" min={2} max={20} step={1} value={budget} disabled={!loaded}
            aria-valuetext={`${budget} gigabytes`} onChange={event => choose(Number(event.target.value))} />
          <div className="offline-budget-scale"><span>2 GB</span><span>20 GB</span></div>
          <p>{storage?.usage != null ? `${formatBytes(storage.usage)} used by Vantage` : "Storage usage unavailable"}
            {storage?.quota != null ? ` · ${formatBytes(storage.quota)} browser allowance` : ""}</p>
        </div>
      </div>
      <p>The browser controls available space; this setting does not reserve it. New downloads and read caches respect the budget. Reducing it pauses new caching until space is available.</p>
      <p>Unsent reports and drafts are never removed to meet this limit. Successfully uploaded changes leave the queue; saved event data and documents stay available offline.</p>
      {storage?.quota != null && storage.quota < budget * GB ? <p className="brand-notice">This browser allows less than {budget} GB. Vantage uses the available allowance and leaves room for unsent work.</p> : null}
      {notice ? <p role="status" className="brand-notice">{notice}</p> : null}
    </section>
  );
}
