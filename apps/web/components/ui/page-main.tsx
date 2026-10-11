"use client";

import { createContext, useContext, type ComponentPropsWithoutRef } from "react";

const InsideMain = createContext(false);

/**
 * The page's <main> landmark, exactly once.
 *
 * A feature page renders its own <main> when it is a page, and is also embedded in a hub, which
 * already has one: /build?tab=code and /ai had two nested <main> landmarks, so a screen reader's
 * "jump to main" landed on the outer frame. Inside another PageMain this renders a <div> with the
 * same props instead. `data-page-main` marks both, for the hub's `display: contents` rule.
 */
export function PageMain(props: ComponentPropsWithoutRef<"main">) {
  const nested = useContext(InsideMain);
  if (nested) return <div data-page-main="nested" {...props} />;
  return (
    <InsideMain.Provider value>
      <main data-page-main="" {...props} />
    </InsideMain.Provider>
  );
}
