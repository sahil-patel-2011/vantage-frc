"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./ui.module.css";

type ToolbarProps = {
  children: ReactNode;
  /** Pin to the top of the scroll container; auto-compensates focus scroll-margin. */
  sticky?: boolean;
  "aria-label"?: string;
  className?: string;
};

/**
 * Filter / action bar. The sticky variant measures its own height into `--toolbar-h`
 * so focusable descendants get `scroll-margin-top` — keyboard focus is never obscured
 * (WCAG 2.2 Focus Not Obscured, 2.4.11).
 */
export function Toolbar({ children, sticky = false, "aria-label": ariaLabel, className }: ToolbarProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState<number | null>(null);

  useEffect(() => {
    if (!sticky || !ref.current) return;
    const el = ref.current;
    const measure = () => setH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sticky]);

  const cls = [styles.toolbar, sticky ? styles.toolbarSticky : undefined, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={ref}
      className={cls}
      role="toolbar"
      aria-label={ariaLabel}
      style={sticky && h ? ({ "--toolbar-h": `${h}px` } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
