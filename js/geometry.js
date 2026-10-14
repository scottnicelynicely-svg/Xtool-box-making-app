/*
 * Box geometry engine: finger-jointed panels, kerf compensation, sheet layout
 * and SVG export. All lengths are millimetres.
 *
 * Works in the browser (exposes window.BoxGen) and in Node (module.exports)
 * so the same code is used by the app and the tests.
 *
 * Joint scheme (W = width along X, D = depth along Y, H = height along Z):
 *   - Every panel edge that meets another panel is a band of depth t
 *     (material thickness). The fingered part of the band runs from t to L-t
 *     and is split into an odd number of equal segments, alternating
 *     between the two mating panels.
 *   - The t x t x t corner cubes always belong to the front/back panels, so
 *     front/back panels have solid corners and all other panels have their
 *     corners notched out.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BoxGen = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-7;

  // ---------------------------------------------------------------- polygons

  function samePoint(a, b) {
    return Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
  }

  function collinear(a, b, c) {
    return Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) < EPS;
  }

  /** Remove duplicate and collinear vertices from a closed polygon. */
  function cleanup(pts) {
    const out = [];
    for (const p of pts) {
      if (!out.length || !samePoint(out[out.length - 1], p)) out.push(p);
    }
    while (out.length > 1 && samePoint(out[0], out[out.length - 1])) out.pop();
    // Drop collinear vertices one at a time (each removal can expose another).
    let i = 0;
    while (out.length > 3 && i < out.length) {
      const a = out[(i - 1 + out.length) % out.length];
      const c = out[(i + 1) % out.length];
      if (collinear(a, out[i], c)) {
        out.splice(i, 1);
        i = Math.max(0, i - 1);
      } else {
        i++;
      }
    }
    return out;
  }

  function signedArea(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }

  function bbox(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  /**
   * Offset an orthogonal (axis-aligned) polygon outward by d (negative d
   * shrinks it). Used for kerf compensation: the laser burns away about
   * kerf/2 on each side of the line, so we grow every part by kerf/2.
   */
  function offsetOrtho(pts, d) {
    const p = cleanup(pts);
    if (Math.abs(d) < EPS) return p;
    const sign = signedArea(p) > 0 ? 1 : -1;
    const n = p.length;
    const normals = [];
    for (let i = 0; i < n; i++) {
      const a = p[i];
      const b = p[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dx = (b[0] - a[0]) / len;
      const dy = (b[1] - a[1]) / len;
      normals.push([sign * dy, -sign * dx]);
    }
    return p.map((v, i) => {
      const n1 = normals[(i - 1 + n) % n];
      const n2 = normals[i];
      return [v[0] + d * (n1[0] + n2[0]), v[1] + d * (n1[1] + n2[1])];
    });
  }

  function translate(pts, dx, dy) {
    return pts.map(([x, y]) => [x + dx, y + dy]);
  }

  function normalize(pts) {
    const b = bbox(pts);
    return translate(pts, -b.minX, -b.minY);
  }

  /** Rotate 90 degrees clockwise (on screen) and re-normalize. */
  function rotate90(pts) {
    const b = bbox(pts);
    return normalize(pts.map(([x, y]) => [b.maxY - y, x]));
  }

  // ------------------------------------------------------------ finger joints

  /** Odd number of finger segments for an edge of length len. */
  function fingerCount(len, t, target) {
    const inner = len - 2 * t;
    if (inner <= EPS) return 0;
    let n = 2 * Math.round((inner / target - 1) / 2) + 1;
    if (n < 1) n = 1;
    if (n < 3 && inner >= 3 * t) n = 3;
    return n;
  }

  /**
   * Points along one panel edge in edge-local coordinates: u runs along the
   * edge from 0 to L, v is depth into the panel (0 = outer boundary).
   * The end corner is omitted; the next edge supplies it.
   */
  function edgePath(L, t, edge, cornerStart, cornerEnd) {
    const pts = [cornerStart ? [0, 0] : [t, t]];
    if (cornerStart) pts.push([t, 0]);
    if (!edge || edge.type === 'plain') {
      pts.push([t, 0], [L - t, 0]);
    } else {
      const w = (L - 2 * t) / edge.n;
      for (let i = 0; i < edge.n; i++) {
        const out = (i % 2 === 0) === edge.startOut;
        const v = out ? 0 : t;
        const a = t + i * w;
        pts.push([a, v], [a + w, v]);
      }
    }
    if (cornerEnd) pts.push([L - t, 0]);
    return pts;
  }

  /**
   * Outline of an A x B panel.
   * edges:   [top, right, bottom, left]  each {type:'plain'} or
   *          {type:'fingers', n, startOut}
   * corners: [topLeft, topRight, bottomRight, bottomLeft] true = solid corner
   */
  function panelOutline(A, B, t, edges, corners) {
    const maps = [
      (u, v) => [u, v],
      (u, v) => [A - v, u],
      (u, v) => [A - u, B - v],
      (u, v) => [v, B - u],
    ];
    const lens = [A, B, A, B];
    const pts = [];
    for (let k = 0; k < 4; k++) {
      const ep = edgePath(lens[k], t, edges[k], corners[k], corners[(k + 1) % 4]);
      for (const [u, v] of ep) pts.push(maps[k](u, v));
    }
    return cleanup(pts);
  }

  function rect(w, h) {
    return [[0, 0], [w, 0], [w, h], [0, h]];
  }

  /**
   * Rectangle with rectangular notches cut into its top and/or bottom edge.
   * notches: [{a, b, depth}] with a < b measured from the left.
   */
  function notchedRect(L, H, topNotches, bottomNotches) {
    const pts = [[0, 0]];
    for (const n of topNotches.slice().sort((p, q) => p.a - q.a)) {
      pts.push([n.a, 0], [n.a, n.depth], [n.b, n.depth], [n.b, 0]);
    }
    pts.push([L, 0], [L, H]);
    for (const n of bottomNotches.slice().sort((p, q) => q.a - p.a)) {
      pts.push([n.b, H], [n.b, H - n.depth], [n.a, H - n.depth], [n.a, H]);
    }
    pts.push([0, H]);
    return cleanup(pts);
  }

  // -------------------------------------------------------------------- box

  const DEFAULTS = {
    width: 100,
    depth: 80,
    height: 50,
    dims: 'outer',        // 'outer' | 'inner'
    thickness: 3,
    kerf: 0.15,
    finger: 9,
    top: 'closed',        // 'closed' | 'open' | 'lid'
    lidClearance: 0.3,
    cols: 1,
    rows: 1,
    dividerClearance: 0.2,
  };

  function dividerCenters(innerLen, count, t) {
    const cell = (innerLen - (count - 1) * t) / count;
    const out = [];
    for (let i = 1; i < count; i++) out.push(i * cell + (i - 1) * t + t / 2);
    return { cell, centers: out };
  }

  /**
   * Build all parts for a box. Returns { parts, info, errors, warnings }.
   * Each part: { name, pts } with pts already kerf-compensated and
   * normalized to start at (0, 0).
   */
  function generateBox(input) {
    const o = Object.assign({}, DEFAULTS, input);
    const errors = [];
    const warnings = [];
    const t = Number(o.thickness);
    const kerf = Number(o.kerf) || 0;
    const top = o.top;
    const topClosed = top === 'closed';
    const cols = Math.max(1, Math.floor(o.cols || 1));
    const rows = Math.max(1, Math.floor(o.rows || 1));

    if (!(t > 0)) errors.push('Material thickness must be greater than 0.');
    if (!(o.finger > 0)) errors.push('Finger width must be greater than 0.');
    if (kerf < 0) errors.push('Kerf cannot be negative.');
    if (errors.length) return { parts: [], info: null, errors, warnings };

    let W = Number(o.width), D = Number(o.depth), H = Number(o.height);
    if (o.dims === 'inner') {
      W += 2 * t;
      D += 2 * t;
      H += topClosed ? 2 * t : t;
    }
    const iw = W - 2 * t;
    const id = D - 2 * t;
    const ih = H - (topClosed ? 2 * t : t);
    if (!(iw > 0 && id > 0 && ih > 0)) {
      errors.push('Box is too small for this material thickness (inside size would be zero or less).');
      return { parts: [], info: null, errors, warnings };
    }

    const F = (len, startOut) => ({ type: 'fingers', n: fingerCount(len, t, o.finger), startOut });
    const P = { type: 'plain' };
    const raw = [];

    // Front / back: W x H, solid corners.
    const front = panelOutline(W, H, t,
      [topClosed ? F(W, false) : P, F(H, false), F(W, false), F(H, false)],
      [true, true, true, true]);
    raw.push({ name: 'Front', pts: front }, { name: 'Back', pts: front });

    // Left / right: D x H, notched corners.
    const side = panelOutline(D, H, t,
      [topClosed ? F(D, false) : P, F(H, true), F(D, false), F(H, true)],
      [false, false, false, false]);
    raw.push({ name: 'Left', pts: side }, { name: 'Right', pts: side });

    // Bottom (and top): W x D, notched corners.
    const plate = panelOutline(W, D, t,
      [F(W, true), F(D, true), F(W, true), F(D, true)],
      [false, false, false, false]);
    raw.push({ name: 'Bottom', pts: plate });
    if (topClosed) raw.push({ name: 'Top', pts: plate });

    let dividerHeight = ih;
    if (top === 'lid') {
      const c = Number(o.lidClearance) || 0;
      const lw = iw - 2 * c;
      const ld = id - 2 * c;
      raw.push({ name: 'Lid', pts: rect(W, D) });
      if (lw > 0 && ld > 0) raw.push({ name: 'Lid lip', pts: rect(lw, ld) });
      else warnings.push('Lid lip is too small to generate; check lid clearance.');
      dividerHeight = ih - t;
    }

    // Dividers: "rows" split the depth (dividers run along X),
    // "cols" split the width (dividers run along Y). Where they cross they
    // use half-lap slots: X dividers slotted from the top, Y from the bottom.
    let cellW = iw, cellD = id;
    if (cols > 1 || rows > 1) {
      const c = Number(o.dividerClearance) || 0;
      if (topClosed) dividerHeight -= c;
      const dh = dividerHeight;
      const xs = dividerCenters(iw, cols, t);
      const ys = dividerCenters(id, rows, t);
      cellW = xs.cell;
      cellD = ys.cell;
      if (xs.cell <= 0 || ys.cell <= 0 || dh <= 0) {
        errors.push('Too many dividers for this box size.');
      } else {
        const slot = t + c;
        if (rows > 1) {
          const L = iw - c;
          const notches = cols > 1
            ? xs.centers.map((x) => ({ a: x - c / 2 - slot / 2, b: x - c / 2 + slot / 2, depth: dh / 2 }))
            : [];
          const pts = notchedRect(L, dh, notches, []);
          // Slots come down from the top, so put the label in the lower half.
          for (let i = 0; i < rows - 1; i++) raw.push({ name: `Divider X${i + 1}`, pts, label: [0.5, 0.75] });
        }
        if (cols > 1) {
          const L = id - c;
          const notches = rows > 1
            ? ys.centers.map((y) => ({ a: y - c / 2 - slot / 2, b: y - c / 2 + slot / 2, depth: dh / 2 }))
            : [];
          const pts = notchedRect(L, dh, [], notches);
          for (let i = 0; i < cols - 1; i++) raw.push({ name: `Divider Y${i + 1}`, pts, label: [0.5, 0.25] });
        }
      }
    }

    if (o.finger < 2 * t) warnings.push('Fingers narrower than 2x the material thickness can be fragile.');
    if (kerf > 0.5) warnings.push('Kerf above 0.5 mm is unusually large; run a kerf test to check.');

    const parts = raw.map((p) => ({
      name: p.name,
      pts: normalize(offsetOrtho(p.pts, kerf / 2)),
      label: p.label || [0.5, 0.5],
    }));
    const info = {
      outer: { w: W, d: D, h: H },
      inner: { w: iw, d: id, h: ih },
      thickness: t,
      kerf,
      fingers: {
        width: fingerCount(W, t, o.finger),
        depth: fingerCount(D, t, o.finger),
        height: fingerCount(H, t, o.finger),
      },
      compartment: (cols > 1 || rows > 1) ? { w: cellW, d: cellD, h: dividerHeight } : null,
    };
    return { parts, info, errors, warnings };
  }

  // ------------------------------------------------------------ test pieces

  /**
   * Kerf test: a 50 x 20 mm strip split into five 10 mm pieces. Push the
   * pieces together and measure the total width M; kerf = (50 - M) / 5.
   * Returned as raw paths (not kerf-compensated, on purpose).
   */
  function kerfTestPaths() {
    const paths = [{ pts: rect(50, 20), closed: true }];
    for (let i = 1; i < 5; i++) paths.push({ pts: [[i * 10, 0], [i * 10, 20]], closed: false });
    return paths;
  }

  /** Two small mating pieces using the current thickness/kerf/finger settings. */
  function jointTestParts(input) {
    const o = Object.assign({}, DEFAULTS, input);
    const t = Number(o.thickness);
    const kerf = Number(o.kerf) || 0;
    const L = Math.max(40, 6 * t + 10);
    const H = Math.max(30, 4 * t + 10);
    const P = { type: 'plain' };
    const n = fingerCount(L, t, o.finger);
    const a = panelOutline(L, H, t, [P, P, { type: 'fingers', n, startOut: false }, P], [true, true, true, true]);
    const b = panelOutline(L, H, t, [{ type: 'fingers', n, startOut: true }, P, P, P], [false, false, true, true]);
    return [
      { name: 'Joint A', pts: normalize(offsetOrtho(a, kerf / 2)) },
      { name: 'Joint B', pts: normalize(offsetOrtho(b, kerf / 2)) },
    ];
  }

  // ------------------------------------------------------------------ layout

  /**
   * Simple shelf packing onto sheets of sheetW x sheetH.
   * Returns { sheets: [{ items: [{name, pts, x, y, w, h}] }], oversize: [names] }
   */
  function layoutParts(parts, sheetW, sheetH, gap, margin) {
    const usableW = sheetW - 2 * margin;
    const usableH = sheetH - 2 * margin;
    const oversize = [];
    const items = parts.map((p) => {
      let pts = p.pts;
      let label = p.label || [0.5, 0.5];
      let b = bbox(pts);
      const fitsAsIs = b.w <= usableW + EPS && b.h <= usableH + EPS;
      const fitsRotated = b.h <= usableW + EPS && b.w <= usableH + EPS;
      // Prefer landscape orientation for denser shelves, unless it won't fit.
      if ((!fitsAsIs && fitsRotated) || (b.h > b.w && fitsRotated)) {
        pts = rotate90(pts);
        label = [1 - label[1], label[0]];
        b = bbox(pts);
      }
      if (b.w > usableW + EPS || b.h > usableH + EPS) oversize.push(p.name);
      return { name: p.name, pts, label, w: b.w, h: b.h };
    });
    items.sort((p, q) => q.h - p.h || q.w - p.w);

    const sheets = [];
    let sheet = null, x = 0, y = 0, shelfH = 0;
    const newSheet = () => {
      sheet = { items: [] };
      sheets.push(sheet);
      x = margin; y = margin; shelfH = 0;
    };
    newSheet();
    for (const it of items) {
      if (x > margin && x + it.w > sheetW - margin + EPS) {
        x = margin;
        y += shelfH + gap;
        shelfH = 0;
      }
      if (sheet.items.length && y + it.h > sheetH - margin + EPS) newSheet();
      sheet.items.push(Object.assign({}, it, { x, y, pts: translate(it.pts, x, y) }));
      x += it.w + gap;
      shelfH = Math.max(shelfH, it.h);
    }
    return { sheets, oversize };
  }

  // --------------------------------------------------------------------- SVG

  function fmt(n) {
    return (Math.round(n * 1000) / 1000).toString();
  }

  function pathData(pts, closed) {
    let d = 'M' + fmt(pts[0][0]) + ' ' + fmt(pts[0][1]);
    for (let i = 1; i < pts.length; i++) d += 'L' + fmt(pts[i][0]) + ' ' + fmt(pts[i][1]);
    return closed === false ? d : d + 'Z';
  }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  /**
   * Render a sheet to SVG.
   * opts: { width, height, cutColor, engraveColor, labels, preview }
   * In preview mode the SVG scales to its container and strokes don't shrink.
   */
  function sheetSVG(items, opts) {
    const W = opts.width, H = opts.height;
    const cut = opts.cutColor || '#ff0000';
    const eng = opts.engraveColor || '#0000ff';
    const sizeAttrs = opts.preview
      ? 'width="100%" preserveAspectRatio="xMidYMid meet"'
      : `width="${fmt(W)}mm" height="${fmt(H)}mm"`;
    const strokeAttrs = opts.preview
      ? `stroke="${cut}" stroke-width="1.25" vector-effect="non-scaling-stroke"`
      : `stroke="${cut}" stroke-width="0.1"`;
    const out = [];
    if (!opts.preview) out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ${sizeAttrs} viewBox="0 0 ${fmt(W)} ${fmt(H)}">`);
    if (opts.preview) out.push(`<rect class="sheet-bg" x="0" y="0" width="${fmt(W)}" height="${fmt(H)}"/>`);
    out.push(`<g id="cut" fill="none" ${strokeAttrs}>`);
    for (const it of items) {
      const title = it.name ? `<title>${escapeXml(it.name)}</title>` : '';
      out.push(`<path d="${pathData(it.pts, it.closed)}">${title}</path>`);
    }
    out.push('</g>');
    if (opts.labels) {
      out.push(`<g id="engrave" fill="${eng}" font-family="Arial, Helvetica, sans-serif" text-anchor="middle" dominant-baseline="central">`);
      for (const it of items) {
        if (!it.name) continue;
        const size = Math.max(2, Math.min(6, it.h / 5, it.w / (it.name.length * 0.7)));
        const [fx, fy] = it.label || [0.5, 0.5];
        const sizeLimit = Math.min(fy, 1 - fy) * 2;
        const fs = Math.max(2, Math.min(size, (it.h * sizeLimit) / 2));
        out.push(`<text x="${fmt(it.x + it.w * fx)}" y="${fmt(it.y + it.h * fy)}" font-size="${fmt(fs)}">${escapeXml(it.name)}</text>`);
      }
      out.push('</g>');
    }
    out.push('</svg>');
    return out.join('\n');
  }

  return {
    DEFAULTS,
    cleanup,
    signedArea,
    bbox,
    offsetOrtho,
    rotate90,
    fingerCount,
    panelOutline,
    notchedRect,
    generateBox,
    kerfTestPaths,
    jointTestParts,
    layoutParts,
    sheetSVG,
    pathData,
  };
});
