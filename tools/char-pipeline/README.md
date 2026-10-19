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
| `portrait.mjs` + `portrait_post.py` | interface portraits rendered from the model: the possessed one uses the game's own red eyes (`src/render/possessedLook.js`) on the plum-crimson plate; the normal one is rewritten only with `--normal`. Since Wardrobe W1-B the stock pictures come from `stock-portraits.mjs` instead |
| `stock-portraits.mjs` | the six Looks' stock pictures (`assets/portraits/<look>{,-possessed}.jpg`, 576 x 768) drawn by the game's own portrait code from the current pieces, so they match the runtime portraits exactly: `--port N` compares, `--write` rewrites the Looks that differ (run it after any change to a classic Look's pieces) |
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
node tools/char-pipeline/portrait.mjs all                        # the six private possessed portraits from the model
# node tools/char-pipeline/portrait.mjs victor --normal         # also rewrites a normal portrait (only when a model changes)
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
shell's vertex spacing) over narrow ribbon locks, which crinkle the surface. `lock_crease=` (bake darkening, metres of
"groove") and `lock_crease_geo=` (a real smooth crease, metres deep) mark each lock edge so it reads in the matte game light.
Pale crown fix: the hall's overhead lamps light the top of the hair 2-5x more than the sides, so a mid hair base reads
grey/white from the practice camera. Set CFG `up_dark={'Hair': (amount, power, (r, g, b weights))}` (Victor/Marcus
`(0.89, 0.7, (0.97, 1.0, 1.03))`, Beatrice `(0.92, 0.6, ...)`) and point the hair `sheen` lobe at the front, not up;
check with `capture.mjs --w 1180 --h 820 --dpr 1 --rot 4` (the sides keep their value).

### Henry (`guests/henry.py` + `male_extras.py`)
`python3 tools/char-pipeline/make_guest.py henry` -> `assets/characters/henry.glb` (~31.5k tris, ~1.19 MB). Hair is the kit's
`hair_shell` with sculpted `lock_fields` (quiff edge, top band, two sides, back), then `male_extras.taubin` irons out small
bumps and `male_extras.radial_grooves` makes the bake darken the lock lines even under raised locks. Other bespoke parts in
`male_extras.py` (guest_kit untouched): `glasses`, a fuller `bow_tie`, `studs`, `pocket_square`, `bend_normals` (the round
lower face's shading normals bent forward), plus `env_hair` (an SDF hair sculpt, not used by Henry now). Henry's spec
installs a bake wrapper for its own build only (dress_kit.lift_ao for fair skin + the normal bend). Scratch iteration
renders: `shots/h/`; final six-up: `shots/henry-vs-sheet.png`.

## Dress kit (Eleanor, then Clara / Beatrice)
`dress_kit.py` adds dress-guest parts on top of `guest_kit.py` (which it imports and never changes); specs live in
`guests/<name>.py` and are built by the thin driver `make_dress_guest.py` (same as `make_guest.py`, but finishes with
`dress_kit.finish`, which also writes ONE eye centre as `eyeCentre` for `portrait.mjs`).
```bash
python3 tools/char-pipeline/make_dress_guest.py eleanor          # -> assets/characters/eleanor.glb
node tools/char-pipeline/preview_glb.mjs --glb assets/characters/eleanor.glb --out tools/char-pipeline/shots/el \
     --views body@0,body@30,body@90,body@180,face@9,face@30 --bg 7b716a
```
Parts: `neck_yoke`, `bodice` (bateau / crew / scoop / v neckline), `sleeves` (cap / short / long + puff + cuff; never
narrower than the arm under it), `belt` (metal + buckle / sash + knot + tails), `skirt` (bell / a-line / column or a
measured profile; soft folds, wavy hem, walk-safe weights `sway` / `follow`), `legs`, `pumps`, `lips`, `earrings`,
`eye_shine`, `jaw_lift`, `coil_bun`, the opt-in `soft_nose` / `smile_lips` (round 3: a button nose and a closed smile grown out
of the skin as height fields on the skull mesh via `face_relief`; their smooth normals are set after the join, so there is no crease or
dark ring; `smile_lips` also darkens the parting / creases through `g.post_bake`), and `sculpt_hair` — hair as a signed-distance volume (cap + ellipsoid masses +
ribbon "rolls" along curves + grooves projected onto the surface) meshed by surface nets, smoothed and decimated with
the grooves protected. Build time ~2 min (the hair volume). Eleanor: 31.8k tris, 1.17 MB.
Eleanor's head close-up on the sheet is turned ~9 deg: compare it with `face@9`, and at 423 px/m (her head is smaller
than 0.30 H).

