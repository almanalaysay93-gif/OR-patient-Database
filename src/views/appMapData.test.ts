import { describe, it, expect } from "vitest";
import { MAP_NODES, MAP_EDGES, downstream, findButton } from "./appMapData";

describe("App Map data", () => {
  it("connects only boxes that exist", () => {
    const ids = new Set(MAP_NODES.map((n) => n.id));
    expect(ids.size).toBe(MAP_NODES.length);
    for (const e of MAP_EDGES) {
      expect(ids.has(e.from), `${e.from} -> ${e.to}`).toBe(true);
      expect(ids.has(e.to), `${e.from} -> ${e.to}`).toBe(true);
    }
  });

  it("traces the patient journey from Patients to Post-OR", () => {
    const steps = MAP_EDGES.filter((e) => e.journey && e.to !== "db").map((e) => `${e.from}>${e.to}`);
    expect(steps).toEqual(["patients>preor", "preor>schedule", "schedule>intraor", "intraor>postor"]);
  });

  it("reaches the Google Sheet downstream of Pre-OR", () => {
    expect(downstream("preor").nodes.has("sheet")).toBe(true);
    expect(downstream("sheet").nodes.size).toBe(1);
  });

  it("finds a button by name in any case", () => {
    expect(findButton("restore")).toEqual(expect.arrayContaining(["patients", "settings"]));
    expect(findButton("   ")).toEqual([]);
  });
});
