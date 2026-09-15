# Character + GUI phase — working checkpoint

_Living document. Updated after each meaningful increment so a new session (or a new agent) can
continue without redoing finished work. If you are resuming: read this whole file first, then check
`git log` for the last working commit named below._

## ACTIVE SCOPE (owner's brief, 2026-09-14, later in the day): VICTOR'S APPEARANCE ONLY
This supersedes the broader milestone below. Rebuild Victor's 3D look to closely match the owner's
references: `tools/char-pipeline/ref/hotel-reference.jpg` (identity: the moustached man in the navy
tuxedo), `ref/victor-sheet.png` (AI-generated turnaround: front / three-quarter / side / back / face
close-ups / elevated — reconcile small inconsistencies into one coherent model; the front view is the
neutral-proportion authority, the elevated panel is NOT a camera spec). Panels are cut from the sheet
by `make_panels.py` into `ref/panels/` (gitignored, regenerable). No rooms, other characters, GUI or
gameplay work until the owner approves Victor. Hotel lighting unchanged. Rig/animation reused.

### Status: pass 3 (hair locks, baked shading) presented; NEXT PASS = body/clothing/shoes (brief below), scheduled to start after the usage-window reset
- Branch `main`. Base commit `684ffd2`; this increment = **`26bdf8e` "Victor v5"** (pushed). Published version = working version (no separate experiment branch was needed).
- Changed: `assets/characters/victor.glb` (v5), `assets/portraits/victor{,-possessed}.jpg` (re-rendered
  from v5), `tools/char-pipeline/make_victor.py` (head/hair/body rewrite, CFG in % of height),
  `victor_lib.py` (+ `shell`, `superellipse_pt`, `normal_of`, `lerp_table`), `preview_glb.{html,mjs}`
  (+ `body@yaw` / `face@yaw` views, albedo-faithful neutral light, long lens), `portrait.mjs` (new eye
  coordinates), NEW `compare.py`, `compare_head.py`, `make_panels.py`, `ref/`.

### NEXT PASS (owner's brief, 2026-09-15): BODY, CLOTHING CONTOURS AND SHOES — NOT STARTED, scheduled
Continue from commit `bbc1c88`, asset `e452d672`. Keep the hair-and-shading result as the baseline (copy the
GLB aside first: `cp assets/characters/victor.glb <scratch>/victor-bbc1c88.glb`; re-render its views with
`preview_glb.mjs --glb <that copy>` as the "current baseline" column). Victor remains under visual review.
1. **Verify the arm-builder issue.** Inspect `capsule()` and `rounded_rect_ring()` in
   `tools/char-pipeline/victor_lib.py`: are physical limb radii still passed into a parameter that expects a
   normalised roundness (0..1)? If so, separate size from roundness, correct the intended capsule
   cross-sections and audit every caller (arms, legs, neck, cuffs, hands) — do NOT globally make every body
   shape circular. If already fixed, identify the correction and find out why the sleeves still look
   segmented (joint spheres + straight capsules: shoulder ball, elbow ball, separate upper/forearm).
2. **Jacket and sleeves to the reference**: rounded shoulders, restrained waist taper, shaped front hem with
   the sheet's curved lower corners; sleeves with continuous natural contours through upper arm, elbow and
   forearm (not inflated tubes); lapels following the chest and readable. Garment shape first; seams, pockets
   and cuff buttons only after.
3. **Trousers and shoes**: refine trouser contours through knees and ankles keeping the slim proportions;
   shoes with a rounded toe, raised instep, defined heel and modest sole thickness; match length/width to
   the sheet at equal displayed height; check front, side and elevated views — convincing volume everywhere.
4. **Preserve the integration**: keep head, hair, baked shading, pose and movement; adjust skin weights
   where geometry changes (check shoulders, elbows, knees, ankles in Idle/Walk: `walk_check.mjs`,
   `capture.mjs --walk`); keep floor contact, facing, doorway clearance, selection ring; rooms, lighting,
   camera, GUI, other characters, rules unchanged.
5. **Comparison**: reference / current baseline (bbc1c88) / updated at MATCHING scale, pose and angle (fix
   the panels where the reference shows larger than the model: fit both to the same displayed height);
   front, three-quarter, side, back body views, a shoe close-up, real gameplay captures; one identified
   asset throughout; no video. Report the confirmed cause of the boxy sleeves, visible improvements,
   remaining differences, asset size/tris/scene cost (browser numbers, not iPad).