## Parts pipeline (the wardrobe's swappable pieces, `parts/`)
The six guests above are each ONE finished model. The wardrobe needs them cut into **pieces** that share one body and
one rig, so any hair, face, moustache, top, neckwear, trousers and shoes mix (format: the wardrobe W1 contract, sections
3, 4 and 9; the game reads `assets/characters/parts/manifest.json` and `src/data/partsIndex.js`). The kits above are
imported and never changed.
```bash
export LD_LIBRARY_PATH=/usr/local/lib/python3.11/dist-packages/bpy/lib     # bpy's own libraries, in this environment
python3 tools/char-pipeline/parts/build.py m                     # every male piece -> assets/characters/parts/m/ (about 6 min)
python3 tools/char-pipeline/parts/build.py m --only hairStyle_sidePart   # one item (all its face variants; a piece others
                                                                 # shade, e.g. a face, also rebuilds them)
python3 tools/char-pipeline/parts/build.py m --out <scratch>/draft/m     # a draft anywhere (also pieces not shipped)
python3 tools/char-pipeline/parts/build.py m --list              # the items, what each is baked with and what it shades
python3 tools/char-pipeline/parts/manifest.py --check            # ALWAYS after a build: writes the manifest + index, checks
                                                                 # (format, budgets, shadow patches, holes through a hair or
                                                                 # moustache shell; the index carries each piece's red-eye
                                                                 # results: `redEyeNear`, the nearer eye, which the data's
                                                                 # eyesShow gates on, and `redEye`, both eyes, reported)
python3 tools/char-pipeline/parts/manifest.py --check --parts <scratch>/draft   # check a draft (writes only its manifest.json)
python3 tools/char-pipeline/parts/poke.py --body m --item all --out <dir> [--record]       # poke-through test (bpy)
node tools/char-pipeline/parts/review.mjs --body m --item hairStyle_swept --port 9521 --out <dir> [--record]
     # the review sheet + red-eye test (own static server on that port, one headless browser); --item all; --parts <draft>;
     # --mirror victor,marcus,henry (a classic man from pieces vs today's GLB); --grid hair,facial,neck,walk,heel
     # (every combination close up)
node tools/char-pipeline/parts/thumbs.mjs --port 9635 [--body m,f] [--only m/hairStyle_swept] [--out <scratch dir>]
     # the wardrobe's tile pictures (thumbs.html: the game's own code, neutral colours, three-quarters, the portraits'
     # lights and the lobby's rim): hair, moustaches, glasses and earrings on an ivory display head, faces with their
     # own hair, clothes on an invisible body; -> assets/characters/parts/thumbs/<body>/<slot>_<id>.webp (240 x 200,
     # 3-6 kB) and src/data/thumbsIndex.js (GENERATED). Run it after new pieces reach the index; the wardrobe shows a
     # placeholder tile for a piece with no picture, and tests/browser-wardrobe.mjs says which are missing
```
Files: `tables.py` (bones, slots, the material -> palette table, who shades whom, budgets, the six Looks), `glb.py`
(read / write / repack a GLB, no Blender), `core.py` (group, bake in context, shadow patches, export + the post-step:
uint8 weights summing to 255, `Rig` / mesh node names, metallic 0 / roughness 1 / double-sided, scene extras),
`build.py` (the driver), `male/spec.py` (body `m`: every item, its builder, bake settings, context, what it shades),
`manifest.py`, `poke.py`, `record.py` (writes a test result into a file's extras), `review.mjs` + `review/review.html`
(the sheets) + `review/assemble-dev.js` (a dev copy of the proof's assembler; the sheets switch to the game's own
`src/render/avatarParts.js` once it exists).

How a piece is made: built with the kit in ONE Blender scene against the shared body (so every file has the same
inverse bind matrices), joined, **baked in context** (ambient occlusion with the body and its usual neighbours: a hair
with its face, top and neckwear), skinned to the shared rig, exported, post-processed. The shadow a piece casts on
another (hair on the forehead, the jacket hem on the trousers, a bow tie on the shirt) is a **shadow patch** in its
scene extras: per target file, per material, vertex indices and multipliers, with the target's hash (`against`) so a
rebuilt target is never shaded wrongly. Patch vertices the caster itself hides (the trouser top under the jacket, the
skull under the hair) are left out (`core.hidden_by`): they are never seen, and the files stay under the byte cap.

Body `m` (decisions, `male/spec.py`):
- The body is **Victor's**: his proportions, rig, Idle and Walk; it holds the neck and the hands. Victor from pieces is
  pixel-identical to today's `victor.glb` (mirror test: mean difference 0.02 / 255).
- **Each classic face is its own head** (skull, ears, eyes, brows, nose, mouth; Henry's own round frames inside his face as
  `builtInGlasses`), because the skull IS most of the face here. A face sits on the shared neck the way it sat on its own
  body (the head axis keeps its distance to the neck axis). Every hair and moustache is fitted to every face: the plain
  file fits Victor's face, `~face_marcus` / `~face_henry` variants fit the others (3 x 5 hairs, 3 x 2 moustaches; the
  moustache height and size are set per face).
