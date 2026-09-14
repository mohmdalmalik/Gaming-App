# Character + GUI phase — working checkpoint

_Living document. Updated after each meaningful increment so a new session (or a new agent) can
continue without redoing finished work. If you are resuming: read this whole file first, then check
`git log` for the last working commit named below._

## Goal of this phase (owner's brief, 2026-09-14)
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
- (none yet in this phase)

## Failed attempts / lessons (keep — they save the next session time)
- v1: tilting the head up to "catch" the camera exposed the bald crown → shiny bald egg from above.
  Upright head + hair that owns the crown is the fix; never fake the facing.
- v1: authoring Blender base colours as raw linear numbers rendered far too light (black → grey).
  Author as sRGB hex and convert to linear (`hexlin()` in make_victor.py).
- v1: `MeshStandardMaterial` specular blew a hotspot on the round head under the warm overhead light;
  matte Lambert conversion on load (same as the furniture loader) fixed it.

## Unresolved problems
- (tracked here as they appear)

## Evidence captured
- (paths listed as they are produced; all "in-game" shots are headless Chromium/SwiftShader renders
  of the real game page — automated checks, not iPad testing)

## Next concrete action
Capture the baseline (4 rotations, normal zoom, 1194×834@2) and fill in the gap analysis.

## Owner decisions pending
- (none yet)
