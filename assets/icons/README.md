# App icon

A brass lantern (the look of the Lantern card, `assets/cards/face/lantern.jpg`) on deep navy, inside a thin Art
Deco ring. No text. Drawn by hand as SVG; the game's own colours (brass `#c9a24e`, navy `#0f1424`).

| File | What it is |
| --- | --- |
| `icon.svg` | the master, 1024 x 1024, the picture on the Home Screen |
| `icon-maskable.svg` | the same at 80 %, for round or rounded masks (Android) |
| `favicon.svg` | the simpler tab icon (thicker shapes, no ring: it has to read at 16 px) |
| `icon-180.png` | the `apple-touch-icon` (iPad Home Screen), square, no transparency (iOS rounds it itself) |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | the manifest's icons (`manifest.webmanifest`) |
| `favicon-32.png`, `favicon-16.png` | the tab icons for Safari (transparent corners) |

The PNGs are made from the SVGs with headless Chromium (nothing to install beyond `tests/node_modules`):
open the SVG in a page of exactly the target size and take a screenshot of it (square icons: no transparency;
favicons: `omitBackground`). To change the picture, edit `icon.svg` (and `favicon.svg` if the lantern changes),
remake the maskable one (the same file with everything but the background inside
`<g transform="translate(102.4 102.4) scale(0.8)">`) and rasterise again at 180, 192, 512 (and the maskable at
512) and the favicons at 32 and 16. iOS keeps an installed icon as it was when it was added: after a change,
remove the Home Screen copy and add it again to see the new one.