- **Every top is cut on Victor's jacket body and arm joints**: Marcus's suit and Henry's dinner jacket are a touch
  slimmer and keep their own lapels, buttons, pockets, vent or seam, shirt V, sleeves and colours. All tops share ONE
  collar fitting zone (the same shirt collar and chest from the collar to the tie knot; the waistcoat matches its depth
  there), so the bow ties and the tie fit every top. The long tie lies 9 mm forward (it covers every top's studs) and has
  one fitted variant for the waistcoat (`neck_tie~top_waistcoat`: it tucks under the waistcoat's V).
- New pieces fixed from the proof's review: the **Side part** has a natural hairline (soft point, receding temples, no
  straight cut), one soft sideburn tab and three broad comb lines (pass 3: every groove END stays well above the
  hairline: `sculpt_hair` snaps a groove point along a ray from the head centre, and near the hairline that ray can
  land on an inner crossing and cut a hole from inside the thin edge, as pass 2 did four times); the **Waistcoat**'s shirtsleeves have folds (in the geometry and painted into
  the bake) and a cooler white, so they read as cotton in the warm lobby light, not as bare arms.
- The trouser hems follow the heel a little (`heel_follow`): at toe-off today's guests show the shoe's heel through the
  back of the hem; now the hem rests on it.
- Budgets (`tables.py`): Marcus's and Henry's hair shells run 88 segments round (was 92) to meet the 8,000 cap.
- **W1-B men's items** (all in `male/spec.py`, after the W1-A pieces, which build exactly as before):
  - **The Poet** (`hairStyle_lamplighter`, x 3 faces): tousled S-waves to the collar line, built with Beatrice's lock-band
    hair (`guests/beatrice.py band_hair`, imported, unchanged) round each face's skull; its own SDF box (a wider one: the
    crown volume touched the shared `_box` and opened a hole, which `--check` caught). Red eyes: nearer eye 1.0, both
    eyes 0.65-0.77 (in profile the far eye goes behind the waves: allowed by the owner's nearer-eye rule).
  - **Dalí moustache** (`facial_dali`, x 3 faces): one waxed tube, the bar flattened on the lip and the points rising
    beside the nose; per face the bar height, its width and how high the points reach (always below the eyes). 972
    triangles, the handlebar's count.
  - **Smoking jacket** (`top_smoking`): Victor's jacket body with the dinner jacket's shawl line and shirt (the shared
    collar zone: every bow tie and tie fits), a quilted one-sided shawl (`quilted_panel`: top surface + edge wall, no
    hidden underside), turned-back cuffs, piped pockets and two frog closures, all `Trim` (the accent colour); velvet
    mottling and the quilting seams are painted after the bake (`velvet`). It keeps only its darker shadow patches
    (`patch_below` 0.985, read by `build.py`) to stay under its byte cap with room for the recorded tests.
  - **Extras** (attach points from the contract): `extra_blackOrchid~top_<top>` (chest: on each top's lapel, the
    waistcoat's left breast; placed on the top's OUTERMOST surface by a ray, `outer_hit`), `extra_lantern~top_<top>`
    (waist: a fine chain from the front button to the left pocket and a small brass lantern; on the waistcoat only the
    lantern, hung from its own chain), `extra_eveningGloves` (hands: the hand builder at +2.2 mm, coarser, with a wrist
    welt, a pearl button and three stitched points). They take the skin weights of what they lie on.
  - **Henry's bows**: `neck_bow~face_henry` and `neck_bowFull~face_henry` sit 1.2 cm lower and 6 mm forward, because
    his head is further forward on the shared neck and his chin hid the bows from the game camera. A neck piece may now
    be fitted to a face (`neck(..., face_fit=)`); `poke.py` tests such a variant on every top, and has a gloves pair
    (hands inside the gloves, the glove's wrist inside every top's cuff).

Body `f` (the women: `female/spec.py`, its own driver `female/build.py`, same options as `build.py` plus `--just`, a
quick draft of only the asked pieces; about 8 min for all 32 files; then `manifest.py --check` as always):
```bash
python3 tools/char-pipeline/parts/female/build.py                          # every female piece -> assets/characters/parts/f/
python3 tools/char-pipeline/parts/female/build.py --out <scratch>/draft/f  # a draft;  --only <ids> [--just];  --list
node tools/char-pipeline/parts/female/grids.mjs --port 9531 --out <dir> [--parts <draft>]   # every hair / earring / belt /
     # gown on every face or gown, and the gowns walking (the "every piece mixes" sheets)
node tools/char-pipeline/parts/review.mjs --body f --item all --port 9531 --out <dir> [--mirror clara,eleanor,beatrice]
```
- **ONE shared body** for Clara, Eleanor and Beatrice (not the fallback of three gown bodies): it holds the neck and
  yoke, the bare arms and soft hands, the bare legs; Clara's legs, pumps, shoulders and rig; arms set a little wider
  than Clara's (Eleanor's wrists: her ballgown is 0.26 m wide at hand height). Mirror test: each woman from pieces is
  within 1-1.6 % of pixels of today's model at the game camera.