Eyebrows, moustache and ears stay recorded for the following facial-detail pass. Present this body
correction for review before expanding further. Keep this checkpoint current; save the exact state before
context/usage limits.
Tooling notes for the pass: `preview_glb.mjs` views `body@yaw` (long lens), `elev30@yaw`; add a `shoe`
close-up view if needed; `compare.py` for silhouettes; `glb_inspect.py` for the export; `portrait.mjs`
only if the head changes (it does not).

### Pass 3 (owner feedback after 89ebebf): HAIR LOCKS + BAKED SHADING — built, reviewed, PRESENTED FOR REVIEW
Baseline for comparison: asset `89ebebf` (its GLB is kept in the session scratchpad; renders `shots/base89-*`
were re-made with the corrected previewer so both columns are like-for-like).
- **Asset revision**: `assets/characters/victor.glb` 816,340 bytes, sha256 `e452d6728a31…`; 21,964 tris,
  11,141 verts, 7 materials, one skinned mesh, COLOR_0 on every primitive. Hall scene with Victor: 339 draw
  calls, 48,970 triangles, 13 programs (headless Chromium count — NOT an iPad measurement; nothing here is
  iPad performance evidence).
- **How the hairstyle is built now** (from a pixel-measured analysis of the sheet, `tools/char-pipeline/
  ref/` panels): the sheet's hair is one big comma-shaped SWEEP (W) — from the part on his left-front,
  across the front-top, curling round his right temple, then back along his right side above the ear to a
  point at the right-rear — with a CROWN LEAF (T) on top of it ending in the same right-rear point, an
  abrupt PART STEP on his left (x ≈ +0.14 m, the top drops ~5 cm), and a smooth nape with no back lock or
  whorl. In `make_victor.py`: the fitted cap (`hair_outer`) carries the part step (crown hair combed flat
  beyond x = +0.134), the two raised lock REGIONS (T +1.0 cm, W +0.6 cm, bounded by the sheet's crease
  lines converted with `uz_from_sheet` / `periodic_table` into `z_T(u)`, `z_W(u)`), the crown's highest
  point a little on HIS LEFT with the top descending gently to his right, a rounder top-front corner, and
  ONE rounded roll (`lock('LockW')`, `ribbon_tube` lens sections meeting the cap tangentially, ends tucked)
  for W's shoulder and the forward-overhanging front wave. Sides, nape (27.4 %) and sideburns are the cap
  itself; no piece floats and nothing crosses another lock. Everything hair is weighted to the head bone.
  (A first attempt with four free tubes — front wave, second sweep, crown-back lock, side lock — was
  reviewed and rejected: a stuck-on back strip, crown creases meeting in a Y, tiers at lock edges.)
- **Shading**: per-vertex ambient occlusion baked in Blender (`bake_vertex_shading`: BVH hemisphere rays,
  32 rays, 0.26 m reach, strength 0.50 on skin/cloth and 0.35 on hair, ~1 s), a warm cheek/nose tint (−8 %
  green, −14 % blue) and a 12 % darkening of the ear cups and ear–head junction. Exported as glTF COLOR_0
  (`export_vertex_color='ACTIVE'` = the RENDER colour attribute; UNSIGNED_SHORT normalized, linear; values
  kept ≤ 1.0 because the uint16 export wraps). The game loader dropped vertex colours in its Lambert
  conversion: `src/render/characterView.js` now sets `m.vertexColors = true` when the loaded material has
  them (one line; nothing else in the game changed). The previewer had the same gap — fixed in
  `preview_glb.html`, which is why the first review round saw no shading in the neutral close-ups.
- **Colour management checked** (investigation agents): renderer outputs sRGB with NeutralToneMapping,
  materials shaded in linear, GLTFLoader treats COLOR_0 as linear and multiplies the diffuse in linear
  space; the tone mapper crushes linear values below ~0.08, so baked darkening is nearly invisible on the
  near-black hair and works on skin and cloth. Skin: the sheet's lit skin measures ≈ #f4a877; base authored
  `#f0b992` (one step lighter / less saturated), checked under the unchanged hall light (warm tan, not
  orange). Hair `#26201b` (desaturated cocoa: the warm point lights turned the earlier espresso caramel).
- **Independent review round** (three reviewer agents on the first build): hair-structure FAIL (back strip,
  crown cracks, tiers, symmetric peak, side thickness), surface PASS-WITH-NOTES (previewer dropped vertex
  colours; hair caramel in game; cheek tint too faint; bright ear rim), completeness FAIL (close-ups clipped
  the hair top; elevated row not like-for-like; skin not established against the sheet). All addressed in
  the second build except the disputed ones below.
