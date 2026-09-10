"use client";

import type { ReactNode } from "react";

export function ToneBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "good" | "warn" | "danger" | "neutral" | "blue" }) {
  return <span className={`biz-badge ${tone}`}>{children}</span>;
}

export function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`biz-field${wide ? " wide" : ""}`}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}
