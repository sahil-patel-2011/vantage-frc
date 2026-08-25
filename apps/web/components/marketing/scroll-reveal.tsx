"use client";

import { useEffect } from "react";

/**
 * Fade/rise-on-scroll for elements marked with [data-reveal].
 * Progressive enhancement: nothing is hidden until this mounts
 * (CSS is gated on html.reveal-armed), and prefers-reduced-motion
 * short-circuits to fully visible content.
 */
export function ScrollReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (els.length === 0) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }

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
      { rootMargin: "80px 0px 0px 0px", threshold: 0.01 },
    );
    els.forEach((el) => {
      // Anything already in view on mount shows immediately (no pop-in).
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight + 40 && rect.bottom > 0) {
        el.classList.add("is-in");
      } else {
        io.observe(el);
      }
    });

    return () => {
      io.disconnect();
      document.documentElement.classList.remove("reveal-armed");
    };
  }, []);

  return null;
}
