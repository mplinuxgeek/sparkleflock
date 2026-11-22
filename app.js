'use strict';
/* Sparkleflock: rhinestone templates from text.
   All lengths are mm with y pointing up. Letter outlines come from opentype.js, offsets and
   boolean operations from clipper-lib, centre lines from a raster skeleton of each glyph. */

const $ = id => document.getElementById(id);
const CL = ClipperLib, SC = 1000; // clipper works in integers: units per mm

// rhinestone sizes: typical stone diameter in mm
const STONES = [
  ['ss4', 'SS4 (1.6 mm)', 1.6], ['ss6', 'SS6 (2.0 mm)', 2.0], ['ss8', 'SS8 (2.4 mm)', 2.4], ['ss10', 'SS10 (2.8 mm)', 2.8],
  ['ss12', 'SS12 (3.1 mm)', 3.1], ['ss16', 'SS16 (3.9 mm)', 3.9], ['ss20', 'SS20 (4.7 mm)', 4.7], ['ss30', 'SS30 (6.4 mm)', 6.4],
  ['ss34', 'SS34 (7.2 mm)', 7.2], ['custom', 'Custom size', 0],
];
const COLOURS = [
  ['crystal', 'Crystal', '#eef4ff'], ['ab', 'Crystal AB', '#cfe3ff'], ['gold', 'Gold', '#e7bf52'], ['hematite', 'Hematite', '#8b909b'],
  ['jet', 'Jet black', '#2a2a31'], ['red', 'Red', '#d3223c'], ['pink', 'Pink', '#f48fb8'], ['fuchsia', 'Fuchsia', '#d6339a'],
  ['blue', 'Blue', '#2c5fd1'], ['aqua', 'Light blue', '#7fd3f0'], ['green', 'Green', '#1f9d55'], ['purple', 'Purple', '#8e4fc9'], ['topaz', 'Topaz', '#f0a030'],
];
const MATS = [
  ['none', 'No mat', 0, 0], ['m12', '12 × 12 in mat (Cricut / Cameo)', 304.8, 304.8], ['m24', '12 × 24 in mat (Cricut / Cameo)', 304.8, 609.6],
  ['p8', '8 × 12 in mat (Portrait / Joy Xtra)', 203.2, 304.8], ['j45', '4.5 × 12 in mat (Cricut Joy)', 114.3, 304.8],
  ['a4', 'A4 sheet', 210, 297], ['letter', 'US Letter sheet', 215.9, 279.4],
];

const DEF = {
  text: 'SPARKLE', font: 'anton', align: 'center', letterSp: 12, wordSp: 0, lineSp: 130,
  units: 'mm', height: 40, stretch: 1, lock: true,
  stone: 'ss10', inner: 'same', custom: 3, allow: 0.3, gap: 0.6, fill: 'auto', inset: 0, bold: 0,
  mat: 'm12', border: false, borderM: 6, expOutline: false, mirror: false, rotate: 0,
  showOutline: true, showGrid: true, colour: 'crystal', view: 'stones',
};
let P = { ...DEF };
let edits = { rm: [], add: [] }; // manual stone edits in layout coordinates

/* ---------- fonts ---------- */
const fonts = new Map(); // id -> opentype font
let customFont = null;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
async function getFont(id) {
  if (id === '__custom') return customFont;
  if (fonts.has(id)) return fonts.get(id);
  if (!window.FONT_DATA?.[id]) await loadScript('fonts/' + id + '.js');
  const bin = atob(window.FONT_DATA[id]), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const f = opentype.parse(buf.buffer);
  fonts.set(id, f); delete window.FONT_DATA[id];
  return f;
}

/* ---------- geometry helpers ---------- */
function flatten(cmds, tol) {
  // opentype path (y down) -> closed contours [[x, y], ...] with y up
  const out = []; let cur = null, x = 0, y = 0;
  const segs = len => Math.min(48, Math.max(2, Math.ceil(len / tol)));
  const d = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const close = () => { if (cur && cur.length > 2) out.push(cur); cur = null; };
  for (const c of cmds) {
    if (c.type === 'M') { close(); cur = [[c.x, -c.y]]; }
    else if (c.type === 'L') cur.push([c.x, -c.y]);
    else if (c.type === 'Q') {
      const n = segs(d(x, y, c.x1, c.y1) + d(c.x1, c.y1, c.x, c.y));
      for (let i = 1; i <= n; i++) { const t = i / n, m = 1 - t; cur.push([m * m * x + 2 * m * t * c.x1 + t * t * c.x, -(m * m * y + 2 * m * t * c.y1 + t * t * c.y)]); }
    } else if (c.type === 'C') {
      const n = segs(d(x, y, c.x1, c.y1) + d(c.x1, c.y1, c.x2, c.y2) + d(c.x2, c.y2, c.x, c.y));
      for (let i = 1; i <= n; i++) {
        const t = i / n, m = 1 - t, a = m * m * m, b = 3 * m * m * t, e = 3 * m * t * t, f = t * t * t;
        cur.push([a * x + b * c.x1 + e * c.x2 + f * c.x, -(a * y + b * c.y1 + e * c.y2 + f * c.y)]);
      }
    } else if (c.type === 'Z') close();
    if (c.x !== undefined) { x = c.x; y = c.y; }
  }
  close();
  return out;
}
const toClip = (contours, sx, sy) => contours.map(c => c.map(([x, y]) => ({ X: Math.round(x * sx * SC), Y: Math.round(y * sy * SC) })));
const toMM = path => path.map(q => [q.X / SC, q.Y / SC]);
function union(paths) {
  const c = new CL.Clipper(), out = [];
  c.AddPaths(paths, CL.PolyType.ptSubject, true);
  c.Execute(CL.ClipType.ctUnion, out, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  return out;
}
function offsetPaths(paths, mm, miter = false) {
  if (!mm) return paths;
  const co = new CL.ClipperOffset(2, 0.01 * SC), out = [];
  co.AddPaths(paths, miter ? CL.JoinType.jtMiter : CL.JoinType.jtRound, CL.EndType.etClosedPolygon);
  co.Execute(out, mm * SC);
  return out;
}
function insidePaths(paths, x, y) {
  const pt = { X: Math.round(x * SC), Y: Math.round(y * SC) }; let n = 0;
  for (const p of paths) if (CL.Clipper.PointInPolygon(pt, p) !== 0) n++;
  return n % 2 === 1;
}
function polyLen(pts, closed) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 1) L += Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]);
  return L;
}
// points at the given arc lengths along a polyline
function pointsAt(pts, closed, ss) {
  const P2 = closed ? [...pts, pts[0]] : pts, out = [];
  let i = 0, acc = 0;
  for (const s of ss) {
    while (i < P2.length - 2) {
      const l = Math.hypot(P2[i + 1][0] - P2[i][0], P2[i + 1][1] - P2[i][1]);
      if (acc + l >= s) break;
      acc += l; i++;
    }
    const a = P2[i], b = P2[Math.min(i + 1, P2.length - 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = Math.min(1, Math.max(0, (s - acc) / l));
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}
function centroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length], k = x0 * y1 - x1 * y0;
    a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
  }
  if (Math.abs(a) < 1e-9) { const n = pts.length; return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]; }
  return [cx / (3 * a), cy / (3 * a)];
}

/* ---------- stone placement ---------- */
// stones are [x, y, priority]; lower priority wins when two are too close
function arcOf(pts, closed) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = closed ? cum.at(-1) + Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) : cum.at(-1);
  return { cum, L };
}
function posAt(pts, cum, L, closed, s) {
  if (closed) s = ((s % L) + L) % L; else s = Math.min(L, Math.max(0, s));
  let lo = 0, hi = cum.length - 1;
  if (s >= cum[hi]) { // closing segment of a loop, or the very end
    const a = pts[hi], b = closed ? pts[0] : pts[hi], l = (closed ? L : cum[hi]) - cum[hi];
    const t = l > 1e-9 ? (s - cum[hi]) / l : 0;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], t = (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
// arc positions of sharp corners (turn of more than ~50° within a stone's length)
function cornersOf(pts, cum, L, closed, win) {
  const cand = [];
  for (let i = 0; i < pts.length; i++) {
    const s = cum[i];
    if (!closed && (s < win * 0.7 || s > L - win * 0.7)) continue;
    const b = posAt(pts, cum, L, closed, s - win), f = posAt(pts, cum, L, closed, s + win), p = pts[i];
    const ux = p[0] - b[0], uy = p[1] - b[1], vx = f[0] - p[0], vy = f[1] - p[1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-9 || lv < 1e-9) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv))));
    if (ang > 0.87) cand.push([s, ang]);
  }
  cand.sort((a, b) => b[1] - a[1]);
  const keep = [];
  const sep = (a, b) => { const d = Math.abs(a - b); return closed ? Math.min(d, L - d) : d; };
  for (const [s] of cand) if (keep.every(k => sep(k, s) >= win * 1.4)) keep.push(s);
  return keep.sort((a, b) => a - b);
}
// stones evenly along a stretch of path, not counting its two ends
// pos(s) gives the point at arc length s, so spacing can be checked in a straight line
// (on curves the straight distance is shorter than the distance along the path)
// reg (optional) makes stretches of nearly the same length take the same number of stones:
// see lengthGroups
const hardMin = G => G.thr - (G.gap ?? 0) * 0.25;
function between(sa, sb, G, pos, reg) {
  const len = sb - sa;
  if (reg?.collect) { reg.collect.push(len); return []; }
  // as many stones as keep the spacing at or under p, but never closer than thr
  const base = reg?.base(len) ?? len;
  let n = Math.max(1, Math.ceil(base / G.p - 0.02));
  const tight = (n, lim) => { let bad = 0, prev = pos(sa); for (let i = 1; i <= n; i++) { const q = pos(sa + i * len / n); if (Math.hypot(q[0] - prev[0], q[1] - prev[1]) < lim * 0.995) bad++; prev = q; } return bad; };
  for (; n > 1; n--) {
    if (base / n < G.thr) continue;
    // one tight pair is a local pinch (the path doubling back in a notch), not a reason to
    // thin out the whole stretch: the cull drops one stone there
    const bad = tight(n, G.thr);
    if (bad === 0 || (bad === 1 && n >= 5)) break;
  }
  // a short stretch can end up with gaps over 20% too wide because one more stone would sit
  // just under the usual minimum. Then the extra stone goes in, down to the hard minimum.
  const hard = hardMin(G);
  // (judged on the stretch's own length: a stretch with room is filled even when a slightly
  // shorter one in its group is not)
  if (len / n > G.p * 1.2 && len / (n + 1) >= hard && tight(n + 1, hard) === 0) n++;
  return Array.from({ length: n - 1 }, (_, i) => sa + (i + 1) * len / n);
}
// stones along a polyline: a stone on every sharp corner, even spacing between corners
// ends: [stone at start, stone at end] for open paths
// Stretches of an outline within 8% of each other in length count as the same length (the
// shortest of the group), so matching parts of a letter - the arms of an E, the two sides of
// a stem - get the same number of stones instead of differing by one when their lengths sit
// either side of a whole number of spacings.
function lengthGroups(lens) {
  const s = [...lens].sort((a, b) => a - b), starts = [];
  for (const l of s) if (!starts.length || l > starts.at(-1) * 1.08) starts.push(l);
  return { base: len => { let b = starts[0] ?? len; for (const v of starts) if (v <= len + 1e-9) b = v; else break; return b; } };
}
// extra: more arc positions to treat as corners (see ladderCorners)
function placeAlong(pts, closed, G, prio, out, ends = [true, true], reg, extra) {
  const { cum, L } = arcOf(pts, closed);
  const pos = s => posAt(pts, cum, L, closed, s);
  const push = (s, pr) => { if (reg?.collect) return; const q = pos(s); out.push([q[0], q[1], pr]); };
  if (closed && L < G.thr * 2.2) { if (!reg?.collect) { const c = centroid(pts); out.push([c[0], c[1], prio - 0.5]); } return; }
  let cs = cornersOf(pts, cum, L, closed, G.p * 0.8);
  if (extra?.length) cs = [...cs, ...extra.map(s => ((s % L) + L) % L)].sort((a, b) => a - b);
  if (closed && !cs.length) {
    // smooth loop: start at the top-left-most point so rings look tidy
    let k = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i][1] > pts[k][1] + 1e-6 || (Math.abs(pts[i][1] - pts[k][1]) < 1e-6 && pts[i][0] < pts[k][0])) k = i;
    let n = Math.max(3, Math.ceil(L / G.p - 0.02));
    const tight = n => { for (let i = 0; i < n; i++) { const a = pos(cum[k] + i * L / n), b = pos(cum[k] + (i + 1) * L / n); if (Math.hypot(b[0] - a[0], b[1] - a[1]) < G.thr * 0.995) return true; } return false; };
    while (n > 3 && (L / n < G.thr || tight(n))) n--;
    for (let i = 0; i < n; i++) push(cum[k] + i * L / n, prio);
    return;
  }
  for (const s of cs) push(s, prio - 0.5);
  // a stretch a little too short for a stone between its two corner stones (the end of a
  // stroke) still gets one, set back from the row just far enough to clear both
  const dip = (sa, sb) => {
    if (!reg?.inside) return;
    const a = pos(sa), b = pos(sb), d = Math.hypot(b[0] - a[0], b[1] - a[1]), hard = hardMin(G);
    if (sb - sa > d * 1.02 || d >= 2 * hard || d < G.r) return;
    const back = Math.sqrt(hard * hard - d * d / 4);
    if (back > G.r * 0.8) return;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, nx = -(b[1] - a[1]) / d, ny = (b[0] - a[0]) / d;
    for (const sg of [1, -1]) {
      const x = mx + nx * back * sg, y = my + ny * back * sg;
      if (reg.inside(mx + nx * (back + G.r * 0.5) * sg, my + ny * (back + G.r * 0.5) * sg)) { out.push([x, y, prio]); return; }
    }
  };
  if (closed) {
    for (let i = 0; i < cs.length; i++) {
      const sa = cs[i], sb = i + 1 < cs.length ? cs[i + 1] : cs[0] + L, mid = between(sa, sb, G, pos, reg);
      for (const s of mid) push(s, prio);
      if (!mid.length && cs.length > 1 && !reg?.collect) dip(sa, sb);
    }
  } else {
    const b = [0, ...cs, L];
    if (ends[0]) push(0, prio - 0.5);
    if (ends[1]) push(L, prio - 0.5);
    for (let i = 0; i + 1 < b.length; i++) for (const s of between(b[i], b[i + 1], G, pos, reg)) push(s, prio);
  }
}
const placeClosed = (pts, G, prio, out, reg, extra) => placeAlong(pts, true, G, prio, out, [true, true], reg, extra);
// Rows on opposite sides of a straight stroke should line up like the rungs of a ladder. A long
// straight stretch on one side (the back of an E) faces several short ones on the other (between
// the arms), each divided evenly on its own, so the two sides drift out of step. Here every
// corner is carried straight across the stroke onto the parallel stretch facing it and becomes a
// corner there too: both sides are then cut into the same lengths and get the same stones.
// Returns, per row, the extra corner positions (arc lengths).
function ladderCorners(rows, G, paths) {
  const hard = hardMin(G);
  // a piece is fine when some whole number of spacings fits it without much squeeze or stretch
  const fits = len => { for (const n of [Math.floor(len / G.p), Math.ceil(len / G.p)]) if (n >= 1 && len / n >= hard && len / n <= G.p * 1.25) return true; return false; };
  const info = rows.map(pts => {
    const { cum, L } = arcOf(pts, true), pos = s => posAt(pts, cum, L, true, s);
    const cs = L < G.thr * 2.2 ? [] : cornersOf(pts, cum, L, true, G.p * 0.8);
    const st = cs.length < 2 ? [] : cs.map((s, i) => {
      const len = (i + 1 < cs.length ? cs[i + 1] : cs[0] + L) - s, a = pos(s), b = pos(s + len);
      const ch = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
      return { s, len, a, straight: ch > len * 0.985, dir: [(b[0] - a[0]) / ch, (b[1] - a[1]) / ch] };
    });
    return { st };
  });
  return info.map((ri, r) => {
    const extra = [];
    ri.st.forEach((T, ti) => {
      if (!T.straight || T.len < 2 * hard) return;
      const cand = [];
      info.forEach((r2, q) => r2.st.forEach((S, si) => {
        if (q === r && (si === ti || si === (ti + 1) % ri.st.length)) return; // T's own ends
        // the corner must belong to a stretch running alongside T
        const prev = r2.st[(si - 1 + r2.st.length) % r2.st.length];
        if (![S, prev].some(e => e.straight && Math.abs(e.dir[0] * T.dir[0] + e.dir[1] * T.dir[1]) > 0.97)) return;
        const vx = S.a[0] - T.a[0], vy = S.a[1] - T.a[1];
        const u = vx * T.dir[0] + vy * T.dir[1], d = Math.abs(vx * T.dir[1] - vy * T.dir[0]);
        if (u < hard || u > T.len - hard || d < G.thr * 0.9 || d > G.p * 3.5) return;
        // straight across the stroke, not across a gap between strokes
        const px = T.a[0] + T.dir[0] * u, py = T.a[1] + T.dir[1] * u;
        for (const f of [0.25, 0.5, 0.75]) if (!insidePaths(paths, S.a[0] + (px - S.a[0]) * f, S.a[1] + (py - S.a[1]) * f)) return;
        cand.push(u);
      }));
      cand.sort((a, b) => a - b);
      const ok = [];
      for (const u of cand) if (fits(u - (ok.at(-1) ?? 0))) ok.push(u);
      while (ok.length && !fits(T.len - ok.at(-1))) ok.pop();
      for (const u of ok) extra.push(T.s + u);
    });
    return extra;
  });
}
// rows of stones following the letter edge, one stone spacing apart.
// Parts of a row too thin to hold stones on both sides (where the row folds back on itself
// in the middle of a stroke) are dropped; the centre line covers them instead.
function ringStones(paths, G, maxRings, out) {
  const open = G.thr * 0.5 + 0.01;
  for (let k = 0; k < maxRings; k++) {
    // square joins keep the corners of the row sharp, so corner stones sit right in the corner
    const off = offsetPaths(paths, -(G.r + G.m + k * G.p), true);
    if (!off.length) break;
    const fat = offsetPaths(offsetPaths(off, -open, true), open, true);
    // first measure every stretch between corners, then place with matching lengths grouped
    const rows = fat.filter(p => p.length > 2).map(toMM), lens = [];
    const extra = ladderCorners(rows, G, paths);
    rows.forEach((r, i) => placeClosed(r, G, 10 + k, out, { collect: lens }, extra[i]));
    const reg = lengthGroups(lens);
    reg.inside = (x, y) => insidePaths(fat, x, y);
    rows.forEach((r, i) => placeClosed(r, G, 10 + k, out, reg, extra[i]));
  }
}
function hexStones(paths, depth, G, out) {
  const region = offsetPaths(paths, -depth);
  if (!region.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of region) for (const q of p) { x0 = Math.min(x0, q.X); x1 = Math.max(x1, q.X); y0 = Math.min(y0, q.Y); y1 = Math.max(y1, q.Y); }
  x0 /= SC; x1 /= SC; y0 /= SC; y1 /= SC;
  const dy = G.p * Math.sqrt(3) / 2;
  for (let j = Math.floor(y0 / dy); j * dy <= y1; j++) {
    const off = (j & 1) ? G.p / 2 : 0;
    for (let i = Math.floor((x0 - off) / G.p); i * G.p + off <= x1; i++) {
      const x = i * G.p + off, y = j * dy;
      if (insidePaths(region, x, y)) out.push([x, y, 200]);
    }
  }
}