- **Every bodice shares one upper torso** (30.6-34.5 %, the neckline-to-shoulder zone) and one yoke fitted inside it
  just below every neckline; below it each gown keeps its own bust, waist, sleeves and skirt (walk-safe skirt weights
  from dress_kit). Eleanor's shoulders and bateau neckline sit ~1.3 % lower; Beatrice's bodice top comes 2.2 cm forward.
- **Faces** are whole heads at their own heights (Eleanor's 3.8 cm higher), on the shared neck. The skull is open only
  under the CROWN every hairstyle covers (`spec.CROWN`; a new style must cover it too). **Hair** is fitted to every face:
  each style is built by its own guest's builder round the target skull, aligned on the skull top (3 x 3 files).
  **Earrings** (extras, 'ears') sit at each face's lobe (3 x 3); **belts** are fitted to each gown (2 x 3) and take the
  gown's own skin weights.
- Folded in: Eleanor's chin shadow on the neck rides in her face's patch on the body; the hair's shadow on the gowns is an
  extra patch kept 3 % lighter (`patch_soft`, it keeps the long styles under the byte cap); the gold belt shades every
  gown the same.
- Known, as today: the curled fingertips rest inside the ballgown's and A-line's folds at rest (today's Eleanor and
  Beatrice do the same).
- Red-eye: every face, gown, belt and earring scores 0.99-1.00. The hairstyles score 0.75-0.97 in the facing views. The
  low ones all come from the exact side view (heading 90): there the eye NEAREST the camera stays 100 % visible with every
  style on every face, and what the fringe covers is the sliver of the far eye seen over the bridge of the nose (today's
  Beatrice: 0.756, her own bob hides that sliver completely; from pieces 0.757).
- **W1-B women's items** (`female/w1b.py`, registered by two lines at the end of `female/spec.py`; the W1-A pieces build
  exactly as before):
  - **Braided crown** (`hairStyle_lamplighter`, x 3 faces) and **Marcel waves** (`hairStyle_marcel`, x 3 faces) are
    written against the face they are fitted to (its skull top, chin, ears), so one description fits every face; both
    measure the skull radially (`male_extras.radial_skull`: `sd_skull`'s horizontal slices give a thin cap a nub on the
    crown). The crown's plait is three closed ribbon strands round the head (a whole number of plait cycles, so each
    strand closes on itself and the hole check sees no open loop). The finger waves are a sawtooth relief on S-shaped
    crest lines, a sculpted front roll, and a painted mirror shine on every crest.
  - **Deco beaded gown** (`dress_decoBeaded`): the shared torso, the ballgown's cap sleeves, a V neck, a straight bodice
    to a dropped waist (55 %), the column skirt's walk-safe weights to mid-calf and a beaded fringe (the metal colour);
    the beadwork (`Gold`) lies on the gown with its weights. Both belts have a fit for it (at the dropped waist). The
    classic hairstyles do NOT cast a shadow patch on it: one more patch takes the waves and the wavy bob over their byte
    cap (the new styles do).
  - **Extras**: `extra_lantern~dress_<gown>` (neck: a fine chain on the outermost surface of neck and gown, a brass
    lantern pendant), `extra_blackOrchid~dress_<gown>` (chest: two orchids and three buds at her left shoulder, the men's
    flower and colours), `extra_eveningGloves` (hands: long opera gloves on the arm's own stations to 45.6 %, the palm and
    wrist as one envelope; under the A-line's long sleeves only the hands show). `poke.py` has the women's gloves pair
    (arms and hands inside the gloves; the gloves inside every gown's sleeves, hands exempt as for the gowns).

Tests: `poke.py` (contract 9.4; inside / outside by ray parity, 6 directions; vertices that leave past an OPEN edge, a hem
or a cuff, are not pokes; the one exemption: the shoe's top rim in the bottom 20 mm of the closed trouser leg, where the
hem can only lift off it) and a front check for neckwear (no stud in front of a visible tie or bow). The women's
gown and belt pairs use its `vis` mode: a point hidden under the cover at rest that can be SEEN through it at a pose,
2 mm further out than at rest (gowns overlap themselves and a belt is an open band, where parity misreads). The red-eye test
(contract 9.3) reports two scores: **strict** (the contract's words: every view whose reference shows 30 ID pixels) and
**facing** (only headings where the face is toward the camera); from behind, at 135 degrees, today's own swept hair
hides the 40-60 pixel sliver of eye that shows past the cheek, so the strict rule cannot be the shipping gate.
Since the owner's decision of 19 Oct 2026 ("Allow if the nearer eye shows") the gate is a third score, **near**: the same
facing views, each eye in its own ID colour, and only the eye nearest the camera scored (both eyes when they are about as
near, face-on). `--record` writes `redEyeMin` (facing, both eyes) and `redEyeNearMin` (near) into the piece's extras;
`manifest.py` copies both into the manifest and `src/data/partsIndex.js` (`redEye`, `redEyeNear`). Every piece built
by 19 Oct scores 1.0 on the nearer eye, the Wavy bob on Clara's and Eleanor's faces and the chignon on Beatrice's
included (their far eye goes behind the hair in profile). Glasses are drawn by the game's code: no red-eye gate on
eyewear (the owner, 19 Oct 2026); `tests/avatar-check.mjs` section 5 measures and reports every style. Note: the
two recorded numbers add about 20 bytes to a file; `top_tux` was 4 bytes from its byte cap, so it carries only
`redEyeMin` (1.0, which the data uses in its place).

Fixes after the W1-B review (19 Oct 2026):
- **`hidesSkin`** (scene extras, from a spec's `extras`): the body's skin a piece covers completely, as bone names
  (`'hand.L'`) or `{ 'bone': 'upperarm.L', 'below': 0.9025 }` (that bone's skin below a height, metres, bind pose);
  the game leaves those Skin triangles out of the guest (`src/render/avatarParts.js`). The gloves use it; the women's
  build asserts the glove top has not moved from `GLOVE_HIDE_BELOW`.
- **The orchid** (`male/spec.py` `orchid_parts` / `orchid_paint`; the same code copied into `female/w1b.py`: change both
  together): sepals, petals, a frilled lip and a column, tinted near-black plum after the bake over a lavender base.
- **`copy_weights_surface(objs, src)`** (`female/w1b.py`): the exact weights of the nearest triangle of `src` for each
  vertex (the Deco gown's hem bead lines and fringe); `copy_weights_from`'s k-nearest blend let thin details slide
  through the cloth while walking.
- **Henry's bows**: `HENRY_BOW_SPAN` / `HENRY_BOW_SWEEP` (shorter wings, less back-sweep on his face only).
- **`thumbs.html`**: a woman's necklace is drawn on a dress form's bust (her gown, the body's neck and shoulders, no
  face).
