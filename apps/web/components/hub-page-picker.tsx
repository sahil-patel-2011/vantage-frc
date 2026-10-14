"use client";

import { useId, useRef, useState } from "react";
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
  const [section, setSection] = useState(() => hubWorkbenchId(hub, value));
  const searchRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const destinations = tabs.filter(tab => tab.inSearch !== false);
  const roots = [...new Set(destinations.map(tab => hubWorkbenchId(hub, tab.id)))];
  const term = query.trim().toLowerCase();
  const groups = roots.map(root => ({
    id: root,
    label: hubPageTitle(hub, root),
    tabs: destinations.filter(tab => hubWorkbenchId(hub, tab.id) === root && (term || section === "all" || section === root) &&
      (!term || `${hubPageTitle(hub, tab.id)} ${hubPageTitle(hub, root)}`.toLowerCase().includes(term))),
  })).filter(group => group.tabs.length > 0);
  const close = () => { setOpen(false); setQuery(""); };
  return <>
    <Button type="button" variant="secondary" className="hub-browse-button" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setSection(hubWorkbenchId(hub, value)); setOpen(true); }}>
      <Icon name="grid" /> Browse {hub.label}
    </Button>
    <Modal open={open} onClose={close} title={`Browse ${hub.label}`} className="hub-page-picker" scrollBody>
      <div className="hub-picker-search">
        <Icon name="search" />
        <label className="sr-only" htmlFor={searchId}>Find a section or tool in {hub.label}</label>
        <input id={searchId} ref={searchRef} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search all tools…" data-autofocus />
        {query ? <button type="button" className="hub-picker-clear" aria-label="Clear tool search" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><Icon name="x" /></button> : null}
      </div>
      <div className="hub-picker-filter">
        <label>Section<select value={term ? "all" : section} disabled={Boolean(term)} onChange={event => setSection(event.target.value)}>
          <option value="all">All sections</option>
          {roots.map(root => <option key={root} value={root}>{hubPageTitle(hub, root)}</option>)}
        </select></label>
        <small>{term ? "Searching all sections" : "Choose a section, or search every tool"}</small>
      </div>
      <div className="hub-picker-groups">
        {groups.map(group => {
          const ordered = [...group.tabs.filter(tab => tab.id === group.id), ...group.tabs.filter(tab => tab.id !== group.id && tab.featured), ...group.tabs.filter(tab => tab.id !== group.id && !tab.featured)];
          const row = (tab: HubTabDef) => tab.id === value ? <div key={tab.id} className="hub-picker-current" aria-current="page">
            <span>{hubPageTitle(hub, tab.id)}</span><small>Current page</small><Icon name="check" />
          </div> : <button type="button" key={tab.id}
            onClick={() => { onChange(tab.id); close(); }}>
            <span>{hubPageTitle(hub, tab.id)}</span><Icon name="chevron" />
          </button>;
          return <section key={group.id} aria-label={group.label}>
            {(section === "all" || term) && !group.tabs.some(tab => tab.id === group.id) ? <h3>{group.label}</h3> : null}
            <div>{ordered.map(row)}</div>
          </section>;
        })}
        {!groups.length ? <p className="app-muted" role="status">No matching tools. Try another name.</p> : null}
      </div>
    </Modal>
  </>;
}