/* centre line: rasterise, distance transform, thin to a skeleton, trace it as a graph */
function edt(mask, W, H) {
  const INF = 1e20, n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const g = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = mask[i] ? INF : 0;
  const pass = (len) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); } while (s <= z[k] && --k >= 0);
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + f[p]; }
  };
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = g[y * W + x]; pass(H); for (let y = 0; y < H; y++) g[y * W + x] = d[y]; }
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = g[y * W + x]; pass(W); for (let x = 0; x < W; x++) g[y * W + x] = Math.sqrt(d[x]); }
  return g;
}
function thin(mask, W, H) {
  const m = Uint8Array.from(mask), del = [];
  for (let changed = true; changed;) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!m[i]) continue;
        const p2 = m[i - W], p3 = m[i - W + 1], p4 = m[i + 1], p5 = m[i + W + 1], p6 = m[i + W], p7 = m[i + W - 1], p8 = m[i - 1], p9 = m[i - W - 1];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (A !== 1) continue;
        if (step === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
        del.push(i);
      }
      for (const i of del) m[i] = 0;
      if (del.length) changed = true;
    }
  }
  return m;
}
function rasterise(paths, q) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths) for (const v of p) { x0 = Math.min(x0, v.X); x1 = Math.max(x1, v.X); y0 = Math.min(y0, v.Y); y1 = Math.max(y1, v.Y); }
  x0 /= SC; x1 /= SC; y0 /= SC; y1 /= SC;
  const pad = 3, W = Math.ceil((x1 - x0) / q) + 2 * pad, H = Math.ceil((y1 - y0) / q) + 2 * pad;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.beginPath();
  for (const p of paths) p.forEach((v, i) => { const X = (v.X / SC - x0) / q + pad, Y = (y1 - v.Y / SC) / q + pad; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
  ctx.fill('evenodd');
  const img = ctx.getImageData(0, 0, W, H).data, mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = img[i * 4 + 3] >= 128 ? 1 : 0;
  // pixel centre (i + 0.5) -> mm
  return { mask, W, H, toMM: (px, py) => [x0 + (px + 0.5 - pad) * q, y1 - (py + 0.5 - pad) * q], toPx: (x, y) => [(x - x0) / q + pad - 0.5, (y1 - y) / q + pad - 0.5] };
}
function skeleton(paths, G) {
  // pixel size: fine enough to resolve the strokes, coarse enough to stay fast on big letters
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths) for (const v of p) { x0 = Math.min(x0, v.X); x1 = Math.max(x1, v.X); y0 = Math.min(y0, v.Y); y1 = Math.max(y1, v.Y); }
  const q = Math.max(G.r / 4, Math.max(x1 - x0, y1 - y0) / SC / 700, 0.02);
  const { mask, W, H, toMM, toPx } = rasterise(paths, q);
  const dist = edt(mask, W, H);
  const sk = thin(mask, W, H);
  const OFF = [-W, -W + 1, 1, W + 1, W, W - 1, -1, -W - 1]; // circular order p2..p9
  const ORTH = [true, false, true, false, true, false, true, false];
  const cn = i => { let t = 0; for (let k = 0; k < 8; k++) if (!sk[i + OFF[k]] && sk[i + OFF[(k + 1) % 8]]) t++; return t; };
  const halfW = [];
  const isNode = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (sk[i]) { halfW.push(dist[i] * q); const c = cn(i); if (c !== 2) isNode[i] = 1; }
  // cluster neighbouring node pixels into nodes
  const nodeOf = new Int32Array(W * H).fill(-1), nodes = [];
  for (let i = 0; i < W * H; i++) {
    if (!isNode[i] || nodeOf[i] >= 0) continue;
    const id = nodes.length, px = [i], st = [i]; nodeOf[i] = id;
    while (st.length) { const a = st.pop(); for (const o of OFF) { const b = a + o; if (isNode[b] && nodeOf[b] < 0) { nodeOf[b] = id; px.push(b); st.push(b); } } }
    let sx = 0, sy = 0, dm = 0;
    for (const a of px) { sx += a % W; sy += Math.floor(a / W); dm = Math.max(dm, dist[a]); }
    nodes.push({ x: sx / px.length, y: sy / px.length, d: dm, px });
  }
  const vis = new Uint8Array(W * H), edges = [];
  const xy = i => [i % W, Math.floor(i / W)];
  const walk = (start, p0, q0) => {
    const pts = [p0, q0]; vis[q0] = 1; let prev = p0, cur = q0;
    for (;;) {
      let nodePix = -1, line = -1, lineOrth = false;
      for (let k = 0; k < 8; k++) {
        const n = cur + OFF[k];
        if (!sk[n] || n === prev) continue;
        if (nodeOf[n] >= 0) { if (nodeOf[n] === start && pts.length < 4) continue; if (nodePix < 0) nodePix = n; }
        else if (!vis[n] && (line < 0 || (ORTH[k] && !lineOrth))) { line = n; lineOrth = ORTH[k]; }
      }
      if (nodePix >= 0) { pts.push(nodePix); return { a: start, b: nodeOf[nodePix], pts }; }
      if (line < 0) return { a: start, b: -1, pts };
      vis[line] = 1; pts.push(line); prev = cur; cur = line;
    }
  };
  nodes.forEach((nd, id) => { for (const p of nd.px) for (const o of OFF) { const qq = p + o; if (sk[qq] && nodeOf[qq] < 0 && !vis[qq]) edges.push(walk(id, p, qq)); } });
  // dead ends become end nodes
  for (const e of edges) if (e.b < 0) { const last = e.pts.at(-1), [x, y] = xy(last); e.b = nodes.length; nodes.push({ x, y, d: dist[last], px: [last] }); }
  // closed loops with no nodes (e.g. the centre line of an O)
  for (let i = 0; i < W * H; i++) {
    if (!sk[i] || nodeOf[i] >= 0 || vis[i]) continue;
    const pts = [i]; vis[i] = 1; let cur = i;
    for (;;) { let nx = -1; for (const o of OFF) { const n = cur + o; if (sk[n] && !vis[n] && nodeOf[n] < 0) { nx = n; break; } } if (nx < 0) break; vis[nx] = 1; pts.push(nx); cur = nx; }
    if (pts.length > 3) edges.push({ a: -1, b: -1, pts, closed: true });
  }
  // edges as pixel coordinates, ends snapped to node centres
  for (const e of edges) {
    e.xy = e.pts.map(xy);
    if (!e.closed) { e.xy[0] = [nodes[e.a].x, nodes[e.a].y]; e.xy[e.xy.length - 1] = [nodes[e.b].x, nodes[e.b].y]; }
    e.len = polyLen(e.xy, e.closed); e.alive = true;
  }
  const degree = () => { const dg = new Array(nodes.length).fill(0); for (const e of edges) if (e.alive && !e.closed) { dg[e.a]++; dg[e.b]++; } return dg; };
  // prune spurs: short branches from a junction to a free end (corners of square stroke ends etc.)
  for (let it = 0; it < 3; it++) {
    const dg = degree(); let any = false;
    for (const e of edges) {
      if (!e.alive || e.closed) continue;
      const da = dg[e.a], db = dg[e.b];
      let j = -1;
      if (da === 1 && db >= 3) j = e.b; else if (db === 1 && da >= 3) j = e.a;
      if (j >= 0 && e.len < 1.6 * nodes[j].d + 2) { e.alive = false; any = true; dg[e.a]--; dg[e.b]--; }
    }
    if (!any) break;
  }
  // merge chains through nodes left with two branches
  for (let changed = true; changed;) {
    changed = false;
    const dg = degree(), at = nodes.map(() => []);
    edges.forEach((e, k) => { if (e.alive && !e.closed) { at[e.a].push(k); at[e.b].push(k); } });
    for (let n = 0; n < nodes.length; n++) {
      if (dg[n] !== 2) continue;
      const [k1, k2] = at[n], e1 = edges[k1], e2 = edges[k2];
      if (!e1.alive || !e2.alive) continue;
      if (k1 === k2) { e1.closed = true; e1.xy.pop(); changed = true; continue; }
      const p1 = e1.b === n ? e1.xy : [...e1.xy].reverse(), a = e1.b === n ? e1.a : e1.b;
      const p2 = e2.a === n ? e2.xy : [...e2.xy].reverse(), b = e2.a === n ? e2.b : e2.a;
      e1.alive = e2.alive = false;
      const ne = { a, b, xy: [...p1, ...p2.slice(1)], alive: true };
      if (a === b) { ne.closed = true; ne.xy.pop(); }
      ne.len = polyLen(ne.xy, ne.closed);
      edges.push(ne); changed = true;
      break; // degrees changed: recount
    }
  }
  const dg = degree();
  const sample = (x, y) => { const [px, py] = toPx(x, y), i = Math.round(py) * W + Math.round(px); return i >= 0 && i < W * H ? dist[i] * q - q / 2 : 0; };
  // smooth the pixel staircase, convert to mm
  const smooth = (pts, closed) => {
    let a = pts;
    for (let it = 0; it < 4; it++) {
      const b = a.map(p => [...p]);
      for (let i = 0; i < a.length; i++) {
        if (!closed && (i === 0 || i === a.length - 1)) continue;
        const pa = a[(i - 1 + a.length) % a.length], pb = a[(i + 1) % a.length];
        b[i] = [(pa[0] + 2 * a[i][0] + pb[0]) / 4, (pa[1] + 2 * a[i][1] + pb[1]) / 4];
      }
      a = b;
    }
    return a;
  };
  const out = { edges: [], nodes: [], halfW, sample, grid: { dist, W, H, q, toMM } };
  nodes.forEach((nd, id) => { const [x, y] = toMM(nd.x, nd.y); out.nodes.push({ x, y, deg: dg[id], id }); });
  for (const e of edges) {
    if (!e.alive) continue;
    let mm = smooth(e.xy.map(([x, y]) => toMM(x, y)), e.closed);
    if (!e.closed) {
      // stretch free ends towards the stroke end, as far as a stone still fits
      const ext = (pts, atEnd) => {
        const seq = atEnd ? pts : [...pts].reverse(), end = seq.at(-1);
        let back = seq[0], acc = 0;
        for (let i = seq.length - 2; i >= 0; i--) { acc += Math.hypot(seq[i + 1][0] - seq[i][0], seq[i + 1][1] - seq[i][1]); back = seq[i]; if (acc > 2 * G.r) break; }
        const dx = end[0] - back[0], dy = end[1] - back[1], dl = Math.hypot(dx, dy);
        if (dl < 1e-6) return pts;
        const ux = dx / dl, uy = dy / dl, need = G.r + G.m, st = q / 2;
        let x = end[0], y = end[1], moved = 0;
        while (moved < 3 * G.r && sample(x + ux * st, y + uy * st) >= need) { x += ux * st; y += uy * st; moved += st; }
        if (!moved) return pts;
        return atEnd ? [...pts, [x, y]] : [[x, y], ...pts];
      };
      if (dg[e.a] === 1) mm = ext(mm, false);
      if (dg[e.b] === 1) mm = ext(mm, true);
    }
    out.edges.push({ a: e.a, b: e.b, pts: mm, closed: !!e.closed });
  }
  return out;
}
function centreStones(paths, G, out) {
  const sk = skeleton(paths, G);
  const used = new Set();
  for (const e of sk.edges) {
    const L = polyLen(e.pts, e.closed);
    // stroke half width along this edge (median), so callers can tell thin strokes from wide ones
    const hs = e.pts.map(([x, y]) => sk.sample(x, y)).sort((a, b) => a - b), hw = hs[hs.length >> 1] || 0;
    const n0 = out.length;
    const tag = () => { for (let i = n0; i < out.length; i++) out[i][3] = hw; };
    if (e.closed) {
      if (L < G.thr * 2.2) { const c = centroid(e.pts); out.push([c[0], c[1], 1]); } else placeClosed(e.pts, G, 2, out);
      tag(); continue;
    }
    // ends move when free ends get stretched, so read them from the edge
    const endA = sk.nodes[e.a], endB = sk.nodes[e.b];
    if (endA.deg === 1 && endB.deg === 1 && L < G.thr) { const m = pointsAt(e.pts, false, [L / 2])[0]; out.push([m[0], m[1], 1]); used.add(e.a); used.add(e.b); tag(); continue; }
    if (endA.deg === 1) used.add(e.a);
    if (endB.deg === 1) used.add(e.b);
    // free ends get a stone here; junction stones are added once per junction below
    placeAlong(e.pts, false, G, 3, out, [endA.deg === 1, endB.deg === 1]);
    tag();
  }
  // junctions and isolated dots
  for (const nd of sk.nodes) if (!used.has(nd.id) && (nd.deg >= 3 || nd.deg === 0)) out.push([nd.x, nd.y, 0, sk.sample(nd.x, nd.y)]);
  const hw = sk.halfW.sort((a, b) => a - b);
  return { h: hw.length ? hw[hw.length >> 1] : 0, sk };
}
// spatial hash of stones [x, y, r]; cell must be at least the largest search radius
function stoneHash(cell) {
  const m = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  const each = (x, y, fn) => {
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      const b = m.get(key(i, j));
      if (b) for (let k = 0; k < b.length; k += 3) if (fn(b[k], b[k + 1], b[k + 2])) return true;
    }
    return false;
  };
  return {
    add(x, y, r) { const k = key(Math.floor(x / cell), Math.floor(y / cell)); let b = m.get(k); if (!b) m.set(k, b = []); b.push(x, y, r); },
    // true when a stone of radius r at (x, y) would be closer than minGap(r, other r) to any stone
    clash(x, y, r, minD) { return each(x, y, (tx, ty, tr) => (tx - x) ** 2 + (ty - y) ** 2 < minD(r, tr) ** 2); },
    each(x, y, fn) { each(x, y, (tx, ty, tr) => { fn(tx, ty, tr); return false; }); },
  };
}
// centre-to-centre distances between two holes of radius a and b: the spacing aimed for,
// and the closest allowed (half the gap)
const pairP = (G, a, b) => a + b + G.gap;
const pairMin = (G, a, b) => a + b + G.gap * 0.5;
// the hard minimum (a quarter of the gap): only outline rows go this close, and only where the
// alternative is a gap much wider than the spacing
const pairHard = (G, a, b) => a + b + G.gap * 0.25;
// nested fill: starting from the stones already placed (the outline row), each new stone goes
// into a pocket exactly one spacing away from two neighbours. Pockets nearest the letter edge
// fill first, so each row sits offset into the gaps of the row outside it (honeycomb packing
// that follows the shape). Fill stones use the inner size Gi, which may differ from the outline.
function nestFill(sk, G, Gi, seed, out) {
  const ri = Gi.r, need = ri + G.m - sk.grid.q * 0.5, rmax = Math.max(G.r, ri);
  const minD = (a, b) => Math.max(pairMin(G, a, b), pairP(G, a, b) * 0.97);
  const hash = stoneHash(2 * pairP(G, rmax, ri));
  const heap = []; let seq = 0;
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[3] < b[3]);
  const hpush = v => {
    heap.push(v);
    for (let i = heap.length - 1; i > 0;) { const pi = (i - 1) >> 1; if (!less(heap[i], heap[pi])) break; [heap[i], heap[pi]] = [heap[pi], heap[i]]; i = pi; }
  };
  const hpop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]]; i = m;
      }
    }
    return top;
  };
  // pockets: points one spacing (for their sizes) from both this stone and a neighbour
  const pockets = (x, y, r) => hash.each(x, y, (tx, ty, tr) => {
    const da = pairP(G, r, ri), db = pairP(G, tr, ri);
    const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy);
    if (d < 1e-6 || d >= da + db || d <= Math.abs(da - db)) return;
    const a = (da * da - db * db + d * d) / (2 * d), h = Math.sqrt(Math.max(0, da * da - a * a));
    const ux = dx / d, uy = dy / d, mx = x + ux * a, my = y + uy * a;
    for (const sgn of [1, -1]) {
      const cx = mx - uy * h * sgn, cy = my + ux * h * sgn, depth = sk.sample(cx, cy);
      if (depth >= need && !hash.clash(cx, cy, ri, minD)) hpush([+depth.toFixed(3), cx, cy, seq++]);
    }
  });
  for (const s of seed) hash.add(s[0], s[1], s[3]);
  for (const s of seed) pockets(s[0], s[1], s[3]);
  const fills = [];
  while (heap.length) {
    const [, x, y] = hpop();
    if (hash.clash(x, y, ri, minD)) continue;
    hash.add(x, y, ri); fills.push([x, y, 50, ri]);
    pockets(x, y, ri);
  }
  relax(seed, fills, sk, G, ri, need);
  // relaxing can open holes the pockets never reached: fill them, then even out again
  for (let pass = 0; pass < 3 && fillHoles(seed, fills, sk, G, ri, need); pass++) relax(seed, fills, sk, G, ri, need);
  for (const f of fills) out.push(f);
}
// even out the fill: each fill stone is pushed away from neighbours closer than a little over
// one spacing, so inner rows centre themselves between the rows around them. Outline and
// centre-line stones stay put, and no stone moves out of the area stones may sit in.
function relax(fixed, fills, sk, G, ri, need, strict = false) {
  const rmax = fixed.reduce((m, s) => Math.max(m, s[3]), ri);
  const pi = 2 * ri + G.gap, maxStep = pi * 0.2;
  for (let it = 0; it < 10; it++) {
    const hash = stoneHash(pairP(G, rmax, ri) * 1.3);
    for (const s of fixed) hash.add(s[0], s[1], s[3]);
    for (const s of fills) hash.add(s[0], s[1], s[3]);
    let moved = 0;
    for (const s of fills) {
      let fx = 0, fy = 0;
      hash.each(s[0], s[1], (tx, ty, tr) => {
        const R = pairP(G, s[3], tr) * 1.3;
        const dx = s[0] - tx, dy = s[1] - ty, d = Math.hypot(dx, dy);
        if (d < 1e-9 || d >= R) return;
        const f = (R - d) / R;
        fx += dx / d * f; fy += dy / d * f;
      });
      let mx = fx * pi * 0.25, my = fy * pi * 0.25;
      const ml = Math.hypot(mx, my);
      if (ml > maxStep) { mx *= maxStep / ml; my *= maxStep / ml; }
      if (ml < 1e-4) continue;
      const nx = s[0] + mx, ny = s[1] + my;
      if (sk.sample(nx, ny) < need) continue;
      if (strict) {
        // never closer to a neighbour than the spacing allows (unless that moves them apart)
        let hit = false;
        hash.each(nx, ny, (tx, ty, tr) => {
          if (tx === s[0] && ty === s[1]) return;
          const d = Math.hypot(tx - nx, ty - ny);
          if (d < pairP(G, s[3], tr) * 0.97 && d < Math.hypot(tx - s[0], ty - s[1])) hit = true;
        });
        if (hit) continue;
      }
      s[0] = nx; s[1] = ny; moved += ml;
    }
    if (moved < fills.length * 1e-3) break;
  }
}
// scan the letter for spots with room for a fill stone (no closer than the minimum to any
// stone) and put one in each, biggest hole first. Returns how many were added.
function fillHoles(fixed, fills, sk, G, ri, need, strict = false) {
  const all = fixed.concat(fills);
  if (!all.length) return 0;
  const rmax = all.reduce((m, s) => Math.max(m, s[3]), ri);
  const R = 2 * pairP(G, rmax, ri), hash = stoneHash(R);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of all) {
    hash.add(s[0], s[1], s[3]);
    x0 = Math.min(x0, s[0]); y0 = Math.min(y0, s[1]); x1 = Math.max(x1, s[0]); y1 = Math.max(y1, s[1]);
  }
  // strict: only holes with the full stone spacing all round
  const step = (2 * ri + G.gap) / (strict ? 4 : 5), cand = [], room = ri + G.gap * (strict ? 0.97 : 0.5);
  const minD = strict ? (a, b) => pairP(G, a, b) * 0.97 : (a, b) => pairMin(G, a, b);
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
    let n = R; // free distance from this point to the nearest hole edge
    hash.each(x, y, (tx, ty, tr) => { const d = Math.hypot(tx - x, ty - y) - tr; if (d < n) n = d; });
    if (n >= room && sk.sample(x, y) >= need) cand.push([n, x, y]);
  }
  cand.sort((a, b) => b[0] - a[0]);
  let added = 0;
  for (const [, x, y] of cand) {
    if (hash.clash(x, y, ri, minD)) continue;
    hash.add(x, y, ri); fills.push([x, y, 50, ri]); added++;
  }
  return added;
}
// A hole only just too small for a stone can take one if its neighbours shuffle up a little.
// For each such hole a stone is tried: it and the fill stones around it push apart until the
// spacing is right everywhere. If that can't be reached, or a stone would have to move far
// (which would bend the lines), everything goes back as it was.
function squeezeFill(fixed, fills, sk, G, ri, need) {
  const all = fixed.concat(fills);
  if (!all.length) return 0;
  const pi = 2 * ri + G.gap, rmax = all.reduce((m, s) => Math.max(m, s[3]), ri);
  const R = 2 * pairP(G, rmax, ri), hash = stoneHash(R);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of all) {
    hash.add(s[0], s[1], s[3]);
    x0 = Math.min(x0, s[0]); y0 = Math.min(y0, s[1]); x1 = Math.max(x1, s[0]); y1 = Math.max(y1, s[1]);
  }
  const full = ri + G.gap * 0.97, step = pi / 5, cand = [];
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
    let n = R;
    hash.each(x, y, (tx, ty, tr) => { const d = Math.hypot(tx - x, ty - y) - tr; if (d < n) n = d; });
    if (n >= full - pi * 0.22 && n < full && sk.sample(x, y) >= need) cand.push([n, x, y]);
  }
  cand.sort((a, b) => b[0] - a[0]);
  const tried = [], reach = pi * 3.5, far = pi * 0.35, lim = (a, b) => pairP(G, a[3], b[3]);
  let added = 0;
  for (const [, x, y] of cand) {
    if (tried.some(q => Math.hypot(q[0] - x, q[1] - y) < pi)) continue;
    tried.push([x, y]);
    const s = [x, y, 50, ri];
    const mob = [s, ...fills.filter(f => Math.hypot(f[0] - x, f[1] - y) < reach)];
    const near = fixed.concat(fills).filter(f => Math.hypot(f[0] - x, f[1] - y) < reach + 2 * pairP(G, rmax, rmax) && !mob.includes(f));
    const save = mob.map(m => [m[0], m[1]]);
    let ok = false;
    for (let it = 0; it < 60; it++) {
      ok = true;
      const mv = mob.map(() => [0, 0]);
      mob.forEach((m, i) => {
        const push = (o, share) => {
          let dx = m[0] - o[0], dy = m[1] - o[1], d = Math.hypot(dx, dy);
          const t = lim(m, o);
          if (d >= t * 0.97) return;
          ok = false;
          if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
          mv[i][0] += dx / d * (t - d) * share; mv[i][1] += dy / d * (t - d) * share;
        };
        for (const o of near) push(o, 1);
        mob.forEach((o, j) => { if (j !== i) push(o, 0.5); });
      });
      if (ok) break;
      mob.forEach((m, i) => { m[0] += mv[i][0] * 0.8; m[1] += mv[i][1] * 0.8; });
    }
    if (ok) ok = mob.every((m, i) => sk.sample(m[0], m[1]) >= need && Math.hypot(m[0] - save[i][0], m[1] - save[i][1]) <= far);
    if (ok) {
      // the new stone must sit in line between its two nearest fill stones, not beside a line
      const nb = mob.slice(1).map(m => [Math.hypot(m[0] - s[0], m[1] - s[1]), m]).sort((p, q) => p[0] - q[0]);
      ok = false;
      if (nb.length >= 2 && nb[1][0] < pi * 1.6) {
        const [da, a] = nb[0], [db, b] = nb[1];
        ok = ((a[0] - s[0]) * (b[0] - s[0]) + (a[1] - s[1]) * (b[1] - s[1])) / (da * db) < -0.8;
      }
    }
    if (ok) { fills.push(s); added++; }
    else mob.forEach((m, i) => { m[0] = save[i][0]; m[1] = save[i][1]; });
  }
  return added;
}
// flow fill: inner stones on lines that run with the stroke. The centre line of the letter is
// the first line; where the stroke is wide enough, more lines run parallel to it, spread evenly
// between the outline rows (their distance from the centre scales with the local stroke width,
// so they follow tapers and curves). Along each line stones are evenly spaced, with the start
// shifted so as many as possible clear the stones already placed (sitting in the gaps of the
// row beside them, on the same line).
function flowFill(sk, G, Gi, seed, out) {
  const ri = Gi.r, pi = 2 * ri + G.gap, rmax = Math.max(G.r, ri);
  const dOut = G.r + G.m; // depth of the outline row's centres
  const c0 = pairP(G, G.r, ri) * 0.87; // closest a line may run to the outline row (stones offset)
  const rowSp = pi * 0.87; // closest two inner lines may run (stones offset)
  const need = ri + G.m - sk.grid.q * 0.5;
  const minD = (a, b) => Math.max(pairMin(G, a, b), pairP(G, a, b) * 0.97);
  const hash = stoneHash(pairP(G, rmax, rmax));
  for (const s of seed) hash.add(s[0], s[1], s[3]);
  const clear = (x, y) => !hash.clash(x, y, ri, minD);
  const lines = [];
  for (const e of sk.edges) {
    // resample the centre line evenly, with tangents and the local half width
    const { cum, L } = arcOf(e.pts, e.closed);
    if (L < 1e-6) continue;
    const ds = Math.min(pi / 6, L / 4), n = Math.max(2, Math.round(L / ds) + (e.closed ? 0 : 1));
    const step = e.closed ? L / n : L / (n - 1);
    const S = Array.from({ length: n }, (_, i) => posAt(e.pts, cum, L, e.closed, i * step));
    // The centre line rounds off where a stroke turns a square corner (the foot of an L), cutting
    // the corner diagonally. Square it up again: where two straight stretches meet at a sharp
    // turn, both are carried on to the point where they cross.
    const w = Math.max(2, Math.round(pi * 1.5 / step));
    if (n > 4 * w + 2) {
      const at = i => e.closed ? S[((i % n) + n) % n] : S[i];
      const dir = (i, j) => { const a = at(i), b = at(j), l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
      const lo = e.closed ? 0 : 2 * w, hi = e.closed ? n : n - 2 * w;
      const turn = i => { const u = dir(i - 2 * w, i - w), v = dir(i + w, i + 2 * w); return u[0] * v[0] + u[1] * v[1]; };
      for (let i = lo; i < hi; i++) {
        const c = turn(i);
        if (c > 0.5) continue; // under 60 degrees
        // the sharpest point of this turn
        let bi = i, bc = c;
        for (let j = i + 1; j < Math.min(hi, i + 2 * w); j++) { const cj = turn(j); if (cj < bc) { bc = cj; bi = j; } }
        // both arms must be straight
        const u = dir(bi - 2 * w, bi - w), v = dir(bi + w, bi + 2 * w);
        const A = at(bi - w), Bp = at(bi + w), den = u[0] * v[1] - u[1] * v[0];
        if (Math.abs(den) > 0.3) {
          const tA = ((Bp[0] - A[0]) * v[1] - (Bp[1] - A[1]) * v[0]) / den, X = [A[0] + u[0] * tA, A[1] + u[1] * tA];
          const tB = (X[0] - Bp[0]) * v[0] + (X[1] - Bp[1]) * v[1];
          if (tA > 0 && tB < 0 && tA < pi * 4 && -tB < pi * 4 && sk.sample(X[0], X[1]) >= need) {
            for (let j = -w + 1; j < w; j++) {
              const f = (j + w) / (2 * w), q = f < 0.5 ? [A[0] + (X[0] - A[0]) * f * 2, A[1] + (X[1] - A[1]) * f * 2] : [X[0] + (Bp[0] - X[0]) * (f - 0.5) * 2, X[1] + (Bp[1] - X[1]) * (f - 0.5) * 2];
              const k = e.closed ? (((bi + j) % n) + n) % n : bi + j;
              S[k] = q;
            }
          }
        }
        i = bi + 2 * w;
      }
    }
    const hw = S.map(([x, y]) => sk.sample(x, y));
    const med = [...hw].sort((a, b) => a - b)[n >> 1];
    // smooth the width over about one stone spacing, and keep junction bulges in check
    const win = Math.max(1, Math.round(pi / step));
    const B0 = hw.map((_, i) => {
      let t = 0, c = 0;
      for (let k = -win; k <= win; k++) {
        let j = i + k;
        if (e.closed) j = (j + n) % n; else if (j < 0 || j >= n) continue;
        t += Math.min(hw[j], med * 1.8); c++;
      }
      return t / c - dOut;
    });
    // where strokes meet, the width swells; cap it near the stroke's usual width so the lines
    // keep their spacing into the junction
    const sorted = [...B0].sort((a, b) => a - b), cap = sorted[Math.floor(n * 0.75)] * 1.15;
    const B = B0.map(b => Math.min(b, cap));
    // how many lines fit between the outline rows at each point: k lines make k + 1 equal gaps;
    // the outer gaps face the outline row, the rest face other lines
    const fit = Bi => { let k = 0; while (2 * Bi / (k + 2) >= (k + 1 === 1 ? c0 : Math.max(c0, rowSp))) k++; return k; };
    const K = B.map(fit);
    // keep the count steady: a stretch with its own count must be at least a few stones long,
    // otherwise it takes the count of its longer neighbour (lines never flicker in and out)
    const minRun = Math.max(2, Math.round(pi * 2.5 / step));
    for (let guard = 0; guard < 50; guard++) {
      const rs = [];
      for (let i = 0; i < n; i++) if (!rs.length || K[i] !== rs.at(-1).k) rs.push({ k: K[i], a: i, b: i }); else rs.at(-1).b = i;
      if (e.closed && rs.length > 1 && rs[0].k === rs.at(-1).k) { rs[0].a = rs.at(-1).a - n; rs.pop(); }
      if (rs.length < 2) break;
      let wi = -1, wl = Infinity;
      rs.forEach((r, i) => { const l = r.b - r.a + 1; if (l < minRun && l < wl) { wl = l; wi = i; } });
      if (wi < 0) break;
      const prev = rs[(wi - 1 + rs.length) % rs.length], next = rs[(wi + 1) % rs.length];
      const nb = [];
      if (e.closed || wi > 0) nb.push(prev);
      if (e.closed || wi < rs.length - 1) nb.push(next);
      nb.sort((a, b) => (b.b - b.a) - (a.b - a.a) || a.k - b.k);
      const nk = nb[0].k;
      for (let i = rs[wi].a; i <= rs[wi].b; i++) K[(i + n) % n] = nk;
    }
    const N = S.map((p, i) => {
      const a = S[e.closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = S[e.closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [-dy / l, dx / l];
    });
    // line j of k sits at an even share of the width (0 is the centre line); where the count
    // changes, lines split or merge
    const kmax = Math.max(0, ...K);
    for (let k = 1; k <= kmax; k++) for (let j = 0; j < k; j++) {
      const f = -1 + 2 * (j + 1) / (k + 1);
      const pts = S.map((p, i) => K[i] === k ? [p[0] + N[i][0] * B[i] * f, p[1] + N[i][1] * B[i] * f] : null);
      lines.push({ pts, closed: e.closed, f: Math.abs(f), len: L });
    }
  }
  // centre lines first, then outwards; longer lines first
  lines.sort((a, b) => a.f - b.f || b.len - a.len);
  const fills = [];
  const put = (x, y) => { hash.add(x, y, ri); fills.push([x, y, 50, ri]); };
  for (const ln of lines) {
    // split the line into runs that stay inside the area a stone may sit in
    const runs = [];
    let cur = [];
    for (const p of ln.pts) {
      if (p && sk.sample(p[0], p[1]) >= need) cur.push(p);
      else { if (cur.length > 1) runs.push(cur); cur = []; }
    }
    if (cur.length > 1) runs.push(cur);
    const closedRun = ln.closed && runs.length === 1 && runs[0].length === ln.pts.length;
    for (const run of runs) placeEven(run, closedRun, pi, clear, put, G, ri);
  }
  // even out: stones push each other apart a little, which spreads the stones of short lines
  // (where strokes meet) evenly between their neighbours; lines already sitting in the gaps of
  // the rows beside them stay put
  // (holes are filled first so the spreading has every stone to work with, and again after,
  // since spreading can open a hole up)
  for (let pass = 0; pass < 3; pass++) {
    const added = fillHoles(seed, fills, sk, G, ri, need, true);
    if (pass && !added) break;
    relax(seed, fills, sk, G, ri, need, true);
  }
  // then holes that are only just too small
  squeezeFill(seed, fills, sk, G, ri, need);
  for (const f of fills) out.push(f);
}
// stones along a run of a line. The run is first cut into the stretches where a stone clears
// everything already placed. Beside a row of stones those stretches are the short windows
// opposite the row's gaps, and one stone goes in the middle of each, so the line sits neatly in
// the gaps of its neighbours; a free stretch gets as many stones as fit, evenly spread. What is
// still empty is tried again a little to the side of the line.
function placeEven(pts, closed, pitch, clear, put, G, ri) {
  const { cum, L } = arcOf(pts, closed);
  const pos = s => posAt(pts, cum, L, closed, s);
  if (L < pitch * 0.5) { const p = pos(L / 2); if (clear(p[0], p[1])) put(p[0], p[1]); return; }
  const n = Math.max(2, Math.ceil(L / (pitch / 16))), st = closed ? L / n : L / (n - 1);
  const at = (t, o) => {
    const [x, y] = pos(t);
    if (!o) return [x, y];
    const a = pos(closed ? t - st : Math.max(0, t - st)), b = pos(closed ? t + st : Math.min(L, t + st)), l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [x - (b[1] - a[1]) / l * o, y + (b[0] - a[0]) / l * o];
  };
  const free = clear; // stones put down are in the hash behind clear(), so they block too
  for (const o of [0, 0.06, -0.06, 0.12, -0.12].map(f => f * pitch)) {
    const ok = Array.from({ length: n }, (_, i) => { const q = at(i * st, o); return free(q[0], q[1]); });
    if (!ok.some(Boolean)) continue;
    if (closed && ok.every(Boolean)) {
      // an unobstructed loop: evenly all the way round
      const m = Math.max(1, Math.floor(L / pitch));
      for (let i = 0; i < m; i++) { const q = at(i * L / m, o); if (free(q[0], q[1])) put(q[0], q[1]); }
      continue;
    }
    // on a loop, start counting from a blocked sample so no stretch is split at the seam
    const i0 = closed ? ok.indexOf(false) : 0, cnt = n;
    for (let j = 0; j < cnt;) {
      if (!ok[(i0 + j) % n]) { j++; continue; }
      let k = j;
      while (k + 1 < cnt && ok[(i0 + k + 1) % n]) k++;
      const a = (i0 + j) * st, w = (k - j) * st;
      const m = Math.floor(w / pitch + 1e-6) + 1, sp = m > 1 ? Math.min(w / (m - 1), pitch * 1.3) : 0, a0 = a + (w - sp * (m - 1)) / 2;
      for (let i = 0; i < m; i++) { const q = at(a0 + i * sp, o); if (free(q[0], q[1])) put(q[0], q[1]); }
      j = k + 1;
    }
  }
}
// two rows fit across a stroke when its half width leaves thr between them
const thinLimit = G => G.r + G.m + G.thr * 0.5;
// gc: glyph with its centre line worked out ({paths, cs, h, sk}); fill is never 'auto' here.
// G is the outline stone, Gi the inner (fill) stone. Stones come back as [x, y, priority, r].
function glyphStones(gc, G, Gi, fill) {
  const { paths, cs, sk } = gc, thin = thinLimit(G);
  const strip = a => a.map(s => [s[0], s[1], s[2], s[3]]);
  const tag = (from, r) => { for (let i = from; i < out.length; i++) out[i][3] = r; };
  if (fill === 'centre') return cs.map(s => [s[0], s[1], s[2], G.r]);
  let out = [];
  if (fill === 'outline' || fill === 'rings' || fill === 'flow') ringStones(paths, G, 1, out);
  else if (fill === 'outhex') {
    ringStones(paths, G, 1, out);
    const n = out.length;
    hexStones(paths, G.r + G.m + pairP(G, G.r, Gi.r) * 0.85, Gi, out); tag(n, Gi.r);
  }
  else if (fill === 'hex') hexStones(paths, G.r + G.m, G, out);
  for (const s of out) s[3] ??= G.r;
  // the outline drops out where a stroke is too thin for two rows; the centre line covers those parts.
  // Near the limit either may miss, so a little past it centre stones also go where no outline
  // stone is close by
  const ring = stoneHash(G.p * 1.2);
  for (const s of out) ring.add(s[0], s[1], s[3]);
  for (const s of cs) {
    if (s[3] >= thin + G.p * 0.5) continue;
    if (s[3] >= thin && ring.clash(s[0], s[1], G.r, () => G.p * 1.2)) continue;
    out.push([s[0], s[1], 60, G.r]);
  }
  // rows nested into the outline fill the rest
  if (fill === 'rings' || fill === 'outhex') { out = cull(out, G); nestFill(sk, G, Gi, out, out); }
  else if (fill === 'flow') { out = cull(out, G); flowFill(sk, G, Gi, out, out); }
  else out = cull(out, G);
  // a letter that is its own mirror image gets a mirrored layout: one half is kept and copied
  // across, then any hole left on the axis is filled
  for (const ax of [0, 1]) {
    const c = mirrorAxis(paths, ax);
    if (c === null) continue;
    out = symmetrise(out, ax, c, G);
    if (fill === 'flow' || fill === 'rings' || fill === 'outhex') {
      const add = [];
      fillHoles(out, add, sk, G, Gi.r, Gi.r + G.m - sk.grid.q * 0.5, true);
      if (add.length) out = symmetrise(out.concat(add), ax, c, G);
    }
  }
  return strip(out);
}
// the mirror line of a letter (x for ax 0, y for ax 1, in mm) when the letter is its own mirror
// image across the middle of its bounds, else null
function mirrorAxis(paths, ax) {
  const k = ax ? 'Y' : 'X';
  let lo = Infinity, hi = -Infinity;
  for (const p of paths) for (const q of p) { lo = Math.min(lo, q[k]); hi = Math.max(hi, q[k]); }
  if (!(hi > lo)) return null;
  const flip = paths.map(p => p.map(q => ax ? { X: q.X, Y: lo + hi - q.Y } : { X: lo + hi - q.X, Y: q.Y }).reverse());
  const c = new CL.Clipper(), diff = [];
  c.AddPaths(paths, CL.PolyType.ptSubject, true);
  c.AddPaths(flip, CL.PolyType.ptClip, true);
  c.Execute(CL.ClipType.ctXor, diff, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  const area = ps => Math.abs(ps.reduce((s, p) => s + CL.Clipper.Area(p), 0));
  return area(diff) < area(paths) * 0.015 ? (lo + hi) / 2 / SC : null;
}
// keep the stones on the low side of the mirror line and copy them across. A stone too close to
// the line to have a twin moves onto it.
function symmetrise(stones, ax, c, G) {
  const out = [];
  for (const s of stones) {
    const d = c - s[ax];
    if (2 * Math.abs(d) < pairHard(G, s[3], s[3])) { const m = [...s]; m[ax] = c; out.push(m); continue; }
    if (d < 0) continue;
    const m = [...s]; m[ax] = c + d;
    out.push(s, m);
  }
  return cull(out, G);
}
// drop stones closer than the minimum spacing, keeping the lower priority number
function cull(stones, G) {
  const rmax = stones.reduce((m, s) => Math.max(m, s[3]), 0), hash = stoneHash(pairMin(G, rmax, rmax)), out = [];
  stones.map((s, i) => [s, i]).sort((a, b) => a[0][2] - b[0][2] || a[1] - b[1]).forEach(([s]) => {
    if (hash.clash(s[0], s[1], s[3], (a, b) => pairHard(G, a, b) * 0.995)) return;
    hash.add(s[0], s[1], s[3]); out.push(s);
  });
  return out;
}

/* ---------- layout ---------- */
const stoneD = () => P.stone === 'custom' ? P.custom : STONES.find(s => s[0] === P.stone)[2];
const holeD = () => stoneD() + P.allow;
// inner (fill) stones can be a different size from the outline
const innerD = () => P.inner === 'same' ? stoneD() : STONES.find(s => s[0] === P.inner)[2];
const stoneName = d => (STONES.find(s => s[2] === d)?.[1].replace(/ \(.*/, '') || 'Custom') + ' ' + d.toFixed(1) + ' mm';
const stoneLabel = d => STONES.find(s => s[2] === d)?.[1] || d.toFixed(1) + ' mm stones'; // as in the stone size list: "SS10 (2.8 mm)"
function capUnits(font) {
  const c = font.tables.os2?.sCapHeight;
  if (c > 0) return c;
  const b = font.charToGlyph('H').getBoundingBox();
  return b.y2 > 0 ? b.y2 : font.unitsPerEm * 0.7;
}
const CAP = 100; // natural layout: capital letters 100 units tall
function layoutNatural(font) {
  const fs = CAP * font.unitsPerEm / capUnits(font), k = fs / font.unitsPerEm;
  const glyphs = [], missing = new Set();
  P.text.split('\n').forEach((line, li) => {
    const base = -li * CAP * P.lineSp / 100, row = [];
    let x = 0, prev = null;
    for (const ch of Array.from(line)) {
      let g = font.charToGlyph(ch);
      // a character the font lacks is left out (its glyph would be an empty box) and named in a warning;
      // joiners, variation selectors and accents typed on their own are left out without a word
      if (!g.index && ch !== ' ') {
        if (!/\s/.test(ch)) { if (!/[\p{Cf}\p{M}\p{Cc}]/u.test(ch)) missing.add(ch); continue; }
        g = font.charToGlyph(' ');
      }
      if (prev) x += font.getKerningValue(prev, g) * k;
      const contours = flatten(g.getPath(0, 0, fs).commands, 0.8);
      if (contours.length) row.push({ ch, contours, ox: x, oy: base });
      x += g.advanceWidth * k + CAP * P.letterSp / 100 + (/\s/.test(ch) ? CAP * P.wordSp / 100 : 0);
      prev = g;
    }
    if (!row.length) return;
    let x0 = Infinity, x1 = -Infinity;
    for (const g of row) for (const c of g.contours) for (const [px] of c) { x0 = Math.min(x0, px + g.ox); x1 = Math.max(x1, px + g.ox); }
    row.x0 = x0; row.x1 = x1;
    glyphs.push(row);
  });
  const maxW = Math.max(0, ...glyphs.map(r => r.x1 - r.x0));
  const all = [];
  for (const row of glyphs) {
    const shift = P.align === 'left' ? -row.x0 : P.align === 'right' ? maxW - row.x1 : (maxW - (row.x1 - row.x0)) / 2 - row.x0;
    for (const g of row) { g.ox += shift; all.push(g); }
  }
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const g of all) for (const c of g.contours) for (const [x, y] of c) {
    bx0 = Math.min(bx0, x + g.ox); bx1 = Math.max(bx1, x + g.ox); by0 = Math.min(by0, y + g.oy); by1 = Math.max(by1, y + g.oy);
  }
  return { glyphs: all, missing: [...missing], b: all.length ? { x0: bx0, y0: by0, x1: bx1, y1: by1, w: bx1 - bx0, h: by1 - by0 } : null };
}

const glyphCache = new Map();
let built = null, natural = null, fontObj = null;
async function rebuild() {
  const t0 = performance.now();
  try { fontObj = await getFont(P.font); } catch (e) { fontObj = null; }
  if (!fontObj) { P.font = DEF.font; fontObj = await getFont(P.font); lastGeo = geoKey(); }
  natural = layoutNatural(fontObj);
  const hole = holeD(), G = { r: hole / 2, m: P.inset, p: hole + P.gap, thr: hole + P.gap * 0.5, gap: P.gap };
  const ihole = innerD() + P.allow, Gi = { ...G, r: ihole / 2, p: ihole + P.gap, thr: ihole + P.gap * 0.5 };
  const res = { stones: [], outlines: [], hole, ihole, W: 0, H: 0, warnings: [] };
  if (natural.b) {
    const sy = P.height / natural.b.h, sx = sy * P.stretch;
    res.W = natural.b.w * sx; res.H = P.height;
    let all = [];
    for (const g of natural.glyphs) {
      const key = JSON.stringify([P.font === '__custom' ? customFont?.names?.fullName?.en : P.font, g.ch, sx.toFixed(5), sy.toFixed(5), P.bold, hole, ihole, P.gap, P.inset]);
      let gl = glyphCache.get(key);
      if (!gl) {
        let paths = union(toClip(g.contours, sx, sy));
        if (P.bold) paths = offsetPaths(paths, P.bold);
        gl = { paths, cs: [], h: 0, byFill: {} };
        // the centre line is always worked out: it covers strokes too thin for two rows of stones
        if (paths.length) Object.assign(gl, centreStones(paths, G, gl.cs));
        if (glyphCache.size > 400) glyphCache.clear();
        glyphCache.set(key, gl);
      }
      g.gl = gl;
    }
    // Auto picks one pattern for the whole text, from the typical stroke width
    let mode = P.fill;
    const hs = natural.glyphs.filter(g => g.gl.paths.length).map(g => g.gl.h).sort((a, b) => a - b);
    res.thin = !(hs.length && hs[hs.length >> 1] >= thinLimit(G)); // most strokes hold one row only
    if (mode === 'auto') mode = res.thin ? 'centre' : 'flow';
    res.mode = mode;
    for (const g of natural.glyphs) {
      const gl = g.gl;
      gl.byFill[mode] ||= gl.paths.length ? glyphStones(gl, G, Gi, mode) : [];
      gl.stones = gl.byFill[mode];
      const dx = (g.ox - natural.b.x0) * sx, dy = (g.oy - natural.b.y0) * sy;
      for (const s of gl.stones) all.push([s[0] + dx, s[1] + dy, s[2], s[3]]);
      for (const p of gl.paths) res.outlines.push(toMM(p).map(([x, y]) => [x + dx, y + dy]));
    }
    all = cull(all, G);
    // manual edits
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < hole * 0.6;
    all = all.filter(s => !edits.rm.some(r => near(r, s)));
    for (const a of edits.add) all.push([a[0], a[1], -1, G.r, true]); // [4]: added by hand
    res.stones = all;
  }
  // the whole design can be turned on the sheet (a long word fits a square mat on the diagonal)
  const extOf = deg => {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y, , r] of res.stones) { const X = x * c - y * s, Y = x * s + y * c; x0 = Math.min(x0, X - r); x1 = Math.max(x1, X + r); y0 = Math.min(y0, Y - r); y1 = Math.max(y1, Y + r); }
    return [x1 - x0, y1 - y0];
  };
  const flat = res.stones.length ? [0, 45].map(d => [d, ...extOf(d)]) : [];
  res.rot = P.rotate * Math.PI / 180;
  if (P.rotate) {
    const c = Math.cos(res.rot), s = Math.sin(res.rot), turn = ([x, y]) => [x * c - y * s, x * s + y * c];
    res.stones = res.stones.map(q => [...turn(q), ...q.slice(2)]);
    res.outlines = res.outlines.map(o => o.map(turn));
  }
  // design extents: holes (or outlines when there are no stones), optionally a border around them
  let x0 = 0, y0 = 0, x1 = res.W, y1 = res.H;
  if (res.stones.length) {
    x0 = y0 = Infinity; x1 = y1 = -Infinity;
    for (const [x, y, , r] of res.stones) { x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r); }
  }
  const bm = P.border ? P.borderM : 0;
  res.shift = [bm - x0, bm - y0];
  res.ext = { w: x1 - x0 + 2 * bm, h: y1 - y0 + 2 * bm, sw: x1 - x0, sh: y1 - y0 };
  // warnings
  const mat = MATS.find(m => m[0] === P.mat);
  const fitsMat = (w, h) => (w <= mat[2] + 0.01 && h <= mat[3] + 0.01) || (w <= mat[3] + 0.01 && h <= mat[2] + 0.01);
  if (mat[2] && !fitsMat(res.ext.w, res.ext.h)) {
    // offer the turn that makes it fit, if there is one
    const alt = flat.find(([d, w, h]) => d !== Math.abs(P.rotate) % 90 && fitsMat(w + 2 * bm, h + 2 * bm));
    res.warnings.push(`The design (${fmtLen(res.ext.w)} × ${fmtLen(res.ext.h)}) is bigger than the ${mat[1]}.` + (alt ? ` <button data-rot="${alt[0]}">${alt[0] ? 'Rotate 45° to fit' : 'Fits unrotated'}</button>` : '') +
      ` Make it smaller, or choose your own mat under Template. <button data-goto="size">Open Size</button>`);
  }
  if (Math.min(hole, ihole) < 2.3) res.warnings.push('Holes under about 2.3 mm can tear the template material: cut slowly or with 2 passes, or use a bigger stone.');
  if (natural.missing.length) {
    const m = natural.missing, one = m.length === 1;
    res.warnings.push(`This font has no ${m.slice(0, 8).map(c => '“' + esc(c) + '”').join(', ')}${m.length > 8 ? ' and ' + (m.length - 8) + ' more' : ''}: ${one ? 'it was' : 'they were'} left out. Pick another font under <button data-goto="text">Text</button> or change the text.`);
  }
  res.ms = performance.now() - t0;
  built = res;
  draw(); updateStats();
}

/* ---------- view ---------- */
const cv = $('view'), ctx = cv.getContext('2d');
const RW = 42, RB = 30; // ruler sizes (css px)
let vz = 4, vox = 0, voy = 0, userView = false, lastExt = null, dpr = 1;
const U = () => P.units === 'in' ? 25.4 : 1;
function resize() {
  dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  if (!userView) fit(); else draw();
}
function fit() {
  if (!built) return;
  const r = cv.getBoundingClientRect(), w = Math.max(10, built.ext.w), h = Math.max(10, built.ext.h);
  if (r.width < 700) {
    // phone: use the full width, and sit the design in the middle of the preview
    vz = Math.min((r.width - RW - 16) / w, (r.height - RB - 24) / h);
    vox = RW + 8; voy = Math.min(r.height - RB - 10, (r.height - RB) / 2 + h * vz / 2);
  } else {
    vz = Math.min((r.width - RW - 50) / w, (r.height - RB - 90) / h);
    vox = RW + 18; voy = r.height - RB - 18;
  }
  userView = false;
  draw();
}
const sX = x => vox + x * vz, sY = y => voy - y * vz;
let sprite = null, spriteKey = '';
function gemSprite(col) {
  if (spriteKey === col) return sprite;
  const n = 64, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), R = n / 2 - 1;
  const base = g.createRadialGradient(n * 0.38, n * 0.35, R * 0.1, n / 2, n / 2, R);
  base.addColorStop(0, '#ffffff'); base.addColorStop(0.35, col); base.addColorStop(1, shade(col, -0.45));
  g.fillStyle = base; g.beginPath(); g.arc(n / 2, n / 2, R, 0, 7); g.fill();
  // facets
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.2;
  g.beginPath();
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; g.moveTo(n / 2 + Math.cos(a) * R * 0.45, n / 2 + Math.sin(a) * R * 0.45); g.lineTo(n / 2 + Math.cos(a) * R * 0.95, n / 2 + Math.sin(a) * R * 0.95); }
  g.stroke();
  g.beginPath();
  for (let i = 0; i <= 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8, x = n / 2 + Math.cos(a) * R * 0.45, y = n / 2 + Math.sin(a) * R * 0.45; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(n * 0.36, n * 0.33, R * 0.13, 0, 7); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1; g.beginPath(); g.arc(n / 2, n / 2, R, 0, 7); g.stroke();
  sprite = c; spriteKey = col;
  return c;
}
function shade(hex, f) {
  const v = parseInt(hex.slice(1), 16), ch = s => Math.round(Math.min(255, Math.max(0, f < 0 ? s * (1 + f) : s + (255 - s) * f)));
  return '#' + [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(s => ch(s).toString(16).padStart(2, '0')).join('');
}
function niceStep(pxPerUnit, minPx, steps) { for (const s of steps) if (s * pxPerUnit >= minPx) return s; return steps.at(-1); }
function draw() {
  const r = cv.getBoundingClientRect(), W = r.width, H = r.height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#20232c'; ctx.fillRect(0, 0, W, H);
  if (!built) return;
  const u = U(), zu = vz * u;
  const STEPS = P.units === 'in' ? [0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 6, 12, 24, 48] : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
  const major = niceStep(zu, 55, STEPS);
  const minor = P.units === 'in' ? niceStep(zu, 6, STEPS.filter(s => s < major && major / s === Math.round(major / s))) : niceStep(zu, 6, STEPS.filter(s => s < major && (major / s) % 1 === 0));
  // mat
  const mat = MATS.find(m => m[0] === P.mat);
  if (mat[2]) {
    ctx.fillStyle = '#272b35'; ctx.fillRect(sX(0), sY(mat[3]), mat[2] * vz, mat[3] * vz);
    ctx.strokeStyle = '#4a5162'; ctx.lineWidth = 1; ctx.strokeRect(sX(0) + 0.5, sY(mat[3]) + 0.5, mat[2] * vz, mat[3] * vz);
  }
  // grid
  if (P.showGrid) {
    const gx0 = Math.floor((RW - vox) / zu / major) * major, gx1 = (W - vox) / zu, gy0 = Math.floor((voy - (H - RB)) / zu / major) * major, gy1 = voy / zu;
    ctx.lineWidth = 1;
    for (const [step, col] of [[minor, '#2a2e39'], [major, '#363b48']]) {
      if (!step || step * zu < 6) continue;
      ctx.strokeStyle = col; ctx.beginPath();
      for (let v = Math.floor(gx0 / step) * step; v <= gx1; v += step) { const X = Math.round(sX(v * u)) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, H); }
      for (let v = Math.floor(gy0 / step) * step; v <= gy1; v += step) { const Y = Math.round(sY(v * u)) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(W, Y); }
      ctx.stroke();
    }
  }
  const [shx, shy] = built.shift, mirror = P.mirror ? built.ext.w : null;
  const tx = x => sX(mirror !== null ? mirror - (x + shx) : x + shx), ty = y => sY(y + shy);
  // border / template material
  const hole = built.hole;
  if (P.border || P.view === 'template') {
    const m = P.border ? 0 : 2;
    ctx.fillStyle = P.view === 'template' ? '#3b3442' : 'rgba(255,255,255,0.03)';
    ctx.fillRect(sX(-m), sY(built.ext.h + m), (built.ext.w + 2 * m) * vz, (built.ext.h + 2 * m) * vz);
    if (P.border) { ctx.strokeStyle = '#e07bb6'; ctx.lineWidth = 1.2; ctx.strokeRect(sX(0), sY(built.ext.h), built.ext.w * vz, built.ext.h * vz); }
  }
  // outlines
  if (P.showOutline && built.outlines.length) {
    ctx.beginPath();
    for (const c of built.outlines) c.forEach(([x, y], i) => i ? ctx.lineTo(tx(x), ty(y)) : ctx.moveTo(tx(x), ty(y)));
    ctx.closePath();
    ctx.fillStyle = P.view === 'template' ? 'rgba(255,255,255,0.04)' : 'rgba(201,87,154,0.10)'; ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(224,123,182,0.55)'; ctx.lineWidth = 1; ctx.stroke();
  }
  // stones / holes
  if (P.view === 'template') {
    ctx.fillStyle = '#20232c'; ctx.strokeStyle = '#d9d2e3'; ctx.lineWidth = Math.min(1.2, Math.max(0.5, hole / 2 * vz / 6));
    ctx.beginPath();
    for (const s of built.stones) { const X = tx(s[0]), Y = ty(s[1]), rp = s[3] * vz; ctx.moveTo(X + rp, Y); ctx.arc(X, Y, rp, 0, 7); }
    ctx.fill(); ctx.stroke();
  } else {
    const col = COLOURS.find(c => c[0] === P.colour)[2], spr = gemSprite(col);
    for (const s of built.stones) {
      const X = tx(s[0]), Y = ty(s[1]), sr = (s[3] - P.allow / 2) * vz;
      if (sr < 1.5) { ctx.fillStyle = col; ctx.fillRect(X - 1, Y - 1, 2, 2); }
      else ctx.drawImage(spr, X - sr, Y - sr, 2 * sr, 2 * sr);
      if (s[4]) { ctx.strokeStyle = '#7ee0a0'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X, Y, sr + 1.5, 0, 7); ctx.stroke(); }
    }
  }
  // rulers
  ctx.fillStyle = '#181a20'; ctx.fillRect(0, 0, RW, H); ctx.fillRect(0, H - RB, W, RB);
  ctx.strokeStyle = '#596075'; ctx.fillStyle = '#aab0bf'; ctx.font = '11px system-ui, sans-serif'; ctx.lineWidth = 1;
  const label = v => P.units === 'in' ? (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) + '"' : +v.toFixed(3) + '"') : String(+v.toFixed(1));
  ctx.beginPath();
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let v = Math.floor(((RW - vox) / zu) / minor) * minor; v <= (W - vox) / zu; v += minor) {
    const X = Math.round(sX(v * u)) + 0.5; if (X < RW) continue;
    const isMaj = Math.abs(v / major - Math.round(v / major)) < 1e-6, half = Math.abs(v / (major / 2) - Math.round(v / (major / 2))) < 1e-6;
    const len = isMaj ? 12 : half ? 8 : 4;
    ctx.moveTo(X, H - RB); ctx.lineTo(X, H - RB + len);
    if (isMaj) ctx.fillText(label(v), X, H - RB + 13);
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = Math.floor(((voy - (H - RB)) / zu) / minor) * minor; v <= voy / zu; v += minor) {
    const Y = Math.round(sY(v * u)) + 0.5; if (Y > H - RB) continue;
    const isMaj = Math.abs(v / major - Math.round(v / major)) < 1e-6, half = Math.abs(v / (major / 2) - Math.round(v / (major / 2))) < 1e-6;
    const len = isMaj ? 12 : half ? 8 : 4;
    ctx.moveTo(RW, Y); ctx.lineTo(RW - len, Y);
    if (isMaj) { ctx.save(); ctx.translate(RW - 15, Y); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(label(v), 0, 0); ctx.restore(); }
  }
  ctx.stroke();
  // design extent markers on the rulers
  ctx.fillStyle = 'rgba(224,123,182,0.35)';
  ctx.fillRect(Math.max(RW, sX(0)), H - RB, Math.max(0, sX(built.ext.w) - Math.max(RW, sX(0))), 3);
  ctx.fillRect(RW - 3, sY(built.ext.h), 3, Math.max(0, Math.min(H - RB, sY(0)) - sY(built.ext.h)));
  ctx.fillStyle = '#181a20'; ctx.fillRect(0, H - RB, RW, RB);
  ctx.fillStyle = '#7d8495'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(P.units === 'in' ? 'in' : 'mm', RW / 2, H - RB / 2);
}
// the patterns as the list names them, and what each one looks like
const PATTERNS = {
  auto: ['Automatic', 'A single row for thin letters, an outline with rows inside for bold ones.'],
  centre: ['Single row', 'One row of stones down the middle of each stroke. Best for thin fonts and small text.'],
  outline: ['Outline only', 'One row of stones around the edge of each letter, with the inside left empty.'],
  flow: ['Outline + rows along the letter', 'A row around the edge of each letter, then rows that follow the letter\'s shape through the middle.'],
  rings: ['Outline + rings inside', 'A row around the edge of each letter, then smaller and smaller copies of it inside, each sitting in the gaps of the one before.'],
  outhex: ['Outline + honeycomb fill', 'A row around the edge of each letter, with the inside filled in a regular honeycomb grid.'],
  hex: ['Honeycomb fill only', 'A regular honeycomb grid over the whole letter, with no row around the edge. Edges look rougher.'],
};
const fmtLen = mm => P.units === 'in' ? (mm / 25.4).toFixed(2) + ' in' : mm.toFixed(1) + ' mm';
let statsHtml = '';
function updateStats() {
  if (!built) return;
  const n = built.stones.length, ni = built.ihole !== built.hole ? built.stones.filter(s => Math.abs(s[3] * 2 - built.ihole) < 1e-6).length : 0;
  const order = k => Math.ceil(k * 1.1);
  const sizes = !n ? '' : ni
    ? `Buy about ${order(n - ni)} × ${stoneLabel(stoneD())} and ${order(ni)} × ${stoneLabel(innerD())} · ${n - ni} + ${ni} stones plus 10% spare`
    : `Buy about ${order(n)} × ${stoneLabel(stoneD())} · includes 10% spare`;
  const stats = `<b>${n}</b> stones · ${fmtLen(built.ext.w)} × ${fmtLen(built.ext.h)}${P.mirror ? ' · mirrored' : ''}` +
    (sizes ? `<br><span style="color:var(--muted);font-size:12px">${sizes}</span>` : '');
  if (stats !== statsHtml) $('stats').innerHTML = statsHtml = stats; // only on a change, so screen readers hear it once
  cv.setAttribute('aria-label', n ? `Preview of the template: ${n} stones, ${fmtLen(built.ext.w)} by ${fmtLen(built.ext.h)}` : 'Preview of the template: no stones yet');
  $('empty').hidden = !!n;
  if (!n) $('empty').textContent = P.text.trim() ? 'No stones fit this text. Try a bigger size, a smaller stone or another font.' : 'Type your text in the box above to start.';
  renderMsg();
  $('stoneInfo').textContent = `Each hole is cut this much wider than the stone, so the stones drop in easily (the hole allowance). 0.3 mm suits most template material. Holes are now ${built.hole.toFixed(2)} mm wide${ni ? ` (${built.ihole.toFixed(2)} mm inside)` : ''}, ${(built.hole + P.gap).toFixed(2)} mm from centre to centre.`;
  $('fillInfo').textContent = (P.fill === 'auto' && built.mode ? `Automatic picked “${PATTERNS[built.mode][0]}” for this font and size. ` : '') + PATTERNS[P.fill === 'auto' ? built.mode || 'auto' : P.fill][1] +
    (built.thin && n && !['auto', 'centre'].includes(P.fill) ? ' These letters are too thin for stones inside, so most patterns look alike: make the design bigger, or use a smaller stone or a bolder font.' : '');
  $('expInfo').textContent = n ? `This design: ${n} holes, ${fmtLen(built.ext.w)} × ${fmtLen(built.ext.h)}. The files are at real size: after opening one in your cutter software, check that it shows this size.` : 'Nothing to export yet: there are no stones in this design.';
  $('clearEdits').disabled = !edits.rm.length && !edits.add.length;
  const e = built.ext;
  if (!lastExt || Math.abs(lastExt.w - e.w) > 0.5 || Math.abs(lastExt.h - e.h) > 0.5) { lastExt = { ...e }; if (!userView) fit(); }
}