- **Evidence**: `shots/v8-review.png` — reference / baseline 89ebebf / updated e452d672: front, three-quarter
  and side close-ups (full hair + headroom) under neutral light and the updated one under the game light;
  the sheet's ~30° elevated view like-for-like (`elev30` view) plus steep 56° crown checks front / ¾ /
  back for both assets; back view; real-game captures at zoom 1.8 and normal zoom, four rotations,
  baseline beside updated. Portraits re-rendered from the new model.
- **Deferred to the next review (owner's list)**: angular eyebrows, moustache curvature, jacket and sleeve
  contours, shoe volume; seams, cuff buttons and finger details after those.
- **Still different from the sheet (honest)**: the front wave's tip does not curl down as far as the sheet's
  rolled lobe (overhang ~2.5 cm vs the sheet's ~2.7 cm, but flatter-fronted); lock relief is subtler than the
  sheet's soft-lit render; the reviewers also wanted the nape cut to ear-lobe level and the head shallower
  behind the ear — the sheet's own side and back panels measure the nape 6 % of head height below the
  lobe and the depth as modelled, so those were kept. Skin in the hall light is a warm tan; the sheet's
  studio peach is not reachable without changing the lights.
- Tests pass (rules, logic, browser). Not measured: real iPad frame rate.

### Correction pass 2 (owner feedback after v5): head, hair, features, collar, bow tie — PRESENTED FOR REVIEW
Owner's verdict on v5: not approved; differences beyond the four listed. Scope of this pass: head,
hair, facial features, collar and bow tie only; body, rig, movement, rooms, camera, rules, GUI untouched.
- **Asset revision**: `assets/characters/victor.glb` 693,544 bytes, sha256 `774b6f81aef5d367…`
  (v5 was 684,296 bytes, `9535c90a…`). Verified with `diag_materials.mjs` that the real game page
  requests exactly this file (one 200 response, same byte count) — the previewer loads the same path.
- **Pale crown — confirmed cause**: NOT missing hair, NOT exposed scalp, NOT a material mix-up.
  Unlit diagnostic (hair magenta, skin green, real game camera, four rotations,
  `shots/diag-sheet.png`): the crown is solid hair geometry from every angle. `glb_inspect.py`: hair
  normals point up on the crown, winding agrees with the normals (0.2 % disagree), no degenerate
  triangles; the game's loader keeps the exporter's double-sided flag, so nothing is culled. The crown
  went pale because it is the surface facing the hall's warm overhead point lights and sky most
  squarely: it receives 2–3× the irradiance of the sides, and the hair albedo I had lightened for the
  neutral preview (`#382920`) tone-mapped to a desaturated tan that read as scalp; the part/lock
  grooves rendered as dark cracks on top. Fix in the asset only: hair authored dark espresso
  `#1e140e` (the sheet's value), grooves half as deep and wider. Hall lighting and the loader are
  unchanged; the diagnostic tooling touches nothing in the game. Acceptance: dark hair recognisable
  from above at all four rotations (`shots/v6-game-sheet.png`, zoom 1 and 1.8).
- **Features** (`shots/v6-head-sheet.png`, front / three-quarter / side, sheet vs neutral vs game
  light): moustache rebuilt as two compact rounded lobes with a notch under the nose and short
  upturned tips (0.185 wide, ~2 cm relief); nose bridge raised OUT of the skull mesh as a soft ridge
  from between the brows into the ball (no stub); brows slimmed to 0.024 with one gentle arch; eyes at
  the sheet's measured 0.038 × 0.066 at ±0.070; cheek and chin fullness shapers; ears rebuilt as an
  outer rim (rounded tube on an oval) with a recessed inner dish and a filler to the skull, angled
  forward-and-out.
- **Collar / bow tie**: fitted shirt band round the neck with two small folded points flanking the
  bow (`cylinder_leaf`), one connected bow (two wings pinched into a knot, one loft) resting on the
  band, satin jacket collar wrapping only the back and sides of the neck into raised lapel peaks.
- **Surface / material handling inspected**: exported vertex normals present, auto-smooth 62°, no
  flipped shells, per-fragment Lambert in the game, colours authored sRGB → linear. No emissive, no
  specular, no lighting change. What remains is the flat-matte look by design.
- **Remaining mismatch (honest)**: hair is still one cap without the sheet's separate locks; skin
  under the hall light is darker/oranger than the sheet's peach; the ear reads as a ring at close
  range; the sheet's soft ambient shading is absent (flat Lambert); the moustache tips are straighter
  than the sheet's curls. These need either lock-by-lock hair volumes and baked shading (more
  code-built passes) or an artist-made asset.
- Tools added: `diag_materials.mjs` (unlit diagnostic in the real game), `glb_inspect.py` (GLB
  geometry/normal audit), `preview_glb.mjs --light game`.

### Measured proportions (sheet FRONT panel, % of standing height from the top; H = 1.66 m)
hair top 0.2 · hairline 8.6 · brows 13.0 · eyes 17.3 · nose ball 20.3 · moustache 22.5–26 (centre
23.7) · mouth 27.3 · **chin bottom 31.5** (the chin sits on the collar; earlier 28.5 % was the jaw,
not the chin) · ears 16–27 (centre 21.2) · collar top ~32 · shoulder point 38–40 · elbow 55.5 · wrist
66.5 · hands end 72.5 = jacket hem · knee 86.5 · ankle 96. Widths (m): skull 0.378 at the cheekbones,
ears to 0.485, hair 0.45 at the temples; jacket 0.515 at the shoulders, 0.465 waist, 0.50 hem; legs
±0.114, shins 0.155; shoes 0.42 long × 0.20 wide × 0.075 tall, splayed 15° outward. Depth (SIDE
close-up): forehead 0.233 in front of the skull axis, occiput 0.215 behind; nose +0.043 from the face
plane, moustache +0.02, chin −0.015; hair quiff 0.024 in front of the forehead, hair top flat over
0.24 m. Features: eyes 0.040 × 0.068 at ±0.071; brows 0.036→0.116, 0.034 thick; nose ball 0.080 ×
0.064; moustache 0.20 wide, 0.062 thick; ears 0.115 tall discs standing 0.05 out. All in `CFG` +
the `W/DF/DB/E_TAB` (skull) and `HW/HF/HB/HE_TAB` (hair) tables in `make_victor.py`.

### Design decisions
- Skull = superellipse shell driven by height tables (half-width, front depth, back depth, squareness)
  read off the sheet; features are placed ON the analytic face surface (`on_face`), so nothing floats.
- Hair = its OWN cap with measured front-width and side front/back-depth tables, a rounded lip at
  the hairline, never thinner than 14 mm over the skull; swept to HIS RIGHT (+16 mm), rounded lobe over
  his right temple, part groove on HIS LEFT with the hair combed flat beyond it, three soft lock
  grooves, sideburn wisps to ear-centre height, nape at 27.8 %.
- Face: no highlight beads, no nose bridge stub (ball only), moustache as two flattened teardrop
  tubes + a centre fill under the nose, bold tapered brows, ear discs angled 12° forward.
- Body: sloping jacket shoulders from the collar (no shoulder-ball bulge), jacket collar (satin) round
  the neck with 8 mm of shirt collar showing, bow tie at the chin, narrower shirt V, hem 0.24 deep.
- Materials unchanged in kind (7 flat sRGB colours → Lambert on load); hair lightened to `#382920` so
  the sculpted forms read; skin `#eebe95` kept (renders peach under the hall's warm lights).
- Neutral preview light is now albedo-faithful (Lambert divides by π; hemisphere 1.5 + key 2.3) so
  material colours can be judged before the game's lighting is applied.

### Silhouette match vs the sheet (`compare.py`, equal displayed height, bands every 4 %)
front IoU 0.855 · side 0.694* · back 0.880 · three-quarter 0.799 (v4 was 0.843 / 0.819 / 0.814).
Head close-ups (`compare_head.py`): front widths within ±2 % of head height at every band except
the ear band (ours reach 3 % lower); side profile within 0.02 of head height everywhere except the
nape (ours 0.05 fuller). *Side IoU is dragged down by the shoe: the sheet's shoe is 0.45 m long but
drawn low and thin; ours is 0.42 m and reads taller from a level camera. Front/back are the
authority for proportions.

### Verification (real game page, headless Chromium/SwiftShader)
- `capture.mjs --rot 4` at 1194×834@2: `shots/v5g-r{0..3}.png` (+ crops, `v5g-rotations-sheet.png`).
  Feet on the floor, faces the heading, fits the doorways, no clipping at the neck/elbows/knees.
- `walk_check.mjs`: phase advances by distance ÷ stride (0.700 m), mesh on the mover, doorway
  crossing OK, no console errors (wall-clock settle times are meaningless at ~3 fps).
- Recording: the 30 fps game-time-stepped `record_smooth.mjs` run timed out twice under the software
  renderer (once while a second renderer job ran, once alone after ~30 min) and was SKIPPED at the
  owner's request. `walk_check.mjs` did leave its own real-game webm (`victor-walk.webm`, ~1.4 fps
  wall-clock, choppy) locally; the owner should judge motion on the iPad instead.
- `scene_stats.mjs`: 339 draw calls, 48,026 triangles, 13 programs with Victor loaded.
- Budget: victor.glb **21,020 tris / 7 materials / 684,296 bytes** (v2: 14,420 / 8 / 480 KB). Fine
  for one hero character on an iPad; not measured on a real iPad.
- Tests: `node tests/rules-check.mjs && node tests/logic-check.mjs && node tests/browser-test.mjs`.

### Remaining differences (honest)
1. The sheet's hair is a sculpted mass of 3–4 distinct locks; ours is one measured cap with shallow
   grooves — right silhouette, simpler surface. At game zoom this is invisible; in the portrait it is
   visible.
2. Ears are plain angled discs (no helix/bowl relief). Hands are mitts with a thumb (fingers not cut).
3. Arms hang straight; the sheet's bend slightly at the elbow with the hands turned in.
4. The sheet is soft-shaded (ambient occlusion, gradients); the game is flat Lambert by design.
5. The AI sheet is asymmetric (his right side ~3 cm wider from crown to jaw, ears unequal); the
   model is symmetric except the hair sweep. The sheet's back panel is drawn ~7 % larger than its
   front; the front was used.

### Next concrete action
Wait for the owner's review. If approved: commit any tweaks, then continue the paused milestone
(other guests, rooms, GUI). If changes are requested: adjust `CFG` / tables in `make_victor.py`,
rebuild, run the loop (`preview_glb.mjs … --views body@0,body@90,body@180,face@0,face@35,face@90`,
`compare.py`, `compare_head.py`, `capture.mjs`), update this file, commit to main.

## Goal of the previous phase (owner's brief, 2026-09-14, morning)
Bring **Victor** (the first real 3D guest), his **movement** and the **player interface** up to the
attached cartoon target image so they form a convincing, consistent visual result. Scope for THIS phase
only: Victor's model + matching portrait; standing / walking / turning / stopping; the interface
(portraits, status, cards, buttons, map). Then present for the owner's visual review. **Do not start**
the remaining characters or rooms until approved.

Keep: room art, layout, camera angle, controls, rules, action costs, discovery, collisions, hot-seat
behaviour, Three.js + GitHub Pages + relative paths + no build step.

## Branch / commits
- Branch: `main` (project rule: commit directly to main so the Pages preview updates).
- Last working commit before this phase: `fca6199` — Victor v1 (upright head, matte shading, sRGB colours).
- Phase commits so far: `77cc0ca` tooling/checkpoint · `673ee96` Victor v2 model · `6f6ba6b` movement + portraits · interface commit (see `git log`). All pushed to `origin/main`.
- Phase commits are listed under "Completed increments" below as they land.

## The target, measured (from the reference image)
Measured on the reference (1456×1092 px), Victor mid-walk, front-left 3/4 view:

| Feature | Measurement | Ratio |
|---|---|---|
| Total height (hair top → shoe bottom) | ≈225 px | 1.00 |
| Head incl. hair | ≈80 px | **0.36** (≈2.8 heads tall) |
| Face (hairline → chin) | ≈55 px | 0.24 |
| Head width (ear to ear) | ≈68 px | — |
| Shoulder width | ≈85 px | **1.25 × head width** |
| Torso (shoulder top → jacket hem) | ≈65 px | 0.29 |
| Legs (hem → shoe bottom) | ≈72 px | 0.32 |
| Shoes | ≈12 px tall | — |
| Hands | ≈14 px round | reach mid-thigh |

Shape notes (what makes the target read as *designed*, not assembled):
- **Skull**: rounded, a touch wider at the cheekbones than the crown, soft jaw, small rounded chin; the
  face below the hairline is slightly taller than wide.
- **Hair**: dark brown / near-black (≈ `#22170f`), **side-parted** (part on his left = viewer's right),
  swept up and across with a soft front quiff; clean hairline; covers the sides down to just above the
  ears; the top mass has real volume (≈20 % of head height above the skull).
- **Brows**: dark, gently curved, tapered ends, relaxed (not angry).
- **Eyes**: small dark ovals sitting ON the face surface, one tiny highlight each.
- **Nose**: small rounded button. **Ears**: small, integrated, at eye level.
- **Moustache**: dark, a curved silhouette wider than the nose, tapered ends that turn slightly
  outward/down; a subtle small mouth line below it.
- **Jacket**: dark navy (≈ `#1c2a4a`) tuxedo with **rounded shoulders**, a modest waist taper and a
  clean hem at the hip; **peaked lapels** a shade lighter (satin); ivory shirt front as a V; black
  **bow tie with two wings + a centre knot**.
- **Sleeves** taper slightly; **trousers** navy, straight with a slight taper; **shoes** black, small,
  rounded; **hands** peach, simple rounded mitts.
- **Shading**: matte, soft cel-like gradient, warm key light, no specular hotspots, a little darker
  under the chin and lapels.
- **Portrait in the target HUD**: same character as a bust, on a charcoal plate with a brass hairline.

## Current implementation (inspected 2026-09-14, commit fca6199)
- `tools/char-pipeline/make_victor.py`: primitives (bevelled boxes, ico-spheres, cones) joined into one
  mesh; rigid per-part vertex groups; armature root/hips/spine/head + thigh/shin + one arm bone per
  side (**no elbows, no ankles, no shoulders**); Idle (48 f) + Walk (24 f) actions; GLB export.
  Head = scaled sphere; hair = one larger sphere (an overlapping cap); brows + moustache = bevelled
  boxes; eyes = squashed spheres; jacket = one bevelled/subsurfed box; lapels = flat boxes; bow tie =
  two boxes. 4,420 tris, 6 materials, ~217 KB.
- `src/render/characterView.js`: GLTFLoader → converts PBR materials to `MeshLambertMaterial`
  (matte, keeps colours); AnimationMixer cross-fades Idle↔Walk by `mover.walking`; Walk timeScale =
  clamp(measuredSpeed / cfg.player.speed, 0.5, 1.7) — **stride not matched to distance**.
- `src/data/characters.js`: `tuxedo.model = 'assets/characters/victor.glb'`, `modelHeight: 1.8`.
- `src/ui/portrait.js`: `PORTRAIT_ART.tuxedo` = painted `victor.jpg` / `victor-possessed.jpg`.
- HUD (`src/hud.js` + `styles.css`): bottom row = player panel (left) · hand strip (centre, absolute)
  · control row + action row (right). Known problems from the screenshots: **hand strip overlaps
  Search** at ~1194 px wide; strip names over bright walls are unreadable; several targets < 48 px.

### Gap analysis (current vs target) — from `tools/char-pipeline/shots/base-r{0..3}-crop.png`
Viewport 1194×834 CSS px @2 (2388×1668 px), normal zoom, all four camera rotations.

| Dimension | Current (v1) | Target | Verdict |
|---|---|---|---|
| Silhouette | Smooth hair-ball on a narrow dark slab; arms are thin lines; from behind the eyebrow boxes poke OUTSIDE the head outline | Chunky rounded figure: big designed head, rounded shoulders wider than the head, compact torso, short legs | **Fail** — the single biggest gap |
| Proportions | head 28 %, torso 22 %, legs 45 % of height; shoulders 1.06× head width | head 36 %, torso 29 %, legs 32 %; shoulders 1.25× head | **Fail** — too leggy, too narrow |
| Face | flat box brows, ball eyes, ball nose, box moustache; no mouth; ears invisible | curved tapered brows, small eyes on the surface, button nose, curved tapered moustache, subtle mouth, small ears | **Fail** (crude) |
| Hair | one smooth cap, no part, no direction, no volume, symmetric | side part, swept quiff, clean hairline, volume on top | **Fail** |
| Clothing | jacket = box; lapels/bow tie/shirt V unreadable at game size; sleeves boxes; hands tiny balls; shoes blobs | rounded shoulders, waist taper, hem; peaked lapels; ivory V + bow tie with wings/knot; tapered sleeves/trousers; readable mitts; small rounded shoes | **Fail** |
| Shading / colour | matte Lambert (good); jacket near-black so it merges with trousers, shoes and shadow | matte, but navy jacket distinct from black tie/shoes; lapels a shade lighter | Partial |
| Readability @ game size | reads as "dark blob with hair ball"; bow tie / shirt invisible; face only at r0 | figure, tuxedo and face read at a glance | **Fail** |
| Animation | thigh-only sine swing, arms rigid, no elbows, no foot contact; cadence = speed-scaled | grounded walk, opposing arm swing with elbows, weight transfer | **Fail** |

GUI (from `base-1024-r0.png`, `base-portrait-r0.png`, `base-hand.png`):
- 1024×768 landscape: bottom row fits (media query) but is tight; **top-strip names unreadable over the
  bright wall** ("Eleanor", "Beatrice", "Henry" ivory-on-ivory) — no dark backing.
- 834×1194 portrait: **hand strip overlaps Search** (card backs under the Search label, count badge
  hidden); "YOUR TURN / NEXT" flags wrap; Trade / End turn cramped.
- Hand open: **verified a capture artifact** — with `--still` (animations frozen) the sheet is solid
  (`base-still-hand.png`). The headless renderer had frozen the `sheet-up` entry animation at its first
  frame. Always capture overlays with `--still`.
- Map (`base-still-map.png`): works; plain single-room plate, and the active-player heading arrow
  overprints the room label when the player stands at the room centre (spawn). Presentation to improve.
- Tap targets: `.ctl` 46–50 px, `.private-link` ~20 px tall, `.mini-player` cells fine, hand-close 52 px.

## Environment / commands
```bash
python3 -m pip install "bpy==4.2.0" pillow      # Blender 4.2 as a module (headless), PIL for crops
python3 -m http.server 8123 --bind 127.0.0.1 &  # serve the repo root (tests + capture use it)
ln -sfn ../../tests/node_modules tools/char-pipeline/node_modules   # playwright-core for the .mjs tools

python3 tools/char-pipeline/make_victor.py       # rebuild assets/characters/victor.glb (prints REPORT lines)
node tools/char-pipeline/preview_victor.mjs      # isolated front / game-angle renders of the GLB
node tools/char-pipeline/capture.mjs --out tools/char-pipeline/shots/NAME --w 1194 --h 834 --rot 4 [--hand] [--map] [--walk 2,1.5] [--zoom 1.4]
node tools/char-pipeline/record_walk.mjs         # webm of a walk loop from the actual game
node tests/rules-check.mjs && node tests/logic-check.mjs && node tests/browser-test.mjs
```
Export path is derived from the repository root (`Path(__file__).resolve().parents[2]`), not a
hardcoded home directory.

## Completed increments
1. `77cc0ca` — checkpoint doc, measured target spec, capture tool (`capture.mjs`), bpy helpers
   (`victor_lib.py`), baseline gap analysis.
2. Victor v2 model (`make_victor.py` rewrite, `preview_glb.{html,mjs}` previewer): designed skull +
   hair cap with snapped hairline / part / quiff, tapered brows + moustache, lofted jacket with
   conforming shirt V + peaked lapels, bow tie, capsule limbs with joint spheres, jointed rig, phased
   walk, measured stride in GLB extras. 14,420 tris / 8 materials / 480 KB. Verified in the real game
   at all 4 rotations (`shots/g6-r*-crop.png`, `shots/g6z-r0-crop.png`).
   Iteration lessons: rotate parts about their OWN centre (an object-level rotation applied around
   the world origin sent the quiff flying); thin panels need interior vertices projected onto the
   curved chest or they sag behind it and vanish; the hair cap must receive the same shapers as the
   skull or the skull pokes through; brows whose inner ends dip read as angry.
3. Movement integration (`src/render/characterView.js`): the walk clip's phase is advanced by
   distance travelled ÷ stride (stride read from the GLB extras, fallback in `characters.js`), so the
   planted foot moves backward at exactly the ground speed at any speed; Idle↔Walk cross-fade
   (~0.25 s game time); teleport guard; `view.debug()` hook. `tools/char-pipeline/walk_check.mjs`
   drives short/long walks, turns, an interrupt and a doorway crossing from the real game and
   verifies: stride in use 1.0832, phase-vs-distance error 0, mesh-vs-mover offset 0, no errors.
   Headless SwiftShader runs ~3 fps, so wall-clock settle times there are not representative.
4. Portraits from the model (`tools/char-pipeline/portrait.mjs` + `portrait_post.py`): a bust of the
   actual GLB with the game's lighting/Lambert look → `assets/portraits/victor.jpg` (normal) and
   `victor-possessed.jpg` (cold violet wash, vignette, glowing slit-pupil right eye drawn at the
   projected eye position). Same filenames as before → `PORTRAIT_ART` unchanged; the public strip
   still always requests the normal look. The painted portraits are replaced (owner-authorised).
5. Interface (`index.html`, `styles.css`, `src/ui/cardIcons.js`, `src/ui/cards.js`, `src/map.js`): one
   `.hud-bottom` flex container (grid, two rows, in portrait/≤900 px) so the panel, hand opener and
   buttons never overlap; guest strip on a charcoal plate (names readable over bright walls); ≥48 px
   targets; drawn SVG card icons; map with labels clear of the arrow, grid and compass. Verified at
   1194×834, 1024×768, 1180×820, 1366×1024, 834×1194 (`shots/gui-*.png`, captured with `--still`).

## Failed attempts / lessons (keep — they save the next session time)
- v1: tilting the head up to "catch" the camera exposed the bald crown → shiny bald egg from above.
  Upright head + hair that owns the crown is the fix; never fake the facing.
- v1: authoring Blender base colours as raw linear numbers rendered far too light (black → grey).
  Author as sRGB hex and convert to linear (`hexlin()` in make_victor.py).
- v1: `MeshStandardMaterial` specular blew a hotspot on the round head under the warm overhead light;
  matte Lambert conversion on load (same as the furniture loader) fixed it.

- (v5) The shoe splay had the wrong sign since v4 (`-s * splay` rotated the toes INWARD, so both shoes
  merged into one slab in the front view). Check silhouettes numerically — it was visible only as a
  0.67 width ratio at the 98 % band.
- (v5) The sheet's chin is at 31.5 % of height, not 28.5 %: the earlier number was the jaw corner
  (the chin hides the neck). Re-measure landmarks per row before trusting a band table.
- (v5) `MeshLambertMaterial` divides by π: a "neutral" hemisphere 1.0 + key 1.6 renders albedo at
  ~0.7×, which is why the peach skin looked tan. Judge colours only under the albedo-faithful preview.
- (v5) A single offset-shell hair with a thickness field jaggs at the hairline; giving the hair its
  own cap parameterisation (rows follow the hairline, a rounded lip, hidden inner skin) fixed it.
- (v5) The AI turnaround is not self-consistent (asymmetric head, back panel ~7 % larger): reconcile
  to the front panel and the face close-ups, don't chase every panel.

## Unresolved problems / honest limitations
- Hairline shows slight stair-stepping at the temples in the portrait close-up (sphere row density);
  invisible at game size. Fix if wanted: denser rows near the hairline or a lofted cap.
- Limb joints are capsule segments with joint spheres — visible segmentation up close; clean at
  game size. Smooth-weighted continuous limbs would be the upgrade.
- Walk stance uses a smooth-triangle thigh curve, so there is a tiny within-cycle foot slide at
  contact/toe-off; the average cadence is exactly matched to distance.
- Headless renders run ~3 fps; only the clock-stepped recording represents animation timing. iPad
  frame rate is untested (340 draw calls / 41k tris in the hall).
- Design-panel workflow: 3 designs completed, judge + synthesis agents hit the session usage limit
  (results in the workflow transcript). Not incorporated; the shipped approach was validated by
  renders instead.

## Evidence captured (all headless Chromium/SwiftShader renders of the REAL game page or the real GLB —
automated checks, not iPad testing). Under `tools/char-pipeline/shots/` (gitignored):
- Baseline: `base-r{0..3}(-crop).png`, `base-{1024,1180,1366,portrait}-r0.png`, `base-still-{hand,map}.png`.
- Model iterations: `v2…v5-*.png`; final character `final-char-{front,tq,back,turn0..3}.png`.
- Final in-game, 1194×834 @2, 4 rotations: `final-r{0..3}(-crop).png`; zoomed `g6z-r0-crop.png`.
- Interface: `gui-r0.png` (hand closed), `gui-hand.png`, `gui-map.png` at 1194×834; `gui-1024-r0.png`,
  `gui-1180-r0.png`, `gui-1366-r0.png`, `gui-portrait-r0.png` (+ `-hand`/`-map` each). Viewports are
  CSS px; screenshots are ×2 (see each `*.json`).
- Movement: `walkframes/f*.png` (real-game mid-walk frames); `victor-walk.webm` = 183 frames, 6.1 s at
  30 fps of GAME time (`record_smooth.mjs`; verified 33 ms game time per frame: 10 ticks moved the
  mover 0.64 m at 2 m/s), route idle → walk → turn → stop → north door → doorway crossing into the
  East Corridor; `recframes/*.jpg` contact sheet.
- Portraits: `assets/portraits/victor.jpg`, `victor-possessed.jpg` (shipped).
- Measurements: victor.glb 14,420 tris / 8 materials / 480,412 B; scene with Victor: 340 draw calls,
  41,426 tris, 13 programs (`scene_stats.mjs`).

## Next concrete action
See "Status: Victor v5" at the top: Victor's appearance pass is presented for the owner's review
(2026-09-14, evening). Do NOT start the other characters, rooms or GUI work until approved. If
feedback arrives: adjust `CFG` / the skull and hair tables in `make_victor.py`, rebuild, re-run the
v5 loop (`preview_glb.mjs`, `compare.py`, `compare_head.py`, `capture.mjs`, `walk_check.mjs`,
`portrait.mjs`), update the status section, commit to main.

## Owner decisions pending
- (none yet)
