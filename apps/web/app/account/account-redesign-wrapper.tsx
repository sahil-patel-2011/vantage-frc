"use client";

import { useEffect, useState } from "react";
import { AccountRedesign } from "./account-redesign";
import { fetchProductSession } from "../../lib/nav/product-session";
import type { Me } from "../../components/app-shell-model";

export default function AccountPageClient() {
  const [me, setMe] = useState<Me>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("orgId") ?? "";
    void fetchProductSession(id || null).then((data) => {
      if (data) setMe(data as Me);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  if (!loaded) {
    return (
      <main className="vt-page" id="main-content">
        <div className="vt-card" style={{ textAlign: "center", padding: 48 }}>
          <p style={{ color: "var(--vt-muted)", font: "500 14px var(--vt-font)" }}>Loading…</p>
        </div>
      </main>
    );
  }

  return <AccountRedesign me={me} />;
}
