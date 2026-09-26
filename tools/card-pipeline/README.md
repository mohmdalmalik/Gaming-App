# Card-art pipeline (Blender → assets/cards/*.jpg)

Makes the illustrations for every card except the Lantern. `assets/cards/lantern.jpg` is the
painted reference and this pipeline never touches it. Each card shows one object, centred, in a
three-quarter view, lit by a warm key light with a soft fill and a rim light, on the Lantern's dark
mottled green backdrop with a vignette. The evil Possession card uses a purple/black backdrop and
violet light. This is a dev tool. The game only loads the finished JPEGs, which are registered in
`CARD_ART` in `src/ui/cards.js`.

## Run
```bash
python3 -m pip install "bpy==4.2.0" pillow numpy scipy     # once
python3 tools/card-pipeline/make_cards.py                    # all 10 cards, about 2–3 min each on 4 CPUs
python3 tools/card-pipeline/make_cards.py --only knife,revolver
python3 tools/card-pipeline/make_cards.py --draft            # quick low-quality look (~10 s a card)
python3 tools/card-pipeline/make_cards.py --post             # redo only the 2D pass on the last renders
python3 tools/card-pipeline/sheet.py out.jpg 300 [--crop]    # contact sheet (--crop: preview the portrait tiles)
node    tools/card-pipeline/ui-shots.mjs [outDir]            # screenshots of the art in the game UI
```
Useful options are `--samples N` (default 160) and `--res N`, the render size before it is scaled
down to 640 (default 800). The raw renders go to `build/`, which git ignores.

## Files
- `make_cards.py` builds each card: one `build_<type>()` function models the object from bevelled
  primitives, lathes, extruded outlines, tubes and booleans, and returns its camera and light settings.
  After that the script lights the object, frames it and renders it with Cycles (CPU, OIDN denoise,
  transparent film, with a shadow catcher behind or under the object).
- `cardlib.py` holds the shared geometry helpers, the materials (aged brass and steel, walnut, pine,
  porcelain, gauze), the light rig, the auto-framing camera and the render settings.
- `post.py` is the 2D pass. It paints the backdrop, adds the warm glow behind the object and the
  pool of light under it, a light colour grade, bloom, the vignette and grain, then saves a
  640×640 JPEG (quality 88). The steam, the torch beam and the violet aura are painted here too.
- `sheet.py` makes the contact sheet. `ui-shots.mjs` takes the in-game screenshots: the hand sheet,
  the discard prompt, a trade pick and the Hand Mirror screen.

## Framing rule
The discard prompt, the trade pick and the Hand Mirror screen show cards as portrait tiles. They
crop the square art to about the middle 66% of its width. So every object is framed to fit inside
the middle ~62% of the width (`fill_w`) and up to ~86% of the height (`fill`). Long objects (knife,
key, torch, revolver) are posed on a steep diagonal. The barricade and the espresso saucer are
allowed to run a little wider.