/* ---------- pan, zoom, edit ---------- */
let drag = null, editMode = false;
// one pointer drags the view; two pinch to zoom (and drag with the pair)
const touches = new Map();
let pinch = null;
const pinchOf = () => { const [a, b] = [...touches.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
cv.addEventListener('pointerdown', ev => {
  cv.setPointerCapture(ev.pointerId);
  touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (touches.size === 2) { pinch = pinchOf(); if (drag) drag.moved = true; return; }
  if (touches.size === 1) drag = { x: ev.clientX, y: ev.clientY, ox: vox, oy: voy, moved: false };
});
cv.addEventListener('pointermove', ev => {
  if (touches.has(ev.pointerId)) touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pinch && touches.size === 2) {
    const now = pinchOf(), r = cv.getBoundingClientRect();
    vox += now.x - pinch.x; voy += now.y - pinch.y;
    zoomAt(now.d / pinch.d, now.x - r.left, now.y - r.top);
    pinch = now;
    return;
  }
  if (!drag) return;
  const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
  if (Math.hypot(dx, dy) > 4) drag.moved = true;
  if (drag.moved) { vox = drag.ox + dx; voy = drag.oy + dy; userView = true; draw(); }
});
cv.addEventListener('pointercancel', ev => { touches.delete(ev.pointerId); pinch = null; drag = null; });
cv.addEventListener('pointerup', ev => {
  touches.delete(ev.pointerId);
  if (pinch) {
    // a finger lifted after a pinch: carry on dragging with the one left, never a tap
    pinch = null;
    const rest = [...touches.values()][0];
    drag = rest ? { x: rest.x, y: rest.y, ox: vox, oy: voy, moved: true } : null;
    return;
  }
  const d = drag; drag = null;
  if (!d || d.moved || !editMode || !built) return;
  const r = cv.getBoundingClientRect(), X = ev.clientX - r.left, Y = ev.clientY - r.top;
  let x = (X - vox) / vz, y = (voy - Y) / vz;
  if (P.mirror) x = built.ext.w - x;
  x -= built.shift[0]; y -= built.shift[1];
  if (built.rot) { const c = Math.cos(built.rot), s = Math.sin(built.rot); [x, y] = [x * c + y * s, -x * s + y * c]; }
  let best = null, bd = built.hole / 2;
  for (const s of built.stones) { const dd = Math.hypot(s[0] - x, s[1] - y); if (dd <= bd) { bd = dd; best = s; } }
  if (best) {
    if (best[4]) edits.add = edits.add.filter(a => Math.hypot(a[0] - best[0], a[1] - best[1]) > 1e-6);
    else edits.rm.push([best[0], best[1]]);
  } else edits.add.push([+x.toFixed(3), +y.toFixed(3)]);
  changed(true);
  clearTimeout(snapTimer); snap(); // every click is its own undo step
});
cv.addEventListener('wheel', ev => {
  ev.preventDefault();
  const r = cv.getBoundingClientRect();
  zoomAt(Math.exp(-ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top);
}, { passive: false });
function zoomAt(f, X, Y) {
  const nz = Math.min(200, Math.max(0.05, vz * f)); f = nz / vz;
  vox = X - (X - vox) * f; voy = Y - (Y - voy) * f; vz = nz; userView = true; draw();
}
const zoomCentre = f => { const r = cv.getBoundingClientRect(); zoomAt(f, r.width / 2, r.height / 2); };
$('zoomIn').onclick = () => zoomCentre(1.3);
$('zoomOut').onclick = () => zoomCentre(1 / 1.3);
$('fitBtn').onclick = fit;
$('editBtn').onclick = () => {
  editMode = !editMode; $('editBtn').classList.toggle('on', editMode); $('editBtn').setAttribute('aria-pressed', editMode);
  const touch = matchMedia('(pointer: coarse)').matches, v = touch ? 'tap' : 'click';
  $('editHint').textContent = `Edit mode: ${v} a stone to remove it, ${v} empty space to add one.` + (touch ? ' Pinch to zoom in first.' : ' Esc to finish.');
  $('editHint').hidden = !editMode; cv.style.cursor = editMode ? 'crosshair' : '';
};
$('clearEdits').onclick = () => { edits = { rm: [], add: [] }; changed(true); };
$('viewBtn').onclick = () => { P.view = P.view === 'template' ? 'stones' : 'template'; syncUi(); changed(false, true); };
new ResizeObserver(() => resize()).observe(cv);

/* ---------- messages ---------- */
// notices sit under the build warnings in #msg until they are dismissed, replaced or time out
const notices = new Map(), noticeTimers = {}; // key -> html
const INFO = ['hello', 'saved', 'reset']; // notices that are help, not warnings
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let msgHtml = '';
function renderMsg() {
  const h = (built?.warnings || []).map(w => `<div>${w}</div>`).join('') +
    [...notices].map(([k, n]) => `<div${INFO.includes(k) ? ' class="info"' : ''}>${n}<button data-x="${k}" aria-label="Dismiss this message">×</button></div>`).join('');
  if (h !== msgHtml) $('msg').innerHTML = msgHtml = h;
}
function notice(key, html, ms = 0) {
  notices.set(key, html); renderMsg();
  clearTimeout(noticeTimers[key]);
  if (ms) noticeTimers[key] = setTimeout(() => clearNotice(key), ms);
}
function clearNotice(key) {
  clearTimeout(noticeTimers[key]);
  if (key === 'hello' && notices.has(key)) try { localStorage.setItem('sparkleflock.seen', '1'); } catch {} // the welcome shows until first use
  if (notices.delete(key)) renderMsg();
}
const say = t => { $('live').textContent = ''; setTimeout(() => $('live').textContent = t, 50); }; // for screen readers only

/* ---------- UI binding ---------- */
const sliders = ['letterSp', 'wordSp', 'lineSp', 'custom', 'allow', 'gap', 'inset', 'bold', 'borderM'];
function fillSelects() {
  const fs = $('font'), groups = {};
  for (const [id, name, grp] of window.FONT_LIST) (groups[grp] ||= []).push([id, name]);
  for (const [grp, list] of Object.entries(groups)) {
    const og = document.createElement('optgroup'); og.label = grp;
    for (const [id, name] of list) og.appendChild(new Option(name, id));
    fs.appendChild(og);
  }
  for (const s of STONES) $('stone').appendChild(new Option(s[1], s[0]));
  $('inner').appendChild(new Option('Same as the outline row', 'same'));
  for (const s of STONES) if (s[0] !== 'custom') $('inner').appendChild(new Option(s[1], s[0]));
  for (const m of MATS) $('mat').appendChild(new Option(m[1], m[0]));
  for (const [id, name, col] of COLOURS) {
    const b = document.createElement('button'); b.title = name; b.style.background = col; b.dataset.v = id; b.setAttribute('aria-label', name);
    b.onclick = () => { P.colour = id; syncUi(); changed(false, true); };
    $('colours').appendChild(b);
  }
}
function widthOf() { return natural?.b ? natural.b.w * (P.height / natural.b.h) * P.stretch : 0; }
function syncUi() {
  for (const k of ['text', 'font', 'stone', 'inner', 'fill', 'mat', 'rotate']) if ($(k).value !== String(P[k])) $(k).value = P[k];
  for (const k of ['lock', 'border', 'expOutline', 'mirror', 'showOutline', 'showGrid']) $(k).checked = !!P[k];
  for (const k of sliders) {
    const v = k === 'borderM' ? +(P[k] / U()).toFixed(3) : P[k];
    if (document.activeElement !== $(k)) $(k).value = v;
    $(k + 'R').value = P[k];
  }
  if (document.activeElement !== $('height')) $('height').value = +(P.height / U()).toFixed(P.units === 'in' ? 3 : 1);
  if (document.activeElement !== $('width')) $('width').value = +(widthOf() / U()).toFixed(P.units === 'in' ? 3 : 1);
  // size sliders work in the current units
  const inch = P.units === 'in';
  Object.assign($('heightR'), inch ? { min: 0.2, max: 12, step: 0.05 } : { min: 5, max: 300, step: 0.5 });
  Object.assign($('widthR'), inch ? { min: 0.4, max: 40, step: 0.05 } : { min: 10, max: 1000, step: 1 });
  if (document.activeElement !== $('heightR')) $('heightR').value = P.height / U();
  if (document.activeElement !== $('widthR')) $('widthR').value = widthOf() / U();
  for (const el of document.querySelectorAll('.unit')) el.textContent = P.units;
  // the text box grows with the lines typed, up to three, so a second line stays in sight
  { const t = $('text'), n = Math.min(3, P.text.split('\n').length); t.style.height = n > 1 ? n * parseFloat(getComputedStyle(t).lineHeight) + 18 + 'px' : ''; }
  $('customRow').hidden = P.stone !== 'custom';
  $('borderRow').hidden = !P.border;
  $('stretchRow').hidden = P.stretch === 1;
  // an Advanced group says how many of its settings are changed, and opens when a link, undo or reset changes one
  for (const [id, keys] of Object.entries(ADVANCED)) {
    const d = $(id), c = keys.filter(k => P[k] !== DEF[k]).length;
    d.querySelector('.n').textContent = c ? ` (${c} changed)` : '';
    if (c > (+d.dataset.n || 0)) d.open = true;
    d.dataset.n = c;
  }
  const press = (b, on) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); };
  for (const b of $('alignSeg').children) press(b, b.dataset.v === P.align);
  for (const b of $('unitSeg').children) press(b, b.dataset.v === P.units);
  for (const b of $('colours').children) press(b, b.dataset.v === P.colour);
  $('fontNote').hidden = P.font !== '__custom';
  $('alignSeg').parentElement.hidden = !P.text.includes('\n');
  $('viewBtn').innerHTML = P.view === 'template' ? '<span class="w">Show stones</span><span class="nar">Stones</span>' : '<span class="w">Show holes</span><span class="nar">Holes</span>';
  press($('viewBtn'), P.view === 'template');
  syncResets();
}
const ADVANCED = { advStones: ['inner', 'allow', 'inset', 'bold'], advTemplate: ['expOutline', 'mirror'] };
let timer = null;
// geometry: rebuild stones; display-only changes just redraw
// small ↺ button beside every setting that differs from its default; click to put it back
const RESETS = [ // [control id, settings reset by it]
  ['font', ['font']], ['alignSeg', ['align']], ['letterSp', ['letterSp']], ['wordSp', ['wordSp']], ['lineSp', ['lineSp']],
  ['unitSeg', ['units']], ['width', ['stretch']], ['height', ['height']], ['lock', ['lock']],
  ['stone', ['stone']], ['inner', ['inner']], ['custom', ['custom']], ['allow', ['allow']], ['gap', ['gap']], ['fill', ['fill']],
  ['inset', ['inset']], ['bold', ['bold']], ['mat', ['mat']], ['rotate', ['rotate']], ['border', ['border']], ['borderM', ['borderM']],
  ['expOutline', ['expOutline']], ['mirror', ['mirror']], ['showOutline', ['showOutline']], ['showGrid', ['showGrid']], ['colours', ['colour']],
];
const VIEW_ONLY = ['showOutline', 'showGrid', 'colour', 'units', 'lock', 'expOutline'];
function addResets() {
  for (const [id, keys] of RESETS) {
    const row = $(id).closest('.row, .check');
    if (!row) continue;
    const b = document.createElement('button');
    b.className = 'rst'; b.type = 'button'; b.title = 'Reset to default'; b.textContent = '↺'; b.dataset.keys = keys.join(' ');
    b.setAttribute('aria-label', `Reset ${(row.querySelector('label') || row).textContent.trim().toLowerCase()} to default`);
    b.addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      for (const k of keys) P[k] = DEF[k];
      changed(true, keys.every(k => VIEW_ONLY.includes(k)));
    });
    row.appendChild(b);
  }
}
function syncResets() {
  for (const b of document.querySelectorAll('.rst')) b.hidden = b.dataset.keys.split(' ').every(k => P[k] === DEF[k]);
}
// manual edits are positions in one particular layout. Any setting that moves the stones makes them
// land in the wrong places, so they are cleared then (undo brings them back, with the old setting).
const geoKey = () => JSON.stringify(['text', 'font', 'align', 'letterSp', 'wordSp', 'lineSp', 'height', 'stretch', 'stone', 'inner', 'custom', 'allow', 'gap', 'fill', 'inset', 'bold'].map(k => P[k]).concat(customN));
let lastGeo = '', customN = 0, editsAt = -1;
function dropStaleEdits() {
  const key = geoKey();
  if (key === lastGeo) return;
  lastGeo = key;
  if (restoring || !(edits.rm.length || edits.add.length)) return;
  const n = edits.rm.length + edits.add.length;
  edits = { rm: [], add: [] }; editsAt = hi;
  notice('edits', `${n} manual stone edit${n > 1 ? 's were' : ' was'} cleared because the layout changed.<button data-act="edits">Undo the change</button>`, 15000);
}
// one build at a time; an error is shown instead of leaving "Placing stones…" up
let building = null, busyTimer = null;
function runBuild() {
  const run = (building || Promise.resolve()).then(async () => {
    let took = '';
    try {
      await rebuild(); syncUi(); clearNotice('err');
      if (built.ms >= 500) took = `${built.ms.toFixed(0)} ms`; // the time is only worth showing when it was slow
    } catch (e) {
      console.error(e);
      notice('err', 'Could not place the stones: ' + esc(e?.message || e));
    }
    if (building === run) building = null;
    if (timer || building) return; // another build is on its way
    clearTimeout(busyTimer);
    $('busy').textContent = took;
    if (took) busyTimer = setTimeout(() => $('busy').textContent = '', 2500);
  });
  return building = run;
}
// make sure `built` matches the settings (exports must not use the build from before the last keystroke)
async function flush() {
  if (timer) { clearTimeout(timer); timer = null; await runBuild(); }
  else if (building) await building;
}
function changed(geometry = true, displayOnly = false) {
  clearNotice('saved'); // it describes the file as it was downloaded
  dropStaleEdits();
  syncUi(); save(); scheduleSnap();
  if (displayOnly || !geometry) { draw(); updateStats(); return; }
  clearTimeout(timer); clearTimeout(busyTimer);
  $('busy').textContent = 'Placing stones…';
  timer = setTimeout(() => { timer = null; runBuild(); }, 120);
}
function bind() {
  $('text').addEventListener('input', () => { P.text = $('text').value; clearNotice('hello'); changed(); });
  for (const k of ['font', 'stone', 'inner', 'fill', 'mat']) $(k).addEventListener('change', () => { P[k] = $(k).value; changed(); });
  $('rotate').addEventListener('change', () => { P.rotate = +$('rotate').value; changed(); });
  // the button in the mat warning
  $('msg').addEventListener('click', ev => {
    const { rot, x, act } = ev.target.dataset || {};
    if (rot !== undefined) { P.rotate = +rot; syncUi(); changed(); }
    if (x) clearNotice(x);
    if (act === 'edits') { clearNotice('edits'); if (editsAt >= 0) restore(editsAt); }
    if (act === 'undo') { clearNotice('reset'); undo(); }
  });
  // buttons that open a settings tab (in warnings and in the panel)
  document.addEventListener('click', ev => {
    const id = ev.target.closest?.('[data-goto]')?.dataset.goto;
    if (!id) return;
    if ($('app').classList.contains('collapsed') || $('app').dataset.tab !== id) showTab(id);
    $('panel').scrollTop = 0; $('tab-' + id).focus();
  });
  for (const k of ['lock', 'border', 'expOutline', 'mirror']) $(k).addEventListener('change', () => { P[k] = $(k).checked; changed(k === 'border' || k === 'mirror', k === 'expOutline'); });
  for (const k of ['showOutline', 'showGrid']) $(k).addEventListener('change', () => { P[k] = $(k).checked; changed(false, true); });
  for (const k of sliders) {
    // typed values are held to the slider's range, as values from a link are
    const R = $(k + 'R'), set = v => { if (isFinite(v)) { P[k] = Math.min(+R.max, Math.max(+R.min, v)); changed(); } };
    $(k + 'R').addEventListener('input', () => set(+$(k + 'R').value));
    $(k).addEventListener('input', () => { if ($(k).value !== '') set(k === 'borderM' ? +$(k).value * U() : +$(k).value); });
    $(k).addEventListener('change', () => { $(k).value = k === 'borderM' ? +(P[k] / U()).toFixed(3) : P[k]; });
  }
  // the label of a slider row names the slider; give the number box beside it the same name
  for (const row of document.querySelectorAll('.row')) {
    const num = row.querySelector('input[type=number]'), lab = row.querySelector('label');
    if (num && lab) num.setAttribute('aria-label', lab.textContent.trim());
  }
  $('height').addEventListener('input', () => {
    const h = +$('height').value * U(); if (!(h > 0)) return;
    if (!P.lock && natural?.b) { const w = widthOf(); P.height = h; P.stretch = w / (natural.b.w * h / natural.b.h); }
    else P.height = h;
    changed();
  });
  $('width').addEventListener('input', () => {
    const w = +$('width').value * U(); if (!(w > 0) || !natural?.b) return;
    const nat = natural.b.w / natural.b.h; // width per mm of height at stretch 1
    if (P.lock) P.height = w / (nat * P.stretch); else P.stretch = w / (nat * P.height);
    changed();
  });
  for (const k of ['width', 'height']) $(k + 'R').addEventListener('input', () => { $(k).value = $(k + 'R').value; $(k).dispatchEvent(new Event('input')); });
  $('expSvgTop').onclick = exportSvg;
  // settings tabs in the top bar: click a tab to show its pane, click the open tab (or ▴) to hide the panel
  const showTab = id => {
    const app = $('app'), cur = app.classList.contains('collapsed') ? null : app.dataset.tab;
    if (id && id === cur) id = null;
    app.classList.toggle('collapsed', !id);
    if (id) app.dataset.tab = id;
    // one tab stop for the row of tabs: the open tab, or the last one used while the panel is hidden
    document.querySelectorAll('#tabs [data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === id); b.setAttribute('aria-selected', b.dataset.tab === id); b.tabIndex = b.dataset.tab === (id || app.dataset.tab || 'text') ? 0 : -1; });
    document.querySelectorAll('.pane').forEach(s => s.hidden = s.dataset.tab !== id);
    try { localStorage.setItem('sparkleflock.tab', id || ''); } catch {}
  };
  document.querySelectorAll('#tabs [data-tab]').forEach(b => b.addEventListener('click', () => { clearNotice('hello'); showTab(b.dataset.tab); }));
  $('tabHide').onclick = () => showTab(null);
  $('tabs').addEventListener('keydown', ev => {
    const tabs = [...document.querySelectorAll('#tabs [data-tab]')], i = tabs.indexOf(ev.target), n = tabs.length;
    const j = i < 0 ? -1 : ev.key === 'ArrowRight' ? (i + 1) % n : ev.key === 'ArrowLeft' ? (i + n - 1) % n : ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : -1;
    if (j < 0 || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    ev.preventDefault();
    if (!tabs[j].classList.contains('on')) showTab(tabs[j].dataset.tab);
    tabs[j].focus();
  });
  // on a phone the settings start closed, so the preview has the screen
  { let t0 = matchMedia('(max-width: 700px)').matches ? '' : 'text'; try { const s = localStorage.getItem('sparkleflock.tab'); if (s !== null) t0 = s; } catch {} showTab(t0 || null); }
  $('resetStretch').onclick = () => { P.stretch = 1; changed(); };
  for (const b of $('alignSeg').children) b.onclick = () => { P.align = b.dataset.v; changed(); };
  for (const b of $('unitSeg').children) b.onclick = () => { P.units = b.dataset.v; changed(false, true); };
  $('fontUpBtn').onclick = () => $('fontFile').click();
  $('fontFile').onchange = async () => {
    const f = $('fontFile').files[0]; if (!f) return;
    $('fontFile').value = ''; // so picking the same file again still fires a change
    try {
      customFont = opentype.parse(await f.arrayBuffer());
      const fs = $('font'); fs.querySelector('option[value="__custom"]')?.remove();
      fs.insertBefore(new Option('Uploaded: ' + (customFont.names.fullName?.en || f.name), '__custom'), fs.firstChild);
      P.font = '__custom'; glyphCache.clear(); customN++; clearNotice('font'); changed();
    } catch (e) { notice('font', `“${esc(f.name)}” could not be read as a font (${esc(e?.message || e)}). Use a .ttf, .otf or .woff file; the font you had is still in use.`); }
  };
  $('resetAll').onclick = () => {
    clearTimeout(snapTimer); snap(); // the design as it was is one undo step away
    P = { ...DEF, units: P.units }; edits = { rm: [], add: [] }; userView = false; changed();
    clearTimeout(snapTimer); snap();
    notice('reset', 'All settings are back to their defaults.<button data-act="undo">Undo</button>', 15000);
  };
  $('copyLink').onclick = async () => {
    save();
    try { await navigator.clipboard.writeText(location.href); $('copyLink').textContent = 'Copied!'; say('Link copied'); }
    catch { prompt('Copy this link:', location.href); }
    setTimeout(() => $('copyLink').innerHTML = '<span class="w">Copy&nbsp;</span>link', 1500);
  };
  $('expSvg').onclick = exportSvg; $('expDxf').onclick = exportDxf; $('expPng').onclick = exportPng;
  $('expZip').onclick = exportZip; $('expAll').onclick = exportAll; $('expShare').onclick = shareFiles;
  $('expShare').hidden = $('shareNote').hidden = !canShareFiles(); $('shareHint').hidden = canShareFiles();
  $('undo').onclick = undo; $('redo').onclick = redo;
  // shortcut help
  const help = $('help');
  const toggleHelp = () => { if (help.open) help.close(); else help.showModal(); };
  $('helpBtn').onclick = $('helpTips').onclick = toggleHelp;
  $('helpClose').onclick = () => help.close();
  help.addEventListener('click', ev => { if (ev.target === help) help.close(); }); // a click on the backdrop
  addEventListener('keydown', ev => {
    // typing: only where keys write text or pick an option; a checkbox, slider or radio leaves the shortcuts alone
    const a = document.activeElement;
    const typing = !!a && (a.isContentEditable || /^(SELECT|TEXTAREA)$/.test(a.tagName) || (a.tagName === 'INPUT' && !/^(checkbox|radio|range|button|submit|reset|file|color|image)$/.test(a.type)));
    if (help.open) { if (ev.key === 'Escape' || ev.key === '?') { ev.preventDefault(); help.close(); } return; }
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 's') { ev.preventDefault(); exportSvg(); return; }
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 'z' && !typing) { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y' && !typing) { ev.preventDefault(); redo(); return; }
    if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === '+' || ev.key === '=') zoomCentre(1.3);
    else if (ev.key === '-' || ev.key === '_') zoomCentre(1 / 1.3);
    else if (ev.key === '0') fit();
    else if (ev.key === 'Escape' && editMode) $('editBtn').click();
    else if (ev.key === '?') { ev.preventDefault(); toggleHelp(); }
    else if (ev.key.toLowerCase() === 'e') $('editBtn').click();
  });
}

