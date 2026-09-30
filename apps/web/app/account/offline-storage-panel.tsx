"use client";

import { useEffect, useState } from "react";
import { deviceStorageSummary, formatBytes, type DeviceStorage } from "../../lib/scouting/device-storage";
import { GB, OFFLINE_BUDGET_KEY, readOfflineBudget, saveOfflineBudget } from "../../lib/offline/storage-budget";
import "./offline-storage.css";

export default function OfflineStoragePanel() {
  const [budget, setBudget] = useState(2);
  const [storage, setStorage] = useState<DeviceStorage | null>(null);
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);

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

  function choose(value: number) {
    try {
      saveOfflineBudget(value);
      setBudget(value);
      setNotice("Saved on this device.");
    } catch { setNotice("Could not save. Your previous limit is unchanged."); }
  }

  return (
    <section className="appearance-group offline-storage" aria-labelledby="offline-storage-title">
      <div className="offline-storage-heading">
        <div><h3 id="offline-storage-title">Offline storage</h3><p>Space for saved events and files on this device.</p></div>
      </div>
      <div className="offline-storage-controls">
        <div className="offline-budget-range">
          <label htmlFor="offline-budget">Cache budget <strong>{budget} GB</strong></label>
          <input id="offline-budget" type="range" min={2} max={20} step={1} value={budget} disabled={!loaded}
            aria-valuetext={`${budget} gigabytes`} onChange={event => choose(Number(event.target.value))} />
          <div className="offline-budget-scale"><span>2 GB</span><span>20 GB</span></div>
          <p>{storage?.usage != null ? `${formatBytes(storage.usage)} used by Vantage` : "Storage usage unavailable"}
            {storage?.quota != null ? ` · ${formatBytes(storage.quota)} browser limit` : ""}</p>
        </div>
      </div>
      <p>Synced uploads clear automatically. Unsent work stays safe.</p>
      <details className="offline-storage-details">
        <summary data-disclosure>Storage details</summary>
        <p>This is a cache budget, not reserved space. Your browser may allow less. Lowering the limit pauses new caching without deleting saved data.</p>
        <p>Saved events and files stay available offline after syncing. Drafts and unsent reports are never removed to meet this limit.</p>
      </details>
      {storage?.quota != null && storage.quota < budget * GB ? <p className="brand-notice">Browser limit: {formatBytes(storage.quota)}. Vantage will use less than your selected budget.</p> : null}
      {notice ? <p role="status" className="offline-storage-status">{notice}</p> : null}
    </section>
  );
}
