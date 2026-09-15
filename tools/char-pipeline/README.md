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
| `capture.mjs` | real-game screenshots at any viewport/dpr, N camera rotations (+ crops on Victor), hand/map open, `--still` freezes CSS animations |
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