/* ---------- undo / redo ---------- */
let hist = [], hi = -1, snapTimer = null, restoring = false;
function snap() {
  const s = JSON.stringify({ P, edits });
  if (hist[hi] === s) return;
  hist = hist.slice(0, hi + 1); hist.push(s);
  if (hist.length > 200) hist.shift();
  hi = hist.length - 1; updUndo();
}
function scheduleSnap() { if (restoring) return; clearTimeout(snapTimer); snapTimer = setTimeout(snap, 400); }
function restore(to) {
  clearTimeout(snapTimer); snap();
  if (to < 0 || to >= hist.length) return;
  hi = to; const s = JSON.parse(hist[hi]);
  restoring = true; P = { ...DEF, ...s.P }; edits = s.edits; clearNotice('edits'); changed(); restoring = false; updUndo();
}
const undo = () => restore(hi - 1), redo = () => restore(hi + 1);
function updUndo() { $('undo').disabled = hi <= 0; $('redo').disabled = hi >= hist.length - 1; }

/* ---------- persistence ---------- */
// manual edits in the link, as `e`: the removed points, `_`, the added points; each list is x.y.x.y...
// in 1/100 mm. An uploaded font can't travel, so only its name goes along (`cf`) to explain the fallback.
const packEdits = () => [edits.rm, edits.add].map(l => l.map(p => Math.round(p[0] * 100) + '.' + Math.round(p[1] * 100)).join('.')).join('_');
function unpackEdits(str) {
  const [rm = [], add = []] = String(str).split('_').map(l => {
    const n = l.split('.').filter(Boolean).map(Number), out = [];
    for (let i = 0; i + 1 < n.length && out.length < 5000; i += 2) if (isFinite(n[i]) && isFinite(n[i + 1])) out.push([n[i] / 100, n[i + 1] / 100]);
    return out;
  });
  return { rm, add };
}
const cleanEdits = e => { const ok = l => (Array.isArray(l) ? l : []).filter(p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) && typeof p[0] === 'number' && typeof p[1] === 'number').map(p => [p[0], p[1]]); return { rm: ok(e?.rm), add: ok(e?.add) }; };
const customName = () => customFont?.names?.fullName?.en || 'uploaded font';
let lostFont = ''; // name of an uploaded font that the saved design used
let stored = false; // this browser holds a design from an earlier visit
function save() {
  const sp = new URLSearchParams(), custom = P.font === '__custom';
  for (const [k, v] of Object.entries(P)) if (v !== DEF[k] && k !== 'view' && !(k === 'font' && v === '__custom')) sp.set(k, typeof v === 'boolean' ? (v ? 1 : 0) : v);
  if (custom) sp.set('cf', customName());
  if (edits.rm.length || edits.add.length) sp.set('e', packEdits());
  history.replaceState(null, '', '#' + sp.toString());
  try { localStorage.setItem('sparkleflock.v1', JSON.stringify({ P: { ...P, font: custom ? DEF.font : P.font }, edits, customFont: custom ? customName() : undefined })); } catch {}
}
function readHash() {
  if (location.hash.length < 2) return false;
  const sp = new URLSearchParams(location.hash.slice(1)), p = { ...DEF };
  if (sp.has('e')) edits = unpackEdits(sp.get('e'));
  if (sp.has('cf')) lostFont = sp.get('cf').slice(0, 80);
  for (const [k, v] of sp) {
    if (!(k in DEF)) continue;
    p[k] = typeof DEF[k] === 'boolean' ? v === '1' : typeof DEF[k] === 'number' ? (isFinite(+v) ? +v : DEF[k]) : v;
  }
  P = p; return true;
}
function load() {
  try { const s = JSON.parse(localStorage.getItem('sparkleflock.v1')); if (s) { stored = true; P = { ...DEF, ...s.P }; edits = cleanEdits(s.edits); if (typeof s.customFont === 'string') lostFont = s.customFont.slice(0, 80); } } catch {}
}
function sanitize() {
  // a link or old storage can hold anything: wrong types go back to the default, numbers into their control's range
  for (const k in P) if (!(k in DEF)) delete P[k];
  for (const k in DEF) if (typeof P[k] !== typeof DEF[k] || (typeof P[k] === 'number' && !isFinite(P[k]))) P[k] = DEF[k];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  for (const k of sliders) P[k] = clamp(P[k], +$(k + 'R').min, +$(k + 'R').max);
  if (!['left', 'center', 'right'].includes(P.align)) P.align = DEF.align;
  if (!['mm', 'in'].includes(P.units)) P.units = DEF.units;
  if (!['stones', 'template'].includes(P.view)) P.view = DEF.view;
  if (!window.FONT_LIST.some(f => f[0] === P.font)) P.font = DEF.font;
  if (!STONES.some(s => s[0] === P.stone)) P.stone = DEF.stone;
  if (P.inner !== 'same' && !STONES.some(s => s[0] === P.inner && s[0] !== 'custom')) P.inner = DEF.inner;
  if (!MATS.some(m => m[0] === P.mat)) P.mat = DEF.mat;
  if (!COLOURS.some(c => c[0] === P.colour)) P.colour = DEF.colour;
  if (!(P.height > 0)) P.height = DEF.height;
  if (!(P.stretch > 0)) P.stretch = 1;
  P.height = clamp(P.height, 1, 2000); P.stretch = clamp(P.stretch, 0.02, 50);
  if (![0, 45, 90, -45].includes(P.rotate)) P.rotate = 0;
  if (P.fill === 'packed') P.fill = 'rings';
  if (![...$('fill').options].some(o => o.value === P.fill)) P.fill = DEF.fill;
}

