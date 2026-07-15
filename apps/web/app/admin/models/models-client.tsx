"use client";

import { useEffect, useState } from "react";

type Model = {
  id: string; displayName: string; provider: string; providerModelId: string | null;
  inputPrice: string; outputPrice: string; capabilities: string[]; eligiblePlans: string[];
  paygOnly: boolean; enabled: boolean; routingWeight: number;
};

export default function ModelsClient() {
  const [models, setModels] = useState<Model[]>([]);
  const [keys, setKeys] = useState<Array<{ id: string; provider: string; label: string; disabledAt: string | null }>>([]);
  const [plans, setPlans] = useState<Array<{ code: string; name: string; monthlyPriceUsd: string; includedAllowanceUsd: string; features: string[]; active: boolean }>>([]);
  const [key, setKey] = useState({ provider: "", label: "", apiKey: "" });
  const [message, setMessage] = useState("");
  const [connectors, setConnectors] = useState<Array<{ id: string; label: string; enabled: boolean; meteringMode: string }>>([]);
  const [base44, setBase44] = useState({ label: "Base44 Workspace", endpoint: "", workspaceId: "", credential: "", model: "", meteringMode: "unverified" });
  async function load() {
    const response = await fetch("/api/admin/models");
    const data = await response.json();
    setModels(data.models ?? []); setKeys(data.keys ?? []); setPlans(data.plans ?? []); setConnectors(data.connectors ?? []);
  }
  useEffect(() => { void load(); }, []);
  async function post(body: unknown) {
    const response = await fetch("/api/admin/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json(); setMessage(response.ok ? "Configuration saved." : data.error);
    if (response.ok) await load();
  }
  return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / MODEL CONTROL</span><h1>Provider vault + router</h1></div><a href="/admin">Team provisioning →</a></header>
    <section className="admin-grid">
      <form className="intel-panel" onSubmit={(e) => { e.preventDefault(); void post({ action: "providerKey", ...key }); setKey({ ...key, apiKey: "" }); }}>
        <span className="eyebrow">ENCRYPTED PLATFORM KEY</span><p>Keys are encrypted before storage and are never returned to this screen.</p>
        <label>Provider<input required value={key.provider} onChange={(e) => setKey({ ...key, provider: e.target.value })} /></label>
        <label>Label<input required value={key.label} onChange={(e) => setKey({ ...key, label: e.target.value })} /></label>
        <label>API key<input required type="password" autoComplete="off" value={key.apiKey} onChange={(e) => setKey({ ...key, apiKey: e.target.value })} /></label>
        <button className="primary-action">Encrypt and save key</button>{message && <p className="auth-message">{message}</p>}
        {keys.map((item) => <article className="admin-org" key={item.id}><b>KEY</b><div><strong>{item.label}</strong><small>{item.provider} · {item.disabledAt ? "disabled" : "active"}</small>{!item.disabledAt && <div><button type="button" onClick={() => void post({ action:"testKey",id:item.id })}>Test</button><button type="button" onClick={() => confirm(`Disable ${item.label}? Existing managed routes may stop.`) && void post({ action:"disableKey",id:item.id })}>Disable</button></div>}</div></article>)}
      </form>
      <section className="model-list">{models.map((model, index) => <form className="intel-panel model-config" key={model.id} onSubmit={(e) => { e.preventDefault(); void post({ action: "model", ...model }); }}>
        <div><span className="eyebrow">{model.paygOnly ? "PAYG ONLY" : "PLAN ROUTABLE"}</span><h2>{model.displayName}</h2></div>
        <label>Provider<input value={model.provider} onChange={(e) => setModels(models.map((m, i) => i === index ? { ...m, provider: e.target.value } : m))} /></label>
        <label>Configured provider model ID<input placeholder="Required to enable" value={model.providerModelId ?? ""} onChange={(e) => setModels(models.map((m, i) => i === index ? { ...m, providerModelId: e.target.value } : m))} /></label>
        <div className="model-prices"><label>Input $ / 1M<input type="number" step="0.000001" value={model.inputPrice} onChange={(e) => setModels(models.map((m, i) => i === index ? { ...m, inputPrice: e.target.value } : m))} /></label><label>Output $ / 1M<input type="number" step="0.000001" value={model.outputPrice} onChange={(e) => setModels(models.map((m, i) => i === index ? { ...m, outputPrice: e.target.value } : m))} /></label></div>
        <label>Capabilities<input value={model.capabilities.join(",")} onChange={(e) => setModels(models.map((m, i) => i === index ? { ...m, capabilities: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) } : m))} /></label>
        <label>Eligible plan codes<input value={model.eligiblePlans.join(",")} onChange={(e) => setModels(models.map((m, i) => i === index ? { ...m, eligiblePlans: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) } : m))} /></label>
        <label className="check-field"><input type="checkbox" checked={model.enabled} onChange={(e) => setModels(models.map((m, i) => i === index ? { ...m, enabled: e.target.checked } : m))} /> Enabled</label>
        <button className="primary-action">Save model routing</button>
      </form>)}</section>
    </section>
    <section className="compare-panel"><span className="eyebrow">PLAN ALLOWANCES / CONFIGURED</span><div className="plan-configs">{plans.map((plan, index) => <form key={plan.code} onSubmit={(e) => { e.preventDefault(); void post({ action:"plan",...plan }); }}><strong>{plan.name} · ${plan.monthlyPriceUsd}/mo</strong><label>Included allowance USD<input type="number" step="0.000001" value={plan.includedAllowanceUsd} onChange={(e) => setPlans(plans.map((p,i) => i === index ? { ...p,includedAllowanceUsd:e.target.value } : p))} /></label><label>Feature labels<input value={plan.features.join(",")} onChange={(e) => setPlans(plans.map((p,i) => i === index ? { ...p,features:e.target.value.split(",").map((v) => v.trim()).filter(Boolean) } : p))} /></label><button>Save allowance</button></form>)}</div></section>
    <section className="compare-panel"><span className="eyebrow">BASE44 WORKSPACE CONNECTOR / DISABLED BY DEFAULT</span><div className="admin-grid"><form className="intel-panel" onSubmit={(e) => { e.preventDefault(); void post({ action:"base44",...base44,modelMappings:{ default:base44.model } }); setBase44({ ...base44,credential:"" }); }}><p>No API contract is assumed. Saved connectors remain disabled until a documented endpoint and connector-reported token metering are validated.</p><label>Label<input value={base44.label} onChange={(e) => setBase44({ ...base44,label:e.target.value })} /></label><label>Documented HTTPS endpoint<input type="url" value={base44.endpoint} onChange={(e) => setBase44({ ...base44,endpoint:e.target.value })} /></label><label>Workspace ID<input value={base44.workspaceId} onChange={(e) => setBase44({ ...base44,workspaceId:e.target.value })} /></label><label>Credential<input type="password" autoComplete="off" value={base44.credential} onChange={(e) => setBase44({ ...base44,credential:e.target.value })} /></label><label>Configured model mapping<input value={base44.model} onChange={(e) => setBase44({ ...base44,model:e.target.value })} /></label><button className="primary-action">Encrypt disabled connector</button></form><section className="intel-panel">{connectors.map((item) => <article className="admin-org" key={item.id}><b>BASE44</b><div><strong>{item.label}</strong><small>{item.enabled ? "enabled" : "disabled"} · metering {item.meteringMode}</small></div></article>)}</section></div></section>
  </main>;
}
