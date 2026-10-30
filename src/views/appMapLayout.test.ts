import { describe, it, expect } from "vitest";
import { MAP_NODES, MAP_EDGES } from "./appMapData";
import { layoutMap, LANE_STRIP } from "./appMapLayout";

const layout = layoutMap(MAP_NODES, MAP_EDGES);
const boxes = Object.values(layout.boxes);

type Seg = { edge: number; x1: number; y1: number; x2: number; y2: number };
const segments: Seg[] = layout.routes.flatMap((r, edge) =>
  r.points.slice(1).map((p, i) => ({ edge, x1: r.points[i][0], y1: r.points[i][1], x2: p[0], y2: p[1] })),
);
const name = (s: Seg) => `${MAP_EDGES[s.edge].from}->${MAP_EDGES[s.edge].to}`;

describe("App Map layout", () => {
  it("routes every line with straight horizontal and vertical runs", () => {
    for (const s of segments) expect(s.x1 === s.x2 || s.y1 === s.y2, name(s)).toBe(true);
  });

  it("keeps boxes apart and inside the drawing", () => {
    for (const a of boxes) {
      expect(a.x).toBeGreaterThan(LANE_STRIP.x + LANE_STRIP.w);
      expect(a.x + a.w).toBeLessThanOrEqual(layout.width);
      expect(a.y + a.h).toBeLessThanOrEqual(layout.height);
      for (const b of boxes) {
        if (a === b) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
      }
    }
  });

  it("never runs a line through a box", () => {
    for (const s of segments) {
      for (const b of boxes) {
        // Shrink the box by 1px: a line may end on a box edge but not pass inside it.
        const left = b.x + 1, right = b.x + b.w - 1, top = b.y + 1, bottom = b.y + b.h - 1;
        const crosses =
          Math.max(s.x1, s.x2) > left && Math.min(s.x1, s.x2) < right &&
          Math.max(s.y1, s.y2) > top && Math.min(s.y1, s.y2) < bottom;
        expect(crosses, `${name(s)} passes through ${b.id}`).toBe(false);
      }
    }
  });

  it("never lets two lines share a run", () => {
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const a = segments[i], b = segments[j];
        if (a.edge === b.edge) continue;
        const bothVertical = a.x1 === a.x2 && b.x1 === b.x2 && Math.abs(a.x1 - b.x1) < 2;
        const bothHorizontal = a.y1 === a.y2 && b.y1 === b.y2 && Math.abs(a.y1 - b.y1) < 2;
        const overlap = bothVertical
          ? Math.min(Math.max(a.y1, a.y2), Math.max(b.y1, b.y2)) - Math.max(Math.min(a.y1, a.y2), Math.min(b.y1, b.y2))
          : bothHorizontal
            ? Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2)) - Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2))
            : -1;
        expect(overlap > 1, `${name(a)} and ${name(b)} share a run`).toBe(false);
      }
    }
  });

  it("keeps lines out of the lane title strip", () => {
    for (const s of segments) expect(Math.min(s.x1, s.x2), name(s)).toBeGreaterThan(LANE_STRIP.x + LANE_STRIP.w);
  });
});
