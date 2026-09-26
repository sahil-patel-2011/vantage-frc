"use client";

import { useCallback, useId, useState } from "react";
import { useDismiss } from "../../hooks/use-dismiss";
import { withOrgHref } from "../../lib/nav/product-nav";

/**
 * One way in to record money. Spending had five doors (Log a receipt, Add money in, Add a
 * purchase, the spending plan's purchase card, Record fee); this asks what happened and opens the
 * right form, already expanded.
 */
export function MoneyAddMenu({ orgId }: { orgId: string | null }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);
  const menuId = useId();
  const choices = [
    { id: "bought", label: "We bought something", detail: "Log the receipt", href: "/business?tab=finance#log-receipt" },
    { id: "need", label: "We need something bought", detail: "Add it to the buy sheet for a mentor to approve", href: "/business?tab=orders#log-purchase" },
    { id: "in", label: "Money came in", detail: "A sponsor, grant, fundraiser or dues", href: "/business?tab=finance#add-funding" },
    { id: "fee", label: "An event or registration fee", detail: "Record it in the season budget", href: "/budget#fees" },
  ];
  return (
    <div className="money-add" ref={ref}>
      <button
        type="button"
        className="app-button"
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
