"use client";

import { Children, Fragment, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { isMarkedToolbarAction, layoutPageToolbar, type PageActionIntent } from "../../lib/ui/page-toolbar-model";
import { Button } from "./button";
import { PageOptions } from "./page-options";
import "./page-toolbar.css";

type PageToolbarProps = {
  /** Names the toolbar for assistive tech. Required. */
  label: string;
  children?: ReactNode;
  className?: string;
};

const ACTION_GROUP = /header-actions|header-meta|soft-btn-row|(?:^|\s)app-actions(?:\s|$)/;
const CHROME_NAME = /Related|Strip|Badge|Branding|Banner|Status|Pill|Skeleton|Icon|Note|Freshness/;
const ACTION_NAME = /Button|ShareLink|CopyShare/;
const CHROME_TAG = new Set([
  "nav", "span", "p", "strong", "small", "em", "output", "label", "ul", "ol", "li", "dl",
  "details", "img", "svg", "time", "abbr", "h1", "h2", "h3", "h4", "h5", "h6", "header",
  "section", "form", "select", "input",
]);

/**
 * The one page-header / card toolbar.
 *
 * Keeps the caller's wrapper (so existing header CSS still applies), shows at
 * most one filled action and three quiet ones, and files the rest under More.
 * Destructive actions always go under More.
 */
export function PageToolbar({ label, children, className }: PageToolbarProps) {
  const parts = renderParts(children, label);
  if (!parts.length) return null;
  return (
    <div className={["page-toolbar", className].filter(Boolean).join(" ")} data-page-toolbar="shared">
      {parts}
    </div>
  );
}

function renderParts(children: ReactNode, label: string): ReactNode[] {
  const out: ReactNode[] = [];
  let loose: ReactNode[] = [];
  let generation = 0;

  const flush = () => {
    if (!loose.length) return;
    const batch = loose;
    loose = [];
    const cluster = renderActionCluster(batch, label);
    if (cluster) out.push(<Fragment key={`actions-${generation++}`}>{cluster}</Fragment>);
  };

  // Fragments are transparent. A `{condition && <>...</>}` group stays in the
  // same toolbar as the buttons around it, so More is one menu, not two.
  const visit = (child: ReactNode) => {
    if (child == null || typeof child === "boolean") return;
    if (typeof child === "string" || typeof child === "number") {
      if (String(child).trim()) {
        flush();
        out.push(<Fragment key={`text-${generation++}`}>{child}</Fragment>);
      }
      return;
    }
    if (!isValidElement(child)) return;
    if (child.type === Fragment) {
      Children.forEach(readProps(child).children as ReactNode, visit);
      return;
    }
    if (isActionGroup(child)) {
      flush();
      out.push(<Fragment key={child.key ?? `group-${generation++}`}>{renderGroup(child, label)}</Fragment>);
      return;
    }
    if (isActionNode(child)) {
      loose.push(child);
      return;
    }
    flush();
    out.push(<Fragment key={child.key ?? `chrome-${generation++}`}>{child}</Fragment>);
  };

  Children.forEach(children, visit);
  flush();
  return out;
}

function renderGroup(element: ReactElement, label: string): ReactElement {
  const props = readProps(element);
  const { children, ...rest } = props;
  return cloneElement(
    element,
    { ...rest, "data-page-toolbar": "shared" } as never,
    renderParts(children as ReactNode, label),
  );
}

function renderActionCluster(nodes: ReactNode[], label: string): ReactNode {
  const slots = nodes.map((node, index) => ({
    id: `a${index}`,
    intent: isValidElement(node) ? intentOf(node) : ("chrome" as const),
    node,
  }));
  const layout = layoutPageToolbar(slots.map(({ id, intent }) => ({ id, intent })));
  const byId = new Map(slots.map((slot) => [slot.id, slot.node]));
  const hasActions = Boolean(layout.primary) || layout.secondary.length > 0 || layout.overflow.length > 0;
  if (!hasActions) return null;
  return (
    <div
      className="page-toolbar-actions"
      role="toolbar"
      aria-label={label}
      data-has-actions="true"
      data-page-toolbar="actions"
    >
      {layout.secondary.map((id) => dress(byId.get(id), "secondary", id))}
      {layout.overflow.length ? (
        <PageOptions label="More">
          {layout.overflow.map((id) => dress(byId.get(id), "overflow", id))}
        </PageOptions>
      ) : null}
      {layout.primary ? dress(byId.get(layout.primary), "primary", layout.primary) : null}
    </div>
  );
}

function dress(node: ReactNode | undefined, place: "primary" | "secondary" | "overflow", key: string): ReactNode {
  if (!node || !isValidElement(node)) return node ?? null;
  const destructive = intentOf(node) === "destructive";
  if (place === "primary") {
    if (node.type === Button) {
      return cloneElement(node, { key, variant: "primary", "data-primary-action": "true" } as never);
    }
    return cloneElement(node, {
      key,
      className: mergeClass(node, "app-button primary is-primary"),
      "data-primary-action": "true",
    } as never);
  }
  if (node.type === Button) {
    return cloneElement(node, {
      key,
      variant: "ghost",
      tone: destructive ? "danger" : undefined,
      "data-primary-action": undefined,
    } as never);
  }
  if (acceptsVariant(node)) {
    return cloneElement(node, { key, variant: "ghost" } as never);
  }
  // A raw button keeps a class that already styles it (the live refresh pill).
  // One with no chrome becomes a quiet text button, red when it destroys.
  return cloneElement(node, {
    key,
    className: mergeClass(node, destructive ? "app-button ghost tone-danger" : "app-button ghost"),
    "data-primary-action": undefined,
  } as never);
}

function mergeClass(node: ReactElement, extra: string): string {
  const className = String(readProps(node).className ?? "");
  if (/\bapp-button\b|\bedc-live\b/.test(className)) return className;
  return `${className} ${extra}`.trim();
}

function isActionGroup(element: ReactElement): boolean {
  if (element.type !== "div" && element.type !== "span") return false;
  const props = readProps(element);
  const className = String(props.className ?? "");
  if (props.role === "group" || /kit-segment|form-view-segments|product-hub-related/.test(className)) return false;
  return ACTION_GROUP.test(className);
}

function isActionNode(node: ReactElement): boolean {
  return node.type !== Fragment && !isActionGroup(node) && intentOf(node) !== "chrome";
}

function intentOf(element: ReactElement): PageActionIntent {
  const props = readProps(element);
  const explicit = props["data-action-intent"];
  if (explicit === "primary" || explicit === "secondary" || explicit === "destructive" || explicit === "chrome") {
    return explicit;
  }
  const name = componentName(element.type);
  const tag = typeof element.type === "string" ? element.type : "";
  if (CHROME_TAG.has(tag) || CHROME_NAME.test(name)) return "chrome";
  if (tag === "div" || tag === "section") return "chrome";
  if (tag === "a") {
    const className = String(props.className ?? "");
    if (!/app-button|is-primary|\bquick\b|primary-action/.test(className)) return "chrome";
  } else if (tag !== "button" && element.type !== Button && !isMarkedToolbarAction(element.type) && !ACTION_NAME.test(name)) {
    return "chrome";
  }
  const variant = props.variant;
  const tone = props.tone;
  const className = String(props.className ?? "");
  if (variant === "danger" || tone === "danger" || /\bdanger\b|\bdestructive\b/.test(className)) return "destructive";
  if (
    variant === "primary"
    || /\bis-primary\b/.test(className)
    || /\bapp-button primary\b/.test(className)
    || (/\bprimary\b/.test(className) && /\bquick\b/.test(className))
  ) {
    return "primary";
  }
  return "secondary";
}

function acceptsVariant(element: ReactElement): boolean {
  return element.type === Button
    || isMarkedToolbarAction(element.type)
    || ACTION_NAME.test(componentName(element.type))
    || "variant" in readProps(element);
}

function componentName(type: unknown): string {
  if (typeof type === "function") {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || "";
  }
  return "";
}

function readProps(element: ReactElement): Record<string, unknown> {
  return (element.props ?? {}) as Record<string, unknown>;
}
