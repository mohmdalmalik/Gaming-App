# Character pipeline check (Blender → glTF → Three.js)

A standalone verification that we can model + animate characters in this cloud environment and load
them in the game's Three.js runtime. **Nothing here is part of the running game** — it lives under
`tools/` and is not imported by `src/`.

## Environment (verified 2026-09-13)
- No system Blender binary, but **`bpy` (Blender as a Python module) installs via pip** and runs
  fully headless (no display):

  ```bash
  python3 -m pip install "bpy==4.2.0"   # Blender 4.2, matches Python 3.11 here
  ```

- The glTF 2.0 exporter (`io_scene_gltf2`) is bundled and works. (A harmless warning about Draco
  compression appears — Draco isn't bundled, so meshes export uncompressed, which is actually
  simpler for Three.js to load with no extra decoder.)

## Run the check
```bash
python3 tools/char-pipeline/make_test_glb.py          # builds + exports tools/char-pipeline/test_guest.glb
# serve the repo root, then:
node  tools/char-pipeline/preview.mjs                 # loads the .glb in Three.js, screenshots it
```
`preview.mjs` reuses the game's pinned Three.js + GLTFLoader from `tests/node_modules/three`
(symlink `tools/char-pipeline/node_modules -> ../../tests/node_modules` to run it).

## Result
- `make_test_glb.py` builds a rounded, stylised stand-in (beveled + subdivided body, smooth head),
  assigns base-colour materials, keyframes a 24-frame idle, and exports a **96 KB `.glb`** with the
  animation included.
- `preview.html` loads it with `GLTFLoader`: **ok, 2 meshes, ~3.4k triangles, 1 animation clip
  ("BodyAction")**, played through `THREE.AnimationMixer`, no console errors.

Conclusion: Blender modelling + `.glb` export (incl. animation) + Three.js import/playback all work
here. We can proceed to the first rounded hotel guest (standing + walking).

## First real guest — Victor
`make_victor.py` is the real build on top of the same pipeline. It models a rounded, cartoon-style
tuxedo guest from primitives, rigid-skins it to a simple armature, authors **Idle** and **Walk**
Actions, and exports the shipped model `assets/characters/victor.glb`.

```bash
python3 tools/char-pipeline/make_victor.py            # rebuilds assets/characters/victor.glb
node  tools/char-pipeline/preview_victor.mjs          # game + front views, reports clips/tris/height
node  tools/char-pipeline/game-shots.mjs              # real in-game iPad-size screenshots (idle/walk/door)
node  tools/char-pipeline/record_walk.mjs             # short webm of Victor walking a loop
```
(The `node_modules -> ../../tests/node_modules` symlink is needed for the `.mjs` scripts and is
gitignored; recreate it with `ln -sfn ../../tests/node_modules tools/char-pipeline/node_modules`.)

**Result**: `assets/characters/victor.glb` — **4,420 triangles, 6 materials, ~217 KB**, two clips
(`Idle`, `Walk`), loads with no console errors and animates in-game. Wired into the game via the
`tuxedo` outfit's `model` field; see `docs/DECISIONS.md` → "First real 3D character".