/* ---------- export ---------- */
function exportGeometry() {
  // stones and outlines in final sheet coordinates (origin bottom-left, mirrored if asked)
  const [sx, sy] = built.shift, W = built.ext.w;
  const X = x => P.mirror ? W - (x + sx) : x + sx, Y = y => y + sy;
  return {
    stones: built.stones.map(s => [X(s[0]), Y(s[1]), s[3]]),
    outlines: built.outlines.map(c => c.map(([x, y]) => [X(x), Y(y)])),
    W, H: built.ext.h, r: built.hole / 2,
  };
}
const fileBase = () => 'rhinestone_' + (P.text.trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}\p{M}_-]/gu, '').slice(0, 30) || 'template');
function download(name, data, type) {
  const a = document.createElement('a'), url = URL.createObjectURL(new Blob([data], { type }));
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const f3 = v => +v.toFixed(3);
function makeSvg() {
  const g = exportGeometry(), H = g.H;
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${f3(g.W)}mm" height="${f3(H)}mm" viewBox="0 0 ${f3(g.W)} ${f3(H)}">\n`;
  s += `<!-- ${built.stones.length} holes: ${f3(built.hole)} mm (${stoneName(stoneD())} + ${P.allow} mm)${built.ihole !== built.hole ? `, inner ${f3(built.ihole)} mm (${stoneName(innerD())} + ${P.allow} mm)` : ''}. Made with Sparkleflock. -->\n`;
  if (P.expOutline) {
    s += '<g id="letter-outlines" fill="none" stroke="#c9579a" stroke-width="0.2">\n';
    for (const c of g.outlines) s += `<path d="M${c.map(([x, y]) => f3(x) + ' ' + f3(H - y)).join(' L')} Z"/>\n`;
    s += '</g>\n';
  }
  if (P.border) s += `<rect id="border" x="0" y="0" width="${f3(g.W)}" height="${f3(H)}" fill="none" stroke="#000" stroke-width="0.2"/>\n`;
  s += '<g id="rhinestone-holes" fill="#000">\n';
  for (const [x, y, r] of g.stones) s += `<circle cx="${f3(x)}" cy="${f3(H - y)}" r="${f3(r)}"/>\n`;
  s += '</g>\n</svg>\n';
  return s;
}
function makeDxf() {
  const g = exportGeometry(), L = [];
  const add = (...kv) => { for (let i = 0; i < kv.length; i += 2) L.push(String(kv[i]), String(kv[i + 1])); };
  add(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 4, 9, '$EXTMIN', 10, 0, 20, 0, 9, '$EXTMAX', 10, f3(g.W), 20, f3(g.H), 0, 'ENDSEC');
  add(0, 'SECTION', 2, 'ENTITIES');
  for (const [x, y, r] of g.stones) add(0, 'CIRCLE', 8, 'HOLES', 10, f3(x), 20, f3(y), 30, 0, 40, f3(r));
  const line = (layer, a, b) => add(0, 'LINE', 8, layer, 10, f3(a[0]), 20, f3(a[1]), 30, 0, 11, f3(b[0]), 21, f3(b[1]), 31, 0);
  if (P.border) { const c = [[0, 0], [g.W, 0], [g.W, g.H], [0, g.H]]; for (let i = 0; i < 4; i++) line('BORDER', c[i], c[(i + 1) % 4]); }
  if (P.expOutline) for (const c of g.outlines) for (let i = 0; i < c.length; i++) line('OUTLINES', c[i], c[(i + 1) % c.length]);
  add(0, 'ENDSEC', 0, 'EOF');
  return L.join('\r\n') + '\r\n';
}
function makePng() {
  const g = exportGeometry(), ppm = Math.min(20, 4000 / Math.max(g.W, g.H)), pad = 4;
  const c = document.createElement('canvas'); c.width = Math.ceil((g.W + 2 * pad) * ppm); c.height = Math.ceil((g.H + 2 * pad) * ppm);
  const x = c.getContext('2d'), spr = gemSprite(COLOURS.find(k => k[0] === P.colour)[2]);
  for (const [sx, sy, r] of g.stones) { const sr = (r - P.allow / 2) * ppm; x.drawImage(spr, (sx + pad) * ppm - sr, (g.H + pad - sy) * ppm - sr, 2 * sr, 2 * sr); }
  return new Promise(res => c.toBlob(res, 'image/png'));
}
// every export format, as files
const FORMATS = {
  svg: ['image/svg+xml', makeSvg], dxf: ['application/dxf', makeDxf], png: ['image/png', makePng],
};
async function exportFiles(kinds = Object.keys(FORMATS)) {
  await flush();
  if (notices.has('err')) return []; // the last build failed, so `built` is not this design
  if (!built?.stones.length) { notice('export', P.text.trim() ? 'Nothing to export: there are no stones in this design.' : 'Nothing to export yet: type some text first.', 6000); return []; }
  clearNotice('export');
  const out = [];
  for (const k of kinds) { const [type, make] = FORMATS[k]; out.push(new File([await make()], fileBase() + '.' + k, { type })); }
  return out;
}
// after a download: where the file went and what to do with it
const USE = { svg: 'Open it in Cricut Design Space (Upload) or your cutter software', dxf: 'Open it in Silhouette Studio', png: 'This is a picture to look at, not a cutting file' };
function savedNote(name, kind) {
  const size = `${fmtLen(built.ext.w)} × ${fmtLen(built.ext.h)}`;
  notice('saved', `Saved <b>${esc(name)}</b> to your downloads. ` + (kind ? USE[kind] + (kind === 'png' ? '.' : ` and check that the size is ${size}.`) : `Use the SVG or the DXF in your cutter software and check that the size is ${size}.`) +
    (kind === 'svg' ? ' <button data-goto="export">Other formats</button>' : '') + ' <button data-goto="tips">What next?</button>', 20000);
}
async function exportOne(kind) { for (const f of await exportFiles([kind])) { download(f.name, f, f.type); savedNote(f.name, kind); } }
const exportSvg = () => exportOne('svg'), exportDxf = () => exportOne('dxf'), exportPng = () => exportOne('png');
// all formats as separate downloads (browsers may ask once to allow several files)
async function exportAll() {
  const files = await exportFiles();
  for (let i = 0; i < files.length; i++) { download(files[i].name, files[i], files[i].type); await new Promise(r => setTimeout(r, 350)); }
  if (files.length) savedNote(fileBase() + ' (3 files)');
}
// a ZIP file holding the given files, stored without compression (the files are small)
async function zipFiles(files) {
  const crcT = zipFiles.t ||= Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const d = new Date(), time = d.getHours() << 11 | d.getMinutes() << 5 | d.getSeconds() >> 1, date = (d.getFullYear() - 1980) << 9 | (d.getMonth() + 1) << 5 | d.getDate();
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const data = new Uint8Array(await f.arrayBuffer()), name = enc.encode(f.name), sum = crc(data);
    const head = (sig, extra) => {
      const h = new DataView(new ArrayBuffer(extra ? 46 : 30)); let o = 0;
      const u16 = v => { h.setUint16(o, v, true); o += 2; }, u32 = v => { h.setUint32(o, v, true); o += 4; };
      u32(sig); if (extra) u16(20); u16(20); u16(0x0800); u16(0); u16(time); u16(date); u32(sum); u32(data.length); u32(data.length); u16(name.length); u16(0);
      if (extra) { u16(0); u16(0); u16(0); u32(0); u32(off); }
      return new Uint8Array(h.buffer);
    };
    const local = head(0x04034b50, false);
    central.push(head(0x02014b50, true), name);
    parts.push(local, name, data);
    off += local.length + name.length + data.length;
  }
  const csize = central.reduce((s, c) => s + c.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new File([...parts, ...central, new Uint8Array(end.buffer)], fileBase() + '.zip', { type: 'application/zip' });
}
async function exportZip() {
  const files = await exportFiles();
  if (files.length) { const z = await zipFiles(files); download(z.name, z, z.type); savedNote(z.name); }
}
// hand the files to the device's share sheet (mail, messages, cloud drives ...). Needs a browser
// that can share files, which is most phones; the ZIP is used when the loose files are refused.
const canShareFiles = () => { try { return !!navigator.canShare?.({ files: [new File(['x'], 'x.png', { type: 'image/png' })] }); } catch { return false; } };
async function shareFiles() {
  const files = await exportFiles();
  if (!files.length) return;
  const text = `Rhinestone template "${P.text.replace(/\s+/g, ' ').trim()}", ${built.stones.length} stones. Made with Sparkleflock.`;
  let pack = files;
  if (!navigator.canShare({ files: pack })) pack = [await zipFiles(files)];
  if (!navigator.canShare({ files: pack })) pack = files.filter(f => navigator.canShare({ files: [f] }));
  if (!pack.length) return;
  try { await navigator.share({ files: pack, title: 'Rhinestone template', text }); } catch {}
}

/* ---------- start ---------- */
fillSelects(); addResets(); bind();
const linked = readHash();
if (!linked) load();
// a first visit from a US browser starts in inches (the cutting mats there are sold in inches)
if (!linked && !stored && /^en-US$/i.test(navigator.language || '')) P.units = 'in';
sanitize();
lastGeo = geoKey();
if (lostFont) {
  edits = { rm: [], add: [] }; // they were placed on the other font's letters
  notice('font', `This design used the uploaded font “${esc(lostFont)}”, which is not kept in links or between visits. It is shown in ${esc(window.FONT_LIST.find(f => f[0] === P.font)?.[1] || 'a bundled font')}: upload the font again under Text to get it back.`);
}
{ let seen = stored; try { seen ||= !!localStorage.getItem('sparkleflock.seen'); } catch {}
  if (!seen && !linked) notice('hello', matchMedia('(max-width: 700px)').matches
    ? `<b>Start here:</b> type your own text over ${esc(DEF.text)} at the top, then work through the tabs at the bottom, from Text to Export.`
    : `<b>Start here:</b> type your own text over ${esc(DEF.text)} at the top. Then go through the tabs to pick the font, the size and your stones, and Export for the cutting file.`); }
$('text').value = P.text;
syncUi();
resize();
runBuild().then(() => { snap(); fit(); });
window.sparkleflock = { get built() { return built; }, get P() { return P; }, rebuild };
