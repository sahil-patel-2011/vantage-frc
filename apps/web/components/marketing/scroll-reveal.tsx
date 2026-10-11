"use client";

import { useEffect } from "react";

/**
 * Fade-and-rise for elements marked with [data-mx-reveal] as they scroll into view
 * (marketing-site.css). Progressive enhancement: nothing is hidden until this mounts (the CSS is
 * gated on html.reveal-armed), anything already on screen at that moment stays shown, and under
 * prefers-reduced-motion everything is simply visible. Opacity and transform only, so a reveal
 * never moves the layout.
 */
export function ScrollReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-mx-reveal]"));
    if (els.length === 0) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }

    // Anything already in view (or above it, after a reload partway down) shows at once.
    const pending = els.filter((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight + 40) {
        el.classList.add("is-in");
        return false;
      }
      return true;
    });
    if (pending.length === 0) return;

    document.documentElement.classList.add("reveal-armed");
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
    );
    pending.forEach((el) => io.observe(el));

    return () => {
      io.disconnect();
      document.documentElement.classList.remove("reveal-armed");
    };
  }, []);

  return null;
}
