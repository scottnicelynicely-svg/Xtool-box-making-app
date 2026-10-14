'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/geometry.js');

function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Seeded RNG so failures are reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Place each generated panel in 3D and check that every sampled point of the
 * box walls is covered by exactly one panel (no gaps, no overlaps).
 */
function checkShell(opts, samples = 40000) {
  const res = G.generateBox(Object.assign({}, opts, { kerf: 0 }));
  assert.deepEqual(res.errors, []);
  const { w: W, d: D, h: H } = res.info.outer;
  const t = res.info.thickness;
  const byName = Object.fromEntries(res.parts.map((p) => [p.name, p.pts]));
  const panels = [
    { pts: byName.Front, has: (x, y, z) => y < t, uv: (x, y, z) => [x, H - z] },
    { pts: byName.Back, has: (x, y, z) => y > D - t, uv: (x, y, z) => [x, H - z] },
    { pts: byName.Left, has: (x, y, z) => x < t, uv: (x, y, z) => [y, H - z] },
    { pts: byName.Right, has: (x, y, z) => x > W - t, uv: (x, y, z) => [y, H - z] },
    { pts: byName.Bottom, has: (x, y, z) => z < t, uv: (x, y, z) => [x, y] },
  ];
  const closed = opts.top === 'closed';
  if (closed) panels.push({ pts: byName.Top, has: (x, y, z) => z > H - t, uv: (x, y, z) => [x, y] });

  const rand = rng(12345);
  let checked = 0;
  for (let i = 0; i < samples; i++) {
    // Bias samples toward the walls so the joints get good coverage.
    const x = rand() < 0.5 ? (rand() < 0.5 ? rand() * t : W - rand() * t) : rand() * W;
    const y = rand() < 0.5 ? (rand() < 0.5 ? rand() * t : D - rand() * t) : rand() * D;
    const z = rand() < 0.5 ? (rand() < 0.5 ? rand() * t : H - rand() * t) : rand() * H;
    const inCavity = x > t && x < W - t && y > t && y < D - t && z > t && (closed ? z < H - t : true);
    if (inCavity) continue;
    checked++;
    let count = 0;
    for (const p of panels) {
      if (!p.has(x, y, z)) continue;
      const [u, v] = p.uv(x, y, z);
      if (pointInPolygon(u, v, p.pts)) count++;
    }
    assert.equal(count, 1, `point (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}) covered ${count} times`);
  }
  assert.ok(checked > samples / 4);
}

test('closed box joints tile the walls exactly', () => {
  checkShell({ width: 100, depth: 80, height: 50, thickness: 3, finger: 9, top: 'closed' });
});

test('open box joints tile the walls exactly', () => {
  checkShell({ width: 120, depth: 64, height: 40, thickness: 3.175, finger: 10, top: 'open' });
});

test('thick material, inner dimensions', () => {
  checkShell({ width: 150, depth: 150, height: 80, thickness: 6, finger: 15, top: 'closed', dims: 'inner' });
});

test('inner dimensions are converted to outer', () => {
  const r = G.generateBox({ width: 100, depth: 80, height: 50, thickness: 3, dims: 'inner', top: 'open' });
  assert.deepEqual(r.info.outer, { w: 106, d: 86, h: 53 });
  assert.deepEqual(r.info.inner, { w: 100, d: 80, h: 50 });
});

test('finger counts are odd', () => {
  for (let len = 20; len < 400; len += 7.3) {
    const n = G.fingerCount(len, 3, 9);
    assert.equal(n % 2, 1, `len ${len} -> ${n}`);
  }
});

test('kerf offset grows a rectangle by kerf/2 on each side', () => {
  const r = G.offsetOrtho([[0, 0], [10, 0], [10, 5], [0, 5]], 0.1);
  const b = G.bbox(r);
  assert.ok(Math.abs(b.w - 10.2) < 1e-9);
  assert.ok(Math.abs(b.h - 5.2) < 1e-9);
  // Works the same regardless of winding direction.
  const r2 = G.offsetOrtho([[0, 0], [0, 5], [10, 5], [10, 0]], 0.1);
  assert.ok(Math.abs(G.bbox(r2).w - 10.2) < 1e-9);
});

