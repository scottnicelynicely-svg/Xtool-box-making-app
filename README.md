# Laser Box Maker

A small web app that generates finger-jointed box SVGs for an xTool laser cutter, for wood and acrylic. It runs entirely in the browser. There is nothing to install and no build step.

## Features

- **Box styles**: closed (6 sides), open top, or open box with a lift-off lid (flat lid plus a glue-on locating lip).
- **Inside or outside dimensions**, in **mm or inches**.
- **Material presets** for 3 mm / 1/8" / 6 mm / 1/4" plywood, MDF, and 3 mm / 1/8" / 5 mm acrylic, or a custom setting.
- **Kerf compensation**: every part is grown by half the kerf, so joints fit snugly instead of loosely.
- **Dividers**: a grid of columns and rows, with half-lap slots where dividers cross.
- **Sheet layout**: parts are packed onto your sheet size and split across several SVGs if needed. Parts too big for the sheet are flagged.
- **Calibration pieces**: a kerf test strip and a two-piece joint test that use your current settings.
- Optional **engraved part names** on a separate blue layer.

## Use it

Open `index.html` in a browser. You can also host it with GitHub Pages (Settings → Pages → deploy from branch) and use it from any device.

### Workflow with xTool Creative Space (XCS)

1. Measure your sheet with calipers and enter the real thickness.
2. Cut the **Kerf test**. Push the five pieces together and measure the total width, then set kerf = `(50 − measured) ÷ 5`.
3. Cut the **Joint test**. If the fit is loose, raise the kerf; if it's too tight, lower it.
4. Download the box SVG and import it into XCS. Files are in millimetres, so they import at true size.
5. Set red lines to **Cut**. If you turned labels on, set the blue text to **Engrave** or **Score**. Choose the power, speed, and passes for your material in XCS.

### Material notes

- **Wood**: plywood glue layers sometimes need extra power or a second pass. Air assist reduces charring.
- **Acrylic**: diode lasers can't cut clear or most light-coloured acrylic, because the beam passes through. Use dark, opaque acrylic. Cast acrylic cuts more cleanly than extruded. Leave the film on while cutting.

## Development

```sh
npm test   # runs the geometry tests (Node 18+), no dependencies
```

- `js/geometry.js` handles panel and joint geometry, kerf offset, layout, and SVG export. It is pure functions shared by the app and the tests.
- `js/app.js` is the UI: form state, unit conversion, preview, and downloads.
- `tests/geometry.test.js` includes a 3D check. It places every panel in space and checks that each point of the box walls is covered by exactly one panel, which proves the joints mesh with no gaps or overlaps.
