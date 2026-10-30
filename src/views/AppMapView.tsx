import React, { useMemo, useState } from "react";
import { Route, Search, Share2, RotateCcw, ArrowRight } from "lucide-react";
import { useApp, canOpenView } from "../context/AppContext";
import {
  LANE_TITLES,
  MAP_NODES,
  MAP_EDGES,
  JOURNEY_STEPS,
  downstream,
  findButton,
  type MapKind,
} from "./appMapData";
import { layoutMap, LANE_STRIP } from "./appMapLayout";

/** App color token for each kind of box, so the map follows the light and dark themes. */
const KIND_COLOR: Record<MapKind, string> = {
  security: "var(--danger)",
  shell: "var(--primary)",
  clinical: "var(--success)",
  admin: "var(--warning)",
  data: "var(--text-main)",
  outside: "var(--text-muted)",
};

const KIND_LABEL: Record<MapKind, string> = {
  security: "Sign-in and security",
  shell: "App frame",
  clinical: "Clinical screens",
  admin: "Admin",
  data: "Stored data",
  outside: "Outside the app",
};

/** Seconds between one step of a lit path and the next. */
const STEP_DELAY = 0.14;

const byId = Object.fromEntries(MAP_NODES.map((n) => [n.id, n]));
const LAYOUT = layoutMap(MAP_NODES, MAP_EDGES);

