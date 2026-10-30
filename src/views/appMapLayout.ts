import type { MapEdge, MapNode } from "./appMapData";

/**
 * Grid layout and orthogonal edge routing for the App Map.
 *
 * Boxes sit on a fixed grid. Lines never cross a box: they leave a box from a port on its
 * edge, run along the free channel between two rows or the free gutter between two
 * columns, and enter the target box from a port on its edge. Each channel and gutter is
 * split into tracks so that no two lines share a segment.
 */

export const BOX_W = 150;
export const BOX_H = 58;
const PITCH_X = 180;
const PITCH_Y = 164;
const ORIGIN_X = 56;
const ORIGIN_Y = 36;
/** Space above each row for the lane band and below it before the channel starts. */
const BAND_TOP = 26;
const BAND_BOTTOM = 10;
const CORNER = 6;

export interface Box { id: string; x: number; y: number; w: number; h: number }
export interface Lane { row: number; y: number; h: number }
export interface Route { d: string; points: [number, number][] }
export interface MapLayout { boxes: Record<string, Box>; routes: Route[]; lanes: Lane[]; width: number; height: number }

type Side = "top" | "bottom" | "left" | "right";
type Hop =
  | { kind: "side" }
  | { kind: "loop"; channel: number }
  | { kind: "near"; channel: number }
  | { kind: "far"; from: number; to: number; gutter: number };

const colX = (c: number) => ORIGIN_X + c * PITCH_X;
const rowY = (r: number) => ORIGIN_Y + r * PITCH_Y;
const gutterX = (g: number) => ORIGIN_X + g * PITCH_X - (PITCH_X - BOX_W) / 2;

/** Channel k is the free band above row k. */
function channelRange(k: number, rows: number): [number, number] {
  const top = rowY(k - 1) + BOX_H + BAND_BOTTOM;
  const bottom = k >= rows ? top + 50 : rowY(k) - BAND_TOP;
  return [top + 4, bottom - 4];
}

/** Give overlapping intervals different tracks; returns the track of each interval and the track count. */
function assignTracks(items: { lo: number; hi: number }[]): { track: number[]; count: number } {
  const order = items.map((_, i) => i).sort((a, b) => items[a].lo - items[b].lo);
  const ends: number[] = [];
  const track = new Array<number>(items.length);
  for (const i of order) {
    let t = ends.findIndex((end) => end < items[i].lo - 3);
    if (t === -1) { t = ends.length; ends.push(0); }
    ends[t] = items[i].hi;
    track[i] = t;
  }
  return { track, count: ends.length };
}

function roundedPath(points: [number, number][]): string {
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    const r = Math.min(CORNER, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    const inX = x - Math.sign(x - px) * r;
    const inY = y - Math.sign(y - py) * r;
    const outX = x + Math.sign(nx - x) * r;
    const outY = y + Math.sign(ny - y) * r;
    d += ` L${inX},${inY} Q${x},${y} ${outX},${outY}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last[0]},${last[1]}`;
}

/** Drop points that do not turn, so every segment in the result is a real straight run. */
function simplify(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    const before = out[out.length - 2];
    if (before && prev && ((before[0] === prev[0] && prev[0] === p[0]) || (before[1] === prev[1] && prev[1] === p[1]))) out.pop();
    out.push(p);
  }
  return out;
}

