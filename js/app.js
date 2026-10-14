(function () {
  'use strict';

  const G = window.BoxGen;
  const STORAGE_KEY = 'laser-box-maker.v1';
  const MM_PER_IN = 25.4;

  // Kerf values are starting points for a 10–20 W diode laser; calibrate
  // with the kerf test for your machine and material.
  const PRESETS = [
    { id: 'ply3', label: '3 mm basswood plywood', thickness: 3, kerf: 0.15, kind: 'wood' },
    { id: 'ply3175', label: '1/8" plywood (3.175 mm)', thickness: 3.175, kerf: 0.15, kind: 'wood' },
    { id: 'ply6', label: '6 mm plywood', thickness: 6, kerf: 0.2, kind: 'wood' },
    { id: 'ply635', label: '1/4" plywood (6.35 mm)', thickness: 6.35, kerf: 0.2, kind: 'wood' },
    { id: 'mdf3', label: '3 mm MDF', thickness: 3, kerf: 0.15, kind: 'wood' },
    { id: 'acr3', label: '3 mm acrylic', thickness: 3, kerf: 0.1, kind: 'acrylic' },
    { id: 'acr3175', label: '1/8" acrylic (3.175 mm)', thickness: 3.175, kerf: 0.1, kind: 'acrylic' },
    { id: 'acr5', label: '5 mm acrylic', thickness: 5, kerf: 0.12, kind: 'acrylic' },
    { id: 'custom', label: 'Custom', kind: 'custom' },
  ];

  const MATERIAL_NOTES = {
    wood: 'Wood: plywood glue layers can need more power or a second pass. Use air assist to reduce scorching.',
    acrylic: 'Acrylic: diode lasers only cut dark, opaque acrylic. Leave the protective film on while cutting.',
    custom: '',
  };

  const DEFAULTS = {
    unit: 'mm',
    preset: 'ply3',
    thickness: 3,
    kerf: 0.15,
    dims: 'outer',
    width: 100,
    depth: 80,
    height: 50,
    top: 'closed',
    lidClearance: 0.3,
    autoFinger: true,
    finger: 9,
    cols: 1,
    rows: 1,
    dividerClearance: 0.2,
    sheetW: 300,
    sheetH: 300,
    gap: 2,
    margin: 5,
    labels: false,
  };

  const LENGTH_FIELDS = ['thickness', 'kerf', 'width', 'depth', 'height', 'lidClearance', 'finger',
    'dividerClearance', 'sheetW', 'sheetH', 'gap', 'margin'];
  const COUNT_FIELDS = ['cols', 'rows'];
  const RADIO_FIELDS = ['unit', 'dims', 'top'];
  const CHECK_FIELDS = ['autoFinger', 'labels'];

  const $ = (id) => document.getElementById(id);
  let state = loadState();
  let lastLayout = null;

  // ------------------------------------------------------------- persistence

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) { /* storage unavailable */ }
    return Object.assign({}, DEFAULTS);
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ units

  function toDisplay(mm) {
    if (state.unit === 'in') return +(mm / MM_PER_IN).toFixed(4);
    return +mm.toFixed(3);
  }

  function fromDisplay(v) {
    return state.unit === 'in' ? v * MM_PER_IN : v;
  }

  function fmtLen(mm) {
    if (state.unit === 'in') return (mm / MM_PER_IN).toFixed(3).replace(/\.?0+$/, '') + '"';
    return mm.toFixed(1).replace(/\.0$/, '') + ' mm';
  }

  // ------------------------------------------------------------------- form

  function fillForm() {
    const sel = $('preset');
    if (!sel.options.length) {
      for (const p of PRESETS) sel.add(new Option(p.label, p.id));
    }
    sel.value = state.preset;
    for (const f of LENGTH_FIELDS) $(f).value = toDisplay(state[f]);
    for (const f of COUNT_FIELDS) $(f).value = state[f];
    for (const f of CHECK_FIELDS) $(f).checked = !!state[f];
    for (const f of RADIO_FIELDS) {
      const el = document.querySelector(`input[name="${f}"][value="${state[f]}"]`);
      if (el) el.checked = true;
    }
    const unitLabel = state.unit === 'in' ? 'in' : 'mm';
    document.querySelectorAll('em.u').forEach((el) => { el.textContent = `(${unitLabel})`; });
    syncDerived();
  }

  /** Fields whose value or visibility depends on other fields. */
  function syncDerived() {
    if (state.autoFinger) {
      state.finger = 3 * state.thickness;
      $('finger').value = toDisplay(state.finger);
    }
    $('finger').disabled = state.autoFinger;
    $('lidClearanceField').hidden = state.top !== 'lid';
    const preset = PRESETS.find((p) => p.id === state.preset) || PRESETS[PRESETS.length - 1];
    $('materialNote').textContent = MATERIAL_NOTES[preset.kind] || '';
    $('topHint').textContent = {
      closed: 'Six finger-jointed sides. Glue on the top, or leave it unglued as a friction fit.',
      open: 'Five sides with an open top.',
      lid: 'An open box plus a flat lid. Glue the smaller lip piece centered under the lid so it locates in the opening.',
    }[state.top];
  }

  function onInput(e) {
    const el = e.target;
    const id = el.id;
    if (el.name && RADIO_FIELDS.includes(el.name)) {
      if (el.name === 'unit') {
        state.unit = el.value;
        fillForm();
      } else {
        state[el.name] = el.value;
      }
    } else if (id === 'preset') {
      state.preset = el.value;
      const p = PRESETS.find((x) => x.id === el.value);
      if (p && p.thickness) {
        state.thickness = p.thickness;
        state.kerf = p.kerf;
        $('thickness').value = toDisplay(state.thickness);
        $('kerf').value = toDisplay(state.kerf);
      }
    } else if (LENGTH_FIELDS.includes(id)) {
      const v = parseFloat(el.value);
      if (!Number.isFinite(v)) return;
      state[id] = fromDisplay(v);
      if (id === 'thickness' || id === 'kerf') {
        state.preset = 'custom';
        $('preset').value = 'custom';
      }
    } else if (COUNT_FIELDS.includes(id)) {
      const v = parseInt(el.value, 10);
      if (!Number.isFinite(v)) return;
      state[id] = Math.min(20, Math.max(1, v));
    } else if (CHECK_FIELDS.includes(id)) {
      state[id] = el.checked;
    } else {
      return;
    }
    syncDerived();
    saveState();
    render();
  }

  // ----------------------------------------------------------------- render

  function boxOptions() {
    return {
      width: state.width,
      depth: state.depth,
      height: state.height,
      dims: state.dims,
      thickness: state.thickness,
      kerf: state.kerf,
      finger: state.finger,
      top: state.top,
      lidClearance: state.lidClearance,
      cols: state.cols,
      rows: state.rows,
      dividerClearance: state.dividerClearance,
    };
  }

  function message(kind, text) {
    const div = document.createElement('div');
    div.className = `msg ${kind}`;
    div.textContent = text;
    return div;
  }

  function render() {
    const res = G.generateBox(boxOptions());
    const msgs = $('messages');
    msgs.replaceChildren();
    const sheetsEl = $('sheets');
    sheetsEl.replaceChildren();
    lastLayout = null;

    for (const e of res.errors) msgs.append(message('error', e));
    if (res.errors.length) {
      $('summary').textContent = '';
      $('download').disabled = true;
      return;
    }
    for (const w of res.warnings) msgs.append(message('warn', w));

    const lay = G.layoutParts(res.parts, state.sheetW, state.sheetH, state.gap, state.margin);
    lastLayout = { lay, info: res.info };
    if (lay.oversize.length) {
      msgs.append(message('error', `Too big for the sheet: ${lay.oversize.join(', ')}. Increase the sheet size or make the box smaller.`));
    }
    $('download').disabled = false;
    $('download').textContent = lay.sheets.length > 1 ? `Download ${lay.sheets.length} SVGs` : 'Download SVG';

    const i = res.info;
    const f = i.fingers;
    const lines = [
      `<strong>Outside</strong> ${fmtLen(i.outer.w)} × ${fmtLen(i.outer.d)} × ${fmtLen(i.outer.h)}`,
      `<strong>Inside</strong> ${fmtLen(i.inner.w)} × ${fmtLen(i.inner.d)} × ${fmtLen(i.inner.h)}`,
      `<strong>Fingers</strong> ${f.width} / ${f.depth} / ${f.height} (W / D / H)`,
    ];
    if (i.compartment) {
      lines.push(`<strong>Compartments</strong> ${fmtLen(i.compartment.w)} × ${fmtLen(i.compartment.d)}, ${fmtLen(i.compartment.h)} tall dividers`);
    }
    lines.push(`<strong>${res.parts.length}</strong> parts on <strong>${lay.sheets.length}</strong> sheet${lay.sheets.length > 1 ? 's' : ''}`);
    $('summary').innerHTML = lines.map((l) => `<span>${l}</span>`).join('');

    lay.sheets.forEach((sheet, idx) => {
      const card = document.createElement('figure');
      card.className = 'sheet';
      const cap = document.createElement('figcaption');
      const title = document.createElement('span');
      title.textContent = `Sheet ${idx + 1} of ${lay.sheets.length} · ${sheet.items.map((it) => it.name).join(', ')}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'small';
      btn.textContent = 'Download';
      btn.addEventListener('click', () => downloadSheet(idx));
      cap.append(title, btn);
      const view = document.createElement('div');
      view.className = 'sheet-view';
      view.innerHTML = G.sheetSVG(sheet.items, {
        width: state.sheetW, height: state.sheetH, labels: true, preview: true,
        cutColor: 'currentColor', engraveColor: 'currentColor',
      });
      card.append(cap, view);
      sheetsEl.append(card);
    });
  }

  // --------------------------------------------------------------- download

  function saveFile(name, text) {
    const blob = new Blob([text], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function baseName() {
    const o = lastLayout.info.outer;
    const n = (mm) => (state.unit === 'in' ? +(mm / MM_PER_IN).toFixed(2) : Math.round(mm));
    return `box_${n(o.w)}x${n(o.d)}x${n(o.h)}${state.unit}_${String(+state.thickness.toFixed(2)).replace('.', 'p')}mm`;
  }

  function downloadSheet(idx) {
    if (!lastLayout) return;
    const sheets = lastLayout.lay.sheets;
    const svg = G.sheetSVG(sheets[idx].items, { width: state.sheetW, height: state.sheetH, labels: state.labels });
    const suffix = sheets.length > 1 ? `_sheet${idx + 1}` : '';
    saveFile(`${baseName()}${suffix}.svg`, svg);
  }

  function downloadAll() {
    if (!lastLayout) return;
    // Space out multiple downloads so browsers don't drop them.
    lastLayout.lay.sheets.forEach((_, idx) => setTimeout(() => downloadSheet(idx), idx * 400));
  }

  function downloadKerfTest() {
    const m = 5;
    const items = G.kerfTestPaths().map((p, i) => ({
      name: '',
      closed: p.closed,
      pts: p.pts.map(([x, y]) => [x + m, y + m]),
    }));
    saveFile('kerf_test_50mm.svg', G.sheetSVG(items, { width: 50 + 2 * m, height: 20 + 2 * m }));
  }

  function downloadJointTest() {
    const parts = G.jointTestParts(boxOptions());
    const lay = G.layoutParts(parts, 1000, 1000, 3, 5);
    const items = lay.sheets[0].items;
    const w = Math.max(...items.map((it) => it.x + it.w)) + 5;
    const h = Math.max(...items.map((it) => it.y + it.h)) + 5;
    const t = String(+state.thickness.toFixed(2)).replace('.', 'p');
    const k = String(+state.kerf.toFixed(3)).replace('.', 'p');
    saveFile(`joint_test_${t}mm_kerf${k}.svg`, G.sheetSVG(items, { width: w, height: h, labels: state.labels }));
  }

  // ------------------------------------------------------------------- init

  const form = $('form');
  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);
  $('download').addEventListener('click', downloadAll);
  $('kerfTest').addEventListener('click', downloadKerfTest);
  $('jointTest').addEventListener('click', downloadJointTest);
  $('reset').addEventListener('click', () => {
    state = Object.assign({}, DEFAULTS, { unit: state.unit });
    saveState();
    fillForm();
    render();
  });

  fillForm();
  render();
})();
