# Sparkleflock

Rhinestone templates from text, for cutting on a Cricut, Silhouette Cameo or similar machine.

### ▶ [Open Sparkleflock](https://mplinuxgeek.github.io/sparkleflock/)

If Sparkleflock is useful to you, you can support it here:

[![Donate with PayPal](https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/donate/?hosted_button_id=PZVZSNGSJVZF8)

Type text, pick a bold font and a stone size. Sparkleflock places the stones along the letters and exports the holes at real size as SVG or DXF. It works on a phone as well as a computer.

## Features

- **Bundled fonts:** 30 bold fonts, all included locally. You can also upload your own `.ttf` / `.otf`.
- **Stone sizes:** SS4 to SS34, each listed with its size in mm, or a custom size, with adjustable stone spacing. Under Advanced: the extra hole width (hole allowance), and a fill stone size, so the stones inside a letter can differ from the outline row, for example SS10 outline with SS8 inside.
- **Stone count:** the box above the preview shows the number of stones, the finished size, and how many stones of each size to buy with 10% spare.
- **Patterns:**
  - single row: one row of stones down the middle of each stroke
  - outline only
  - outline + rows along the letter: an even row of stones around each letter, then rows of stones running through the middle of each stroke. Wide strokes get several rows, spread evenly across the width, and stones sit offset into the gaps beside them
  - outline + rings inside: an even row of stones around each letter, then each next row sits in the gaps of the row outside it
  - outline + honeycomb fill
  - honeycomb fill only
  - Automatic: one pattern for the whole text, a single row for thin fonts and outline + rows along the letter for bold ones
- **Even layouts:** sharp corners always get a stone, rows on opposite sides of a stroke line up, and letters that are their own mirror image (A, H, O, T ...) get a mirrored layout.
- **Text:** letter, word and line spacing; several lines with left, centre or right alignment. Characters the font lacks are left out and named in a warning.
- **Size:** set width and height, with or without keeping proportions. Units are mm or inches.
- **Preview:**
  - rulers, with the design left-bottom justified against them
  - Cricut, Cameo or sheet mat outline, with a warning when the design doesn't fit
  - rotate the design by 45° or 90°; the warning offers the 45° turn when that makes a long word fit a square mat
- **Phones:** the preview sits on top with the settings in a sheet above a bottom tab bar. Drag with one finger, pinch to zoom.
- **Editing:** edit mode lets you click a stone to remove it or click empty space to add one. Undo and redo with Ctrl+Z / Ctrl+Shift+Z. Edits belong to one layout: changing the text, font, size, stones or pattern clears them (undo brings them back).
- **Shortcuts:** press `?` for the list (zoom, fit, edit mode, undo, Ctrl+S to export the SVG).
- **Export:**
  - SVG (mm), best for Design Space and Silhouette Designer Edition
  - DXF (R12, mm), for Silhouette Basic Edition
  - PNG picture of the finished stones (not for cutting)
  - the Export tab says which file each cutter software opens and what to do next
  - all formats at once, as one ZIP or three downloads
  - Share / email: on phones and other browsers that can share files, sends the files to your mail or messaging app
  - optional cut border; under Advanced, a letter outline layer and mirroring (templates are normally not mirrored)
- **Reset:** a ↺ button appears beside any setting changed from its default. Rarely needed settings sit under Advanced, which shows how many of them are changed.
- **Saving:** settings and manual stone edits are kept in the page URL (Copy link) and in the browser. A first visit from a US browser starts in inches. An uploaded font is not: a link or reload falls back to a bundled font and says so.

## Running

Open `index.html` directly (works from `file://`) or serve the folder:

```sh
python3 -m http.server 8000
```

Everything is local: `vendor/` has opentype.js (MIT) and clipper-lib (Boost licence); `fonts/` has the fonts as JS files so no fetch is needed.

## Licence

[MIT](LICENSE) for Sparkleflock's own code. The bundled libraries and fonts keep their own licences (below).

## Fonts

Fonts are from [Google Fonts](https://github.com/google/fonts), under the SIL Open Font License or Apache 2.0. Each font's licence is in `fonts/licenses/`. To change the set, edit `tools/fonts.txt`, put the TTFs in a folder named `<id>.ttf` and run:

```sh
python3 tools/build_fonts.py <folder with ttf files>
```
