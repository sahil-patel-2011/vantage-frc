import type { Metadata } from "next";
import { Suspense } from "react";
import OfflineClient from "./offline-client";
import "./offline.css";

export const metadata: Metadata = {
  title: "Offline",
  description: "Vantage offline shell — reopen scouting and team tools from a prior visit.",
  robots: { index: false, follow: false },
};

/**
 * The page's critical styles, inline in its HTML. The service worker serves this page from its
 * cache when a navigation fails; the hashed /_next/static stylesheets it links can be missing
 * then (no signal, or a newer deploy), and the page used to render as bare unstyled text. These
 * rules use fixed fallbacks for every token so they read correctly with no other CSS loaded;
 * offline.css refines them when it is there.
 */
const CRITICAL_OFFLINE_CSS = `
.offline-shell{box-sizing:border-box;min-height:100dvh;margin:0;padding:clamp(28px,6vw,64px) clamp(16px,5vw,40px) 48px;
  background:var(--bg,#f5f6f4);color:var(--ink,#17201c);
  font:16px/1.5 var(--font-source-sans,ui-sans-serif),system-ui,-apple-system,"Segoe UI",sans-serif}
.offline-shell *{box-sizing:border-box}
.offline-shell-brand{margin:0 0 12px;font:700 clamp(28px,5vw,40px)/1.1 var(--font-source-serif,Georgia),Georgia,serif;letter-spacing:-.03em}
.offline-shell h1{margin:0 0 10px;font-size:clamp(22px,3.5vw,28px);font-weight:650;line-height:1.2}
.offline-shell h2{margin:0;font-size:18px}
.offline-shell p{max-width:36rem}
.offline-shell-lead,.offline-shell-hint,.offline-shell-next header p{color:var(--muted,#4b5852)}
.offline-shell-status{margin:0 0 22px;padding:10px 12px;border:1px solid var(--line,#d6dcd8);border-radius:12px;background:var(--surface,#fff);font-size:14px}
.offline-shell-next{max-width:36rem;display:grid;gap:10px;margin:0 0 18px}
.offline-shell-next ol{margin:0;padding:0;list-style:none;display:grid;gap:8px}
.offline-shell-next li{padding:12px 14px;border:1px solid var(--line,#d6dcd8);border-radius:12px;background:var(--surface,#fff)}
.offline-shell-next a,.offline-shell-related a{color:inherit;text-decoration:none}
.offline-shell-next a{display:grid;gap:2px;min-height:44px}
.offline-shell-next a span{color:var(--muted,#4b5852);font-size:13px}
.offline-shell-related{display:flex;flex-wrap:wrap;gap:8px;max-width:36rem}
.offline-shell-related a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border:1px solid var(--line,#d6dcd8);border-radius:12px;background:var(--surface,#fff)}
.offline-shell-retry{display:inline-flex;align-items:center;min-height:48px;margin:0 0 22px;padding:0 20px;border:0;border-radius:12px;
  background:var(--accent,#1f6f52);color:#fff;font:inherit;font-weight:600;cursor:pointer}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]) .offline-shell{background:var(--bg,#101412);color:var(--ink,#e8ece9)}
  :root:not([data-theme="light"]) :is(.offline-shell-status,.offline-shell-next li,.offline-shell-related a){background:var(--surface,#1a201d);border-color:var(--line,#2c3531)}
  :root:not([data-theme="light"]) :is(.offline-shell-lead,.offline-shell-hint,.offline-shell-next header p,.offline-shell-next a span){color:var(--muted,#a5b0aa)}
}
:root[data-theme="dark"] .offline-shell{background:var(--bg,#101412);color:var(--ink,#e8ece9)}
:root[data-theme="dark"] :is(.offline-shell-status,.offline-shell-next li,.offline-shell-related a){background:var(--surface,#1a201d);border-color:var(--line,#2c3531)}
:root[data-theme="dark"] :is(.offline-shell-lead,.offline-shell-hint,.offline-shell-next header p,.offline-shell-next a span){color:var(--muted,#a5b0aa)}
`;

/** Public navigation shell for cold offline loads (service-worker fallback). */
export default function OfflinePage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CRITICAL_OFFLINE_CSS }} />
      <Suspense
        fallback={
          <main className="offline-shell">
            <p className="offline-shell-brand">Vantage</p>
            <h1>Loading offline shell…</h1>
          </main>
        }
      >
        <OfflineClient />
      </Suspense>
    </>
  );
}
