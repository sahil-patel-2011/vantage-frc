"use client";

import { useState } from "react";
import { Icon } from "./icon";
import { Button, Modal } from "./ui";
import { hubWorkbenchId, type HubTabDef, type ProductHubDef } from "../lib/nav/hubs";
import { hubPageTitle } from "../lib/nav/hub-navigation";

/** One searchable destination picker replaces the workspace's stacked navigation rows. */
export function HubPagePicker({ hub, tabs, value, onChange }: {
  hub: ProductHubDef;
  tabs: readonly HubTabDef[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const destinations = tabs.filter(tab => tab.inSearch !== false);
  const roots = [...new Set(destinations.map(tab => hubWorkbenchId(hub, tab.id)))];
  const term = query.trim().toLowerCase();
  const groups = roots.map(root => ({
    id: root,
    label: hubPageTitle(hub, root),
    tabs: destinations.filter(tab => hubWorkbenchId(hub, tab.id) === root &&
      (!term || `${hubPageTitle(hub, tab.id)} ${hubPageTitle(hub, root)}`.toLowerCase().includes(term))),
  })).filter(group => group.tabs.length > 0);
  const close = () => { setOpen(false); setQuery(""); };
  return <>
    <Button type="button" variant="secondary" className="hub-browse-button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <Icon name="grid" /> Browse {hub.label}
    </Button>
    <Modal open={open} onClose={close} title={`Browse ${hub.label}`} className="hub-page-picker">
      <label className="hub-picker-search">
        <Icon name="search" />
        <span className="sr-only">Find a section or tool in {hub.label}</span>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a section or tool…" data-autofocus />
      </label>
      <div className="hub-picker-groups">
        {groups.map(group => <section key={group.id} aria-label={group.label}>
          <h3>{group.label}</h3>
          <div>{group.tabs.map(tab => <button type="button" key={tab.id} aria-current={tab.id === value ? "page" : undefined}
            onClick={() => { onChange(tab.id); close(); }}>
            <span>{hubPageTitle(hub, tab.id)}</span><Icon name={tab.id === value ? "check" : "chevron"} />
          </button>)}</div>
        </section>)}
        {!groups.length ? <p className="app-muted" role="status">No matching tools. Try another name.</p> : null}
      </div>
    </Modal>
  </>;
}