export function layoutMap(nodes: MapNode[], edges: MapEdge[]): MapLayout {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const rows = Math.max(...nodes.map((n) => n.row)) + 1;
  const cols = Math.max(...nodes.map((n) => n.col)) + 1;
  const boxes: Record<string, Box> = Object.fromEntries(
    nodes.map((n) => [n.id, { id: n.id, x: colX(n.col), y: rowY(n.row), w: BOX_W, h: BOX_H }]),
  );

  // 1. Decide how each edge travels and which box sides it uses.
  const plan = edges.map((e) => {
    const a = byId[e.from];
    const b = byId[e.to];
    let hop: Hop;
    let sides: [Side, Side];
    if (a.row === b.row && Math.abs(a.col - b.col) === 1) {
      hop = { kind: "side" };
      sides = b.col > a.col ? ["right", "left"] : ["left", "right"];
    } else if (a.row === b.row) {
      hop = { kind: "loop", channel: a.row + 1 };
      sides = ["bottom", "bottom"];
    } else if (Math.abs(a.row - b.row) === 1) {
      const down = b.row > a.row;
      hop = { kind: "near", channel: down ? b.row : a.row };
      sides = down ? ["bottom", "top"] : ["top", "bottom"];
    } else {
      const down = b.row > a.row;
      // Pass the rows in between through the gutter beside the target that is nearer the source.
      const sourceX = colX(a.col) + BOX_W / 2;
      const gutter = [b.col, b.col + 1].sort((g, h) => Math.abs(gutterX(g) - sourceX) - Math.abs(gutterX(h) - sourceX))[0];
      hop = down
        ? { kind: "far", from: a.row + 1, to: b.row, gutter }
        : { kind: "far", from: a.row, to: b.row + 1, gutter };
      sides = down ? ["bottom", "top"] : ["top", "bottom"];
    }
    return { e, a, b, hop, sides };
  });

  // 2. Spread the ports along each box side. Top ports use the left half and bottom ports the
  //    right half of a box, so a line leaving one row never lines up with one entering the next.
  const ports = new Map<string, [number, number]>();
  const groups = new Map<string, { key: string; other: MapNode }[]>();
  plan.forEach((p, i) => {
    ([0, 1] as const).forEach((end) => {
      const own = end === 0 ? p.a : p.b;
      const other = end === 0 ? p.b : p.a;
      const g = `${own.id}:${p.sides[end]}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push({ key: `${i}:${end}`, other });
    });
  });
  for (const [g, list] of groups) {
    const [id, side] = g.split(":") as [string, Side];
    const box = boxes[id];
    list.sort((u, v) => u.other.col - v.other.col || u.other.row - v.other.row);
    list.forEach((item, k) => {
      const f = (k + 1) / (list.length + 1);
      if (side === "top") ports.set(item.key, [box.x + box.w * (0.08 + 0.42 * f), box.y]);
      else if (side === "bottom") ports.set(item.key, [box.x + box.w * (0.5 + 0.42 * f), box.y + box.h]);
      else if (side === "left") ports.set(item.key, [box.x, box.y + box.h * f]);
      else ports.set(item.key, [box.x + box.w, box.y + box.h * f]);
    });
  }

  // 3. Collect the horizontal runs in each channel and the vertical runs in each gutter.
  const channelRuns = new Map<number, { edge: number; lo: number; hi: number; leg: number }[]>();
  const gutterRuns = new Map<number, { edge: number; lo: number; hi: number }[]>();
  const addChannel = (k: number, edge: number, x1: number, x2: number, leg: number) => {
    if (!channelRuns.has(k)) channelRuns.set(k, []);
    channelRuns.get(k)!.push({ edge, lo: Math.min(x1, x2), hi: Math.max(x1, x2), leg });
  };
  plan.forEach((p, i) => {
    const [ax] = ports.get(`${i}:0`)!;
    const [bx] = ports.get(`${i}:1`)!;
    if (p.hop.kind === "loop" || p.hop.kind === "near") addChannel(p.hop.channel, i, ax, bx, 0);
    if (p.hop.kind === "far") {
      const gx = gutterX(p.hop.gutter);
      addChannel(p.hop.from, i, ax, gx, 0);
      addChannel(p.hop.to, i, gx, bx, 1);
      // The vertical run can sit anywhere inside both channels, so reserve the whole span.
      const r1 = channelRange(p.hop.from, rows);
      const r2 = channelRange(p.hop.to, rows);
      if (!gutterRuns.has(p.hop.gutter)) gutterRuns.set(p.hop.gutter, []);
      gutterRuns.get(p.hop.gutter)!.push({ edge: i, lo: Math.min(r1[0], r2[0]), hi: Math.max(r1[1], r2[1]) });
    }
  });

  const channelY = new Map<string, number>();
  for (const [k, runs] of channelRuns) {
    const { track, count } = assignTracks(runs);
    const [top, bottom] = channelRange(k, rows);
    runs.forEach((r, j) => channelY.set(`${r.edge}:${r.leg}`, top + ((track[j] + 1) * (bottom - top)) / (count + 1)));
  }
  const gutterOffset = new Map<number, number>();
  for (const [, runs] of gutterRuns) {
    const { track, count } = assignTracks(runs);
    runs.forEach((r, j) => gutterOffset.set(r.edge, (track[j] - (count - 1) / 2) * 6));
  }

  // 4. Build each route.
  const routes = plan.map((p, i): Route => {
    const a = ports.get(`${i}:0`)!;
    const b = ports.get(`${i}:1`)!;
    let pts: [number, number][];
    if (p.hop.kind === "side") {
      const y = (a[1] + b[1]) / 2;
      pts = [[a[0], y], [b[0], y]];
    } else if (p.hop.kind === "loop" || p.hop.kind === "near") {
      const y = channelY.get(`${i}:0`)!;
      pts = [a, [a[0], y], [b[0], y], b];
    } else {
      const gx = gutterX(p.hop.gutter) + (gutterOffset.get(i) ?? 0);
      const y1 = channelY.get(`${i}:0`)!;
      const y2 = channelY.get(`${i}:1`)!;
      pts = [a, [a[0], y1], [gx, y1], [gx, y2], [b[0], y2], b];
    }
    const points = simplify(pts);
    return { d: roundedPath(points), points };
  });

  const lanes: Lane[] = Array.from({ length: rows }, (_, r) => ({ row: r, y: rowY(r) - BAND_TOP, h: BAND_TOP + BOX_H + BAND_BOTTOM }));
  const width = colX(cols - 1) + BOX_W + 40;
  const height = channelRange(rows, rows)[1] + 14;
  return { boxes, routes, lanes, width, height };
}

/** Left edge of the lane title strip; lines never enter it. */
export const LANE_STRIP = { x: 0, w: 34 };
