"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { SHELL_BODY_CLASSES, shellBodyClasses } from "../lib/nav/shell-body-class";

/**
 * <body>, with the app frame's classes already in the server HTML.
 *
 * The server render seeds them from the path, so the first paint has the product palette and the
 * top bar's space reserved (no teal flash, no 52px jump on hydration). After that this component
 * keeps them in step with client navigation through classList, before paint. It never re-renders
 * `className`: React rewriting the attribute would wipe the classes the shell and pages toggle
 * themselves (sidebar collapsed, event focus, an open drawer).
 */
export function AppBody({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [initialClassName] = useState(() => shellBodyClasses(pathname).join(" ") || undefined);

  useLayoutEffect(() => {
    const wanted = new Set<string>(shellBodyClasses(pathname));
    for (const name of SHELL_BODY_CLASSES) document.body.classList.toggle(name, wanted.has(name));
  }, [pathname]);

  // Extensions add attributes to <body> before hydration; that is not a mismatch worth a warning.
  return (
    <body className={initialClassName} suppressHydrationWarning>
      {children}
    </body>
  );
}