test('kerf makes tabs wider and slots narrower', () => {
  const k = 0.2;
  const r = G.generateBox({ width: 100, depth: 80, height: 50, thickness: 3, finger: 9, kerf: k, top: 'closed' });
  const front = r.parts.find((p) => p.name === 'Front');
  const b = G.bbox(front.pts);
  assert.ok(Math.abs(b.w - (100 + k)) < 1e-9);
  assert.ok(Math.abs(b.h - (50 + k)) < 1e-9);
});

test('dividers are generated with half-lap slots', () => {
  const r = G.generateBox({ width: 100, depth: 80, height: 50, thickness: 3, kerf: 0, top: 'open', cols: 3, rows: 2 });
  const xs = r.parts.filter((p) => p.name.startsWith('Divider X'));
  const ys = r.parts.filter((p) => p.name.startsWith('Divider Y'));
  assert.equal(xs.length, 1);
  assert.equal(ys.length, 2);
  // Rectangle (4 pts) + 4 pts per slot.
  assert.equal(xs[0].pts.length, 4 + 4 * 2);
  assert.equal(ys[0].pts.length, 4 + 4 * 1);
  assert.ok(r.info.compartment.w > 0);
});

test('lid option adds lid and lip, no top', () => {
  const r = G.generateBox({ width: 100, depth: 80, height: 50, thickness: 3, top: 'lid' });
  const names = r.parts.map((p) => p.name);
  assert.ok(names.includes('Lid'));
  assert.ok(names.includes('Lid lip'));
  assert.ok(!names.includes('Top'));
});

test('too-small box reports an error', () => {
  const r = G.generateBox({ width: 5, depth: 80, height: 50, thickness: 3 });
  assert.ok(r.errors.length > 0);
});

test('layout keeps every part on a sheet without overlaps', () => {
  const r = G.generateBox({ width: 200, depth: 150, height: 100, thickness: 3, kerf: 0.15, cols: 3, rows: 3 });
  const lay = G.layoutParts(r.parts, 300, 200, 3, 5);
  const total = lay.sheets.reduce((n, s) => n + s.items.length, 0);
  assert.equal(total, r.parts.length);
  assert.deepEqual(lay.oversize, []);
  for (const s of lay.sheets) {
    for (const it of s.items) {
      assert.ok(it.x >= 5 - 1e-9 && it.y >= 5 - 1e-9);
      assert.ok(it.x + it.w <= 295 + 1e-9 && it.y + it.h <= 195 + 1e-9);
    }
    for (let i = 0; i < s.items.length; i++) {
      for (let j = i + 1; j < s.items.length; j++) {
        const a = s.items[i], b = s.items[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.ok(!overlap, `${a.name} overlaps ${b.name}`);
      }
    }
  }
});

test('oversize parts are flagged', () => {
  const r = G.generateBox({ width: 500, depth: 80, height: 50, thickness: 3 });
  const lay = G.layoutParts(r.parts, 300, 200, 3, 5);
  assert.ok(lay.oversize.includes('Front'));
});

test('SVG export uses millimetre units and red cut lines', () => {
  const r = G.generateBox({ width: 100, depth: 80, height: 50, thickness: 3 });
  const lay = G.layoutParts(r.parts, 400, 300, 3, 5);
  const svg = G.sheetSVG(lay.sheets[0].items, { width: 400, height: 300, labels: true });
  assert.match(svg, /width="400mm" height="300mm"/);
  assert.match(svg, /viewBox="0 0 400 300"/);
  assert.match(svg, /stroke="#ff0000"/);
  assert.match(svg, /<text /);
});