## Tools (phase 12b)
| Tool | What it does |
|---|---|
| `victor_lib.py` | deterministic bmesh helpers: superellipse lofts, capsules, UV spheres, smooth-falloff shapers, tapered tubes, sRGB→linear |
| `make_victor.py` | builds Victor v2 (model + jointed rig + Idle/Walk) → `assets/characters/victor.glb`; prints tris/materials/bytes and the measured stride |
| `preview_glb.mjs` / `preview_glb.html` | renders any GLB: front, tq, side, back, game angle, true game scale, 4-yaw turntable, portrait; game-like lighting + Lambert conversion |
| `capture.mjs` | real-game screenshots at any viewport/dpr, N camera rotations (+ crops on Victor), hand/map open, `--still` freezes CSS animations; `--pre x,z` walks there first, `--prerot n` rotates the camera first, `--walk x,z --midwalk ms` screenshots mid-walk (use a clear hall edge, e.g. `--pre 3,3 --walk 0,3`) |
| `walk_check.mjs` | drives walks/turns/interrupt/doorway from the real game; verifies stride in use, phase-vs-distance, mesh-vs-mover, settle; records a webm + frames |
| `record_smooth.mjs` | deterministic 30 fps recording: steps the page clock per frame, screenshots, encodes a webm in-browser |
| `portrait.mjs` + `portrait_post.py` | interface portraits (normal + possessed) rendered from the model |
| `scene_stats.mjs` | live draw calls / triangles / programs with Victor loaded |
| `make_panels.py` | cuts `ref/victor-sheet.png` into `ref/panels/` (front, tq, side, back, face close-ups, elevated) |
| `compare.py` | sheet panel vs render silhouette at equal displayed height: IoU, width per 4 % band, overlay image |
| `compare_head.py` | head close-up vs `face@yaw` render: widths per 5 % of head height, eye/brow/moustache blobs |
| `diag_materials.mjs` | REAL game with Victor's materials swapped for unlit contrasting colours (hair magenta, skin green), four rotations — coverage/assignment diagnosis |
| `glb_inspect.py` | per-material audit of an exported GLB: attributes (COLOR_0…), triangle winding vs normals, inward-facing faces, bboxes |
| `make_victor.py` (pass 3) | hair = fitted cap + part step + lock regions + one rounded roll; `bake_vertex_shading` writes ambient occlusion + skin tint into COLOR_0 |
| `make_victor.py` (pass 8) | face: one-tube moustache from edge profiles (`smooth_profile`), crescent brows, one-shell ears (ridge/bowl/lobe from a deformed sphere), widened nose-bridge bed; `compare_head.py front` gives the sheet-vs-render feature numbers |
| `make_victor.py` (pass 7) | trousers = ONE ring-built surface (smooth union of two thigh lobes above the crotch, one shared crotch vertex, two leg rings below; blended weights); jacket rings resampled by arc length with the front opening cut into each ring (no deleted quads, no bottom cap). `VICTOR_DIAG=1 VICTOR_OUT=path` builds a contrasting-colour copy. Walk-pose renders: `--clip Walk --t 0` / `--t 0.5` are the stride extremes |
Outputs (`shots/`, `*.glb`, `*.png`, `*.webm`, `rec/`) are gitignored; `node_modules` is a symlink to `tests/node_modules`.
Exceptions: the owner's references `ref/victor-sheet.png` and `ref/hotel-reference.jpg` are committed.

## Victor v5 loop (appearance pass)
```bash
python3 tools/char-pipeline/make_panels.py                       # once: cut the sheet into ref/panels/
python3 tools/char-pipeline/make_victor.py                       # rebuild the GLB (REPORT lines: stride, tris, bytes)
node tools/char-pipeline/preview_glb.mjs --glb assets/characters/victor.glb --out tools/char-pipeline/shots/v5 \
     --views body@0,body@35,body@90,body@180,face@0,face@35,face@90   # neutral, sheet-like renders
     # also elev@yaw (56 deg crown check), elev30@yaw (the sheet's elevated panel); add --light game for the hall light
python3 tools/char-pipeline/compare.py tools/char-pipeline/ref/panels/front.png tools/char-pipeline/shots/v5-body-0.png tools/char-pipeline/shots/cmp-front.png
python3 tools/char-pipeline/compare_head.py front tools/char-pipeline/ref/panels/face-front.png tools/char-pipeline/shots/v5-face-0.png
node tools/char-pipeline/capture.mjs --out tools/char-pipeline/shots/v5g --w 1194 --h 834 --dpr 2 --rot 4   # real game
node tools/char-pipeline/portrait.mjs                            # interface portraits from the model
```


## Guest kit (Marcus and later guests)
`guest_kit.py` is the shared, parameterised builder extracted from `make_victor.py`; each guest is a spec in
`guests/<name>.py` (CFG numbers, colours, skull/hair tables, jacket/shirt/tie/arm/trouser/shoe dicts, `RIG`, and a
`build(g)` that calls the builders). Victor's own script is unchanged.
```bash
python3 tools/char-pipeline/make_guest.py marcus                 # -> assets/characters/marcus.glb (REPORT lines: tris by part, stride, bytes)
GUEST_OUT=tools/char-pipeline/shots/x.glb python3 tools/char-pipeline/make_guest.py marcus   # build elsewhere
node tools/char-pipeline/preview_glb.mjs --glb assets/characters/marcus.glb --out tools/char-pipeline/shots/mx \
     --views body@0,body@30,body@90,body@180,face@0,face@30 --bg 7b716a --key left   # the guest sheets' grey + left key light
python3 tools/char-pipeline/sheet_compare.py marcus tools/char-pipeline/shots/mx tools/char-pipeline/shots/marcus-vs-sheet.png
```
`sheet_compare.py` puts the six sheet panels (`ref/panels-<name>/`, cut by `make_panels_guests.py`) over the six renders at
the same scale (body: figure height; faces: known camera scale, aligned on the eyes) and prints silhouette IoU/widths.
Its sheet mask fits a smooth background field, so the sheets' gradient and floor shadow are handled.
The sheets' three-quarter panels match yaw 30 (both body and head), and the SIDE panel matches yaw 90.

