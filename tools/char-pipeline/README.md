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