export const AppMapView: React.FC = () => {
  const { session, setView } = useApp();
  const [selected, setSelected] = useState("patients");
  const [journey, setJourney] = useState(false);
  const [reach, setReach] = useState(true);
  const [query, setQuery] = useState("");

  const hits = useMemo(() => new Set(findButton(query)), [query]);

  /** Lit boxes, and lit edges with the step at which each one draws in. */
  const lit = useMemo(() => {
    const nodes = new Set<string>();
    const edges = new Map<number, number>();
    if (journey) {
      let step = 0;
      MAP_EDGES.forEach((e, i) => {
        if (!e.journey) return;
        edges.set(i, step++);
        nodes.add(e.from);
        nodes.add(e.to);
      });
      return { nodes, edges };
    }
    if (reach) return downstream(selected);
    nodes.add(selected);
    MAP_EDGES.forEach((e, i) => {
      if (e.from !== selected && e.to !== selected) return;
      edges.set(i, 0);
      nodes.add(e.from);
      nodes.add(e.to);
    });
    return { nodes, edges };
  }, [journey, reach, selected]);

  /** Changes on every new selection, so the lit paths remount and draw in again. */
  const runKey = `${journey ? "journey" : selected}-${reach}`;
  const dimming = lit.nodes.size > 0 || hits.size > 0;
  const node = byId[selected];
  const q = query.trim().toLowerCase();
  const litColor = journey ? "var(--success)" : "var(--primary)";

  const select = (id: string) => {
    setSelected(id);
    setJourney(false);
  };

  const onSearch = (value: string) => {
    setQuery(value);
    const first = findButton(value)[0];
    if (first) select(first);
  };

  const reset = () => {
    setSelected("patients");
    setJourney(false);
    setReach(true);
    setQuery("");
  };

  const toggleStyle = (on: boolean): React.CSSProperties => ({
    fontSize: "13px",
    gap: "8px",
    ...(on ? { borderColor: "var(--primary)", color: "var(--primary)", background: "var(--primary-light)" } : {}),
  });

  return (
    <div style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text-main)" }}>App Map</h1>
        <p style={{ fontSize: "14px", color: "var(--text-muted)", marginTop: "4px", maxWidth: "78ch" }}>
          Each box is a screen or a place data is kept. Lines show where a button takes you or where a save sends data.
          Click a box to see every button on it and what the button does.
        </p>
      </div>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="glass-btn glass-btn-secondary" aria-pressed={journey} onClick={() => setJourney(!journey)} style={toggleStyle(journey)}>
          <Route size={16} aria-hidden="true" /> Trace patient journey
        </button>
        <button type="button" className="glass-btn glass-btn-secondary" aria-pressed={reach} onClick={() => setReach(!reach)} style={toggleStyle(reach)}>
          <Share2 size={16} aria-hidden="true" /> Show downstream reach
        </button>
        <div style={{ position: "relative", flex: "1 1 260px", maxWidth: "360px" }}>
          <Search size={16} aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-subtle)" }} />
          <input
            id="app-map-search"
            className="glass-input"
            type="search"
            aria-label="Find a button by name"
            placeholder="Find a button, e.g. Restore"
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            style={{ width: "100%", paddingLeft: 36 }}
          />
        </div>
        <button type="button" className="glass-btn glass-btn-secondary" onClick={reset} style={{ fontSize: "13px", gap: "8px" }}>
          <RotateCcw size={16} aria-hidden="true" /> Reset view
        </button>
      </div>

      <div aria-label="Legend" style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        {(Object.keys(KIND_COLOR) as MapKind[]).map((k) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-muted)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, border: `2px ${k === "outside" ? "dashed" : "solid"} ${KIND_COLOR[k]}` }} />
            {KIND_LABEL[k]}
          </span>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(300px, 380px)", gap: "20px", alignItems: "start" }}>
        <div className="glass-card" style={{ overflowX: "auto", minWidth: 0, padding: "8px" }}>
          <svg
            viewBox={`0 0 ${LAYOUT.width} ${LAYOUT.height}`}
            role="img"
            aria-label="Flowchart of OR Station screens, buttons and data flow"
            style={{ display: "block", width: "100%", minWidth: "980px", height: "auto", fontFamily: "var(--font-sans)" }}
          >
            <defs>
              <marker id="app-map-arrow" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" fill="var(--text-subtle)" />
              </marker>
              <marker id="app-map-arrow-lit" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" fill={litColor} />
              </marker>
            </defs>

            {LAYOUT.lanes.map((l) => (
              <g key={l.row}>
                <rect x={LANE_STRIP.w + 4} y={l.y} width={LAYOUT.width - LANE_STRIP.w - 12} height={l.h} rx={12} fill="var(--bg-card-active)" fillOpacity={0.35} stroke="var(--border-subtle)" strokeDasharray="3 5" />
                <text
                  x={LANE_STRIP.x + LANE_STRIP.w / 2}
                  y={l.y + l.h / 2}
                  transform={`rotate(-90 ${LANE_STRIP.x + LANE_STRIP.w / 2} ${l.y + l.h / 2})`}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="var(--text-subtle)"
                  fontSize={10}
                  fontWeight={700}
                  letterSpacing="0.12em"
                >
                  {LANE_TITLES[l.row]}
                </text>
              </g>
            ))}

            {/* Every connection, faint. */}
            {LAYOUT.routes.map((r, i) => (
              <path
                key={`base-${i}`}
                d={r.d}
                fill="none"
                stroke="var(--text-subtle)"
                strokeWidth={1.2}
                strokeLinejoin="round"
                markerEnd="url(#app-map-arrow)"
                style={{ opacity: dimming ? 0.18 : 0.6, transition: "opacity 0.15s ease" }}
              />
            ))}

            {/* Lit connections: draw in step by step, then flow toward the target. */}
            <g key={runKey}>
              {[...lit.edges].map(([i, step]) => {
                const delay = step * STEP_DELAY;
                return (
                  <g key={`lit-${i}`}>
                    <path
                      className="map-edge-draw"
                      d={LAYOUT.routes[i].d}
                      pathLength={1}
                      fill="none"
                      stroke={litColor}
                      strokeOpacity={0.35}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      style={{ animationDelay: `${delay}s` }}
                    />
                    <path
                      className="map-edge-flow"
                      d={LAYOUT.routes[i].d}
                      fill="none"
                      stroke={litColor}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      markerEnd="url(#app-map-arrow-lit)"
                      style={{ animationDelay: `${delay + 0.45}s, ${delay + 0.45}s` }}
                    />
                  </g>
                );
              })}
            </g>

            {MAP_NODES.map((n) => {
              const box = LAYOUT.boxes[n.id];
              const color = KIND_COLOR[n.kind];
              const isSel = n.id === selected && !journey;
              const isHit = hits.has(n.id);
              const on = lit.nodes.has(n.id) || isHit;
              const border = isHit ? "var(--warning)" : color;
              return (
                <foreignObject
                  key={n.id}
                  x={box.x}
                  y={box.y}
                  width={box.w}
                  height={box.h}
                  style={{ overflow: "hidden", opacity: dimming && !on ? 0.35 : 1, transition: "opacity 0.15s ease" }}
                >
                  <button
                    type="button"
                    aria-pressed={n.id === selected}
                    aria-label={`${n.title}: show its buttons`}
                    title={`${n.title}: ${n.sub}`}
                    onClick={() => select(n.id)}
                    style={{
                      boxSizing: "border-box",
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      gap: "2px",
                      padding: "6px 10px 6px 14px",
                      background: "var(--bg-card-active)",
                      border: `${isSel || isHit ? 2 : 1.4}px ${n.kind === "outside" ? "dashed" : "solid"} ${border}`,
                      boxShadow: `inset 4px 0 0 ${color}${isSel ? ", var(--shadow-md)" : ""}`,
                      borderRadius: "10px",
                      textAlign: "left",
                      cursor: "pointer",
                      overflow: "hidden",
                      font: "inherit",
                    }}
                  >
                    <span style={{ display: "block", width: "100%", fontSize: "12.5px", fontWeight: 700, color: "var(--text-main)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {n.title}
                    </span>
                    <span
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        width: "100%",
                        fontSize: "10.5px",
                        lineHeight: 1.3,
                        color: "var(--text-muted)",
                        overflow: "hidden",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {n.sub}
                    </span>
                  </button>
                </foreignObject>
              );
            })}
          </svg>
        </div>

        <aside className="glass-card" aria-live="polite" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px", minWidth: 0, maxHeight: "calc(100vh - 160px)", overflowY: "auto" }}>
          {journey ? (
            <>
              <div style={sectionLabel}>Patient journey</div>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-main)" }}>Registration to completed case</h2>
              <ol style={listStyle}>
                {JOURNEY_STEPS.map(([step, what]) => (
                  <li key={step} style={rowStyle(false)}>
                    <b style={{ color: "var(--text-main)", fontWeight: 600 }}>{step}</b>
                    <span style={{ color: "var(--text-muted)" }}>{what}</span>
                  </li>
                ))}
              </ol>
              <p style={noteStyle}>Postpone, Cancel case and Move stage on the Pre-OR checklist can step a case out of this path. Each needs a reason.</p>
            </>
          ) : (
            <>
              <div>
                <span className="badge" style={{ color: KIND_COLOR[node.kind], borderColor: KIND_COLOR[node.kind], fontSize: "11px" }}>
                  {KIND_LABEL[node.kind]}
                </span>
              </div>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-main)" }}>{node.title}</h2>
              <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>{node.about}</p>
              {node.view && canOpenView(session, node.view) && (
                <button type="button" className="glass-btn glass-btn-primary" onClick={() => setView(node.view!)} style={{ alignSelf: "flex-start", fontSize: "13px", gap: "8px" }}>
                  Open {node.title} <ArrowRight size={14} aria-hidden="true" />
                </button>
              )}
              <div style={sectionLabel}>Buttons and what they do</div>
              <ul style={listStyle}>
                {node.buttons.map(([label, what]) => {
                  const hit = !!q && `${label} ${what}`.toLowerCase().includes(q);
                  return (
                    <li key={label} style={rowStyle(hit)}>
                      <b style={{ color: hit ? "var(--warning)" : "var(--text-main)", fontWeight: 600 }}>{label}</b>
                      <span style={{ color: "var(--text-muted)" }}>{what}</span>
                    </li>
                  );
                })}
              </ul>
              <Links title="Leads to" ids={MAP_EDGES.filter((e) => e.from === node.id).map((e) => [e.to, e.label] as [string, string])} onPick={select} />
              <Links title="Reached from" ids={MAP_EDGES.filter((e) => e.to === node.id).map((e) => [e.from, e.label] as [string, string])} onPick={select} />
              {q && hits.size > 1 && (
                <Links title={`"${query.trim()}" also on`} ids={[...hits].filter((id) => id !== node.id).map((id) => [id, ""] as [string, string])} onPick={select} />
              )}
              <p style={noteStyle}>The buttons you see depend on your role. A screen your role cannot edit opens read-only.</p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
};

const Links: React.FC<{ title: string; ids: [string, string][]; onPick: (id: string) => void }> = ({ title, ids, onPick }) => {
  if (ids.length === 0) return null;
  return (
    <>
      <div style={sectionLabel}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {ids.map(([id, label]) => (
          <button key={`${id}-${label}`} type="button" className="glass-btn glass-btn-secondary" onClick={() => onPick(id)} style={{ fontSize: "12px", padding: "4px 10px", borderRadius: "999px" }}>
            {byId[id].title}{label ? ` · ${label}` : ""}
          </button>
        ))}
      </div>
    </>
  );
};

const sectionLabel: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-subtle)",
};

const listStyle: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "6px" };

const rowStyle = (hit: boolean): React.CSSProperties => ({
  display: "grid",
  gridTemplateColumns: "minmax(0, 10rem) minmax(0, 1fr)",
  gap: "10px",
  padding: "8px 10px",
  fontSize: "12.5px",
  border: `1px solid ${hit ? "var(--warning)" : "var(--border-glass)"}`,
  borderRadius: "var(--radius-sm)",
  background: hit ? "var(--warning-light)" : "transparent",
});

const noteStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--text-subtle)",
  borderTop: "1px solid var(--border-glass)",
  paddingTop: "10px",
};
