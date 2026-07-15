"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import AppShell from "../components/app-shell";

export type Theme = "light" | "dark";

const STORAGE_KEY = "vantage-theme";

function syncBrowserColor(theme: Theme) {
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => { meta.content = theme === "dark" ? "#0b1014" : "#f7f6f2"; });
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  syncBrowserColor(theme);
  localStorage.setItem(STORAGE_KEY, theme);
  document.cookie = `vantage-theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent("vantage-theme", { detail: theme }));
}

export function ThemeToggle({ expanded = false }: { expanded?: boolean }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(current);
    syncBrowserColor(current);
    const sync = (event: Event) => setTheme((event as CustomEvent<Theme>).detail);
    window.addEventListener("vantage-theme", sync);
    return () => window.removeEventListener("vantage-theme", sync);
  }, []);

  async function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
    try {
      await fetch("/api/theme", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: next }),
      });
    } catch {
      // Local persistence remains authoritative when auth/database is unavailable.
    }
  }

  if (expanded) {
    return (
      <fieldset className="theme-setting">
        <legend>Appearance</legend>
        <p>Vantage starts in light mode. Dark mode is used only when you choose it.</p>
        <div role="radiogroup" aria-label="Color theme">
          {(["light", "dark"] as const).map((option) => (
            <button
              aria-checked={theme === option}
              className={theme === option ? "active" : ""}
              key={option}
              onClick={() => void choose(option)}
              role="radio"
              type="button"
            >
              <span aria-hidden="true">{option === "light" ? "☀" : "☾"}</span>
              {option === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={() => void choose(theme === "light" ? "dark" : "light")}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span>
      <span>{theme === "light" ? "Dark" : "Light"}</span>
    </button>
  );
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const productRoute = !["/", "/features", "/features/cad", "/features/strategy", "/features/code", "/workflow", "/pricing", "/privacy", "/terms", "/signin", "/sign-in"].includes(pathname)
    && !pathname.startsWith("/display/kiosk")
    && !pathname.startsWith("/showcase/present");

  useEffect(() => {
    if (!productRoute) return;
    void fetch("/api/theme")
      .then(async (response) => response.ok ? response.json() as Promise<{ theme?: Theme; persisted?: boolean }> : null)
      .then((result) => {
        if (result?.persisted && (result.theme === "light" || result.theme === "dark")) {
          applyTheme(result.theme);
          setTimeout(() => document.documentElement.classList.add("theme-ready"), 0);
        }
      })
      .catch(() => document.documentElement.classList.add("theme-ready"));
  }, [productRoute]);

  return (
    <>
      {children}
      {productRoute && <AppShell themeControl={<ThemeToggle />} />}
    </>
  );
}
