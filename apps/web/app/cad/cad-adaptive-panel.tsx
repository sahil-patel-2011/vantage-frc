"use client";

import { useEffect, useState } from "react";

export type CadAdaptiveView = {
  teamProfile: {
    defaultPlatform: "onshape" | "fusion360" | "mock";
    preferredUnits: "mm" | "in";
    manufacturingProcesses: string[];
    preferredMaterials: string[];
    standardComponents: string[];
    designRules: string[];
  };
  userPreferences: {
    responseStyle: "concise" | "teaching" | "expert";
    explanationDepth: "minimal" | "standard" | "deep";
    preferredUnits: "team" | "mm" | "in";
    preferredPlatform: "onshape" | "fusion360" | "mock" | null;
    customInstructions: string;
  };
  canManageTeamProfile: boolean;
  profileConfigured: boolean;
};

function lines(values: string[]) {
  return values.join("\n");
}

export function CadAdaptivePanel({
  value,
  busy,
  onSave,
}: {
  value: CadAdaptiveView;
  busy: boolean;
  onSave: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
}) {
  const [mine, setMine] = useState(value.userPreferences);
  const [team, setTeam] = useState({
    ...value.teamProfile,
    manufacturingProcesses: lines(value.teamProfile.manufacturingProcesses),
    preferredMaterials: lines(value.teamProfile.preferredMaterials),
    standardComponents: lines(value.teamProfile.standardComponents),
    designRules: lines(value.teamProfile.designRules),
  });
  useEffect(() => setMine(value.userPreferences), [value.userPreferences]);
  useEffect(
    () =>
      setTeam({
        ...value.teamProfile,
        manufacturingProcesses: lines(value.teamProfile.manufacturingProcesses),
        preferredMaterials: lines(value.teamProfile.preferredMaterials),
        standardComponents: lines(value.teamProfile.standardComponents),
        designRules: lines(value.teamProfile.designRules),
      }),
    [value.teamProfile],
  );

  const contextCount =
    value.teamProfile.manufacturingProcesses.length +
    value.teamProfile.preferredMaterials.length +
    value.teamProfile.standardComponents.length +
    value.teamProfile.designRules.length;

  return (
    <details className="app-card cad-adaptive-panel">
      <summary>
        <div>
          <span className="eyebrow">ADAPTIVE CAD COPILOT</span>
          <strong>{value.profileConfigured ? `${contextCount} team standards loaded` : "Set team build standards"}</strong>
        </div>
        <div className="cad-adaptive-badges">
          <span className="app-badge good">Private response profile</span>
          <span className="app-badge setup">Team manufacturing context</span>
        </div>
      </summary>
      <div className="cad-adaptive-grid">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSave("save-user-preferences", mine);
          }}
        >
          <header>
            <div><span className="eyebrow">ONLY YOU</span><h3>My copilot</h3></div>
            <span className="app-badge good">Private</span>
          </header>
          <p className="app-muted">Controls how CAD explanations feel for you. Teammates keep their own settings.</p>
          <div className="cad-adaptive-fields">
            <label>Response style<select value={mine.responseStyle} onChange={(e) => setMine({ ...mine, responseStyle: e.target.value as typeof mine.responseStyle })}><option value="concise">Concise</option><option value="teaching">Teaching</option><option value="expert">Expert</option></select></label>
            <label>Explanation depth<select value={mine.explanationDepth} onChange={(e) => setMine({ ...mine, explanationDepth: e.target.value as typeof mine.explanationDepth })}><option value="minimal">Minimal</option><option value="standard">Standard</option><option value="deep">Deep</option></select></label>
            <label>Units<select value={mine.preferredUnits} onChange={(e) => setMine({ ...mine, preferredUnits: e.target.value as typeof mine.preferredUnits })}><option value="team">Use team standard</option><option value="mm">Millimeters</option><option value="in">Inches</option></select></label>
            <label>Preferred path<select value={mine.preferredPlatform ?? "team"} onChange={(e) => setMine({ ...mine, preferredPlatform: e.target.value === "team" ? null : e.target.value as NonNullable<typeof mine.preferredPlatform> })}><option value="team">Use team default</option><option value="onshape">Onshape hosted</option><option value="fusion360">Fusion local</option><option value="mock">Mock/demo</option></select></label>
          </div>
          <label>How should the copilot respond to you?<textarea rows={3} maxLength={2000} value={mine.customInstructions} onChange={(e) => setMine({ ...mine, customInstructions: e.target.value })} placeholder="Example: explain mechanisms with FRC examples and put the next approval first." /></label>
          <button className="app-button" disabled={busy}>Save my private preferences</button>
        </form>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSave("save-team-profile", team);
          }}
        >
          <header>
            <div><span className="eyebrow">WHOLE TEAM</span><h3>Manufacturing brain</h3></div>
            <span className="app-badge setup">Shared</span>
          </header>
          <p className="app-muted">Grounds briefs and plans in what your team can actually build. One item per line.</p>
          <div className="cad-adaptive-fields">
            <label>Default CAD path<select disabled={!value.canManageTeamProfile} value={team.defaultPlatform} onChange={(e) => setTeam({ ...team, defaultPlatform: e.target.value as typeof team.defaultPlatform })}><option value="onshape">Onshape hosted</option><option value="fusion360">Fusion local</option><option value="mock">Mock/demo</option></select></label>
            <label>Team units<select disabled={!value.canManageTeamProfile} value={team.preferredUnits} onChange={(e) => setTeam({ ...team, preferredUnits: e.target.value as typeof team.preferredUnits })}><option value="mm">Millimeters</option><option value="in">Inches</option></select></label>
          </div>
          <div className="cad-adaptive-fields wide">
            <label>Processes<textarea disabled={!value.canManageTeamProfile} rows={3} value={team.manufacturingProcesses} onChange={(e) => setTeam({ ...team, manufacturingProcesses: e.target.value })} placeholder="CNC router\nFDM printing\nManual mill" /></label>
            <label>Preferred materials<textarea disabled={!value.canManageTeamProfile} rows={3} value={team.preferredMaterials} onChange={(e) => setTeam({ ...team, preferredMaterials: e.target.value })} placeholder="6061 aluminum\nPolycarbonate" /></label>
            <label>Standard components<textarea disabled={!value.canManageTeamProfile} rows={3} value={team.standardComponents} onChange={(e) => setTeam({ ...team, standardComponents: e.target.value })} placeholder="REV MAXTube\n1/2 in hex shaft" /></label>
            <label>Design rules<textarea disabled={!value.canManageTeamProfile} rows={3} value={team.designRules} onChange={(e) => setTeam({ ...team, designRules: e.target.value })} placeholder="Tool access on every fastener\nNo unsupported prints in load paths" /></label>
          </div>
          {value.canManageTeamProfile ? <button className="app-button" disabled={busy}>Save team standards</button> : <small className="app-muted">Owner or admin manages shared standards.</small>}
        </form>
      </div>
    </details>
  );
}
