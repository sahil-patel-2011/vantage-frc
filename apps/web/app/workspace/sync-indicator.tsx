"use client";
import { useEffect, useState } from "react";
export default function SyncIndicator() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); addEventListener("online", update); addEventListener("offline", update);
    return () => { removeEventListener("online", update); removeEventListener("offline", update); };
  }, []);
  return <span className={`sync-indicator ${online ? "online" : "offline"}`} role="status">
    <i /> {online ? "Online · ready to sync" : "Offline · saving on this device"}
  </span>;
}
