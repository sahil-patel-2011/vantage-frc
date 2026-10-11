"use client";

import { useCallback, useId, useState } from "react";
import { useDismiss } from "../../hooks/use-dismiss";
import { withOrgHref } from "../../lib/nav/product-nav";

/**
 * One way in to record money. Spending had five doors (Log a receipt, Add money in, Add a
 * purchase, the spending plan's purchase card, Record fee); this asks what happened and opens the
 * right form, already expanded.
 */
export function MoneyAddMenu({
  orgId,
  canManageFinances = true,
  viewOnly = false,
}: {
  orgId: string | null;
  /** A finance manager records money; everyone else can only ask for something to be bought. */
  canManageFinances?: boolean;
  /** View only can't add anything, so there is no menu (A5-24). */
  viewOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);
  const menuId = useId();
  const all = [
    { id: "bought", label: "We bought something", detail: "Log the receipt", href: "/business?tab=finance#log-receipt", manager: true },
    { id: "need", label: "We need something bought", detail: "Add it to the buy sheet for a mentor to approve", href: "/business?tab=orders#log-purchase", manager: false },
    { id: "in", label: "Money came in", detail: "A sponsor, grant, fundraiser or dues", href: "/business?tab=finance#add-funding", manager: true },
    { id: "fee", label: "An event or registration fee", detail: "Record it in the season budget", href: "/budget#fees", manager: true },
  ];
  const choices = all.filter((choice) => canManageFinances || !choice.manager);
  if (viewOnly || choices.length === 0) return null;
  return (
    <div className="money-add" ref={ref}>
      {/* Secondary: a page's own primary (Set your season budget, Save) is the one blue button. */}
      <button
        type="button"
        className="app-button secondary"
        data-testid="biz-add-menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        Add <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <ul className="money-add-menu" id={menuId} aria-label="What happened?">
          {choices.map((choice) => (
            <li key={choice.id}>
              <a href={withOrgHref(choice.href, orgId)} onClick={close}>
                <strong>{choice.label}</strong>
                <small>{choice.detail}</small>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