Kit API (`g = Guest(name, CFG, COLOURS)`; heights in CFG/specs are % of standing height from the top, `g.zp(pct)` -> metres):
- context: `g.H, g.zp, g.C, g.M` (materials named after the colour keys, e.g. `skin` -> `Skin`), `g.add(ob, mat, bone)`,
  `g.add_w(ob, mat, fn(co)->{bone: w})`, `g.add_split(...)`; `g.set_head(W, DF, DB, E, bulges)` then `g.skull_at / skull_pt /
  face_y / face_normal / on_face / flatten_to_face / inside_skull`. `CFG['head_y']` moves the head back from the chest.
- head: `head(g, nlon, nlat, cull_in=g.hair_covers)`, `ears` (`CFG['ear_style']`: `'round'` = the sheets' thick-rimmed
  C-shaped ear: ear_h/ear_w/ear_out/ear_y/ear_tilt (flare)/ear_thick/ear_rim/ear_bowl/ear_sink/ear_seg; `'shell'` = the
  older thin ear), `eyes` (glossy black `eye`; their centre is written to the armature extras as `eyeCentre` in glTF space), `brows` (`CFG['brow']`), `nose`, `mouth`
  (`CFG['mouth']`), optional `moustache` (`CFG['moustache']`, Victor-style), `neck`.
- hair: `hair_shell(g, wr, wl, front, back, expo, hairline, edge, slope, grooves, thin_below, ...)`: one smooth radial shell
  whose silhouette comes from measured extents per height (PCHIP-smoothed, no facets), thickness clamped near the hairline
  (short sides, full top), soft grooves along curves (darkened by the bake via `CFG['groove_dark']`); then
  `hair_lock(g, name, keys)` for rounded locks lying on it (uses `g.hair_surface`). For long/curly hair write extra
  locks or a `disp(u, v, p)` callback; the hairline/edge functions are per-guest callbacks.
- suit body: `jacket(g, J)` (profiles, opening, rounded fronts; sets `g.chest_y/back_y` from the actual mesh and `g.jw`
  weights), `lapels` (notch: `outline`+`collar` leaves; a peak/shawl lapel is just a different outline), `pockets`
  (flaps + chest welt + optional `shade` line; `lapel['edge_shade']` draws a shadow line along the lapel's outer edge;
  `lapel['wrap']` builds the jacket collar as ONE smooth surface round the neck turning down into the collar leaves), `buttons`, `back_seam` (seam + vent), `shirt_front`, `collar` (`S['wrap']`: ONE smooth band + points
  surface via `wrap_collar()`, which follows the real jacket surface: no shards where parts meet), `tie` or `bow_tie`, `arms` (`A['sleeve']` = material, or None for bare skin arms), `cuffs`, `hands` (palm + 4 curled
  fingers + thumb), `trousers` (one surface with crotch, soft break; optional `leg_profile` [(pct, w, d)] and `leg_x_hem` for a straight
  outer line with a taper to the ankle), `shoes` (derby: sole edge, toe cap, facing, laces).
  A dress guest skips jacket/lapels/pockets/shirt/tie/trousers and adds her own bodice/skirt builder; `slab()` and
  `ring_wall()` are the generic helpers for raised panels and upright bands.
- finish: `finish(g, RIG, out)` = join (prints tris by part) -> AO + skin tint + material sheen baked into COLOR_0 ->
  rig (Victor's bone names/hierarchy) -> `guest_anim` Walk/Idle (`RIG['walk_kw']`, e.g. `skirt=True`) -> extras
  (`strideLength`, `contactStride`, `walkClipSeconds`) -> the same glTF export settings as Victor.
Budgets: <= 32k triangles, GLB <= 1.2 MB (Marcus: 31.6k tris, 1.20 MB). Hair: `hair_shell(..., lock_fields=[dict(keys, half, height, soft)], lock_base=...)` raises sculpted lock PLANES that
step down onto each other with rounded edges (Marcus: 4 locks); `wrap_collar(..., tuck=)` tucks a collar's back edge into
the body. Prefer wide soft `grooves` (width >= 2x the
shell's vertex spacing) over narrow ribbon locks, which crinkle the surface.

### Henry (`guests/henry.py` + `male_extras.py`)
`python3 tools/char-pipeline/make_guest.py henry` -> `assets/characters/henry.glb` (~31.5k tris, ~1.19 MB). Hair is the kit's
`hair_shell` with sculpted `lock_fields` (quiff edge, top band, two sides, back), then `male_extras.taubin` irons out small
bumps and `male_extras.radial_grooves` makes the bake darken the lock lines even under raised locks. Other bespoke parts in
`male_extras.py` (guest_kit untouched): `glasses`, a fuller `bow_tie`, `studs`, `pocket_square`, `bend_normals` (the round
lower face's shading normals bent forward), plus `env_hair` (an SDF hair sculpt, not used by Henry now). Henry's spec
installs a bake wrapper for its own build only (dress_kit.lift_ao for fair skin + the normal bend). Scratch iteration
renders: `shots/h/`; final six-up: `shots/henry-vs-sheet.png`.
