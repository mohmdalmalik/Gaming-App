# Room pipeline (Blender → baked glTF → game)

Builds every room tile as one baked model, matched to the owner's reference image for that room
(`ref/<room>.jpg`; the lobby has its own pipeline, `tools/lobby-pipeline/`). The game loads the output from
`assets/models/rooms/` when a room is revealed (`dressBakedTile` in `src/render/bakedRoom.js`; the list of rooms
and each room's `exposure` is `BAKED_TILES` in `src/data/dressing.js`).

## Steps
```bash
python3 -m pip install "bpy==4.2.0" pillow numpy                       # once
node    tools/room-pipeline/dump_rooms.mjs > tools/room-pipeline/rooms.json
python3 tools/room-pipeline/textures_rooms.py                        # the shared albedo atlas
tools/room-pipeline/build_all.sh 1024 48                             # every room (~2.5 min each, ~1 h)
tools/room-pipeline/build_all.sh 512 16 library kitchen              # quick preview of a few (~30 s each)
python3 tools/room-pipeline/make_room.py --room library --nobake --out /tmp/x   # geometry only, seconds
node    tools/room-pipeline/vsref.mjs [--rooms library,kitchen]       # side by side with the references
node    tools/room-pipeline/walkcheck.mjs [--rooms library]           # walk through every doorway in the game
node    tools/room-pipeline/shoot.mjs --rooms library,kitchen         # four camera angles in the game
node    tools/room-pipeline/perf.mjs --rooms 12                       # draw calls with many rooms
```
Re-run `dump_rooms.mjs` and the builds whenever a tile's doorways or furniture change in
`src/data/hotel.js`: the models are built on those footprints (they are the game's collision).

## The references (`ref/`)
One reference per room (`infirmary.jpg` serves both infirmaries; the corner one is adapted to its layout).
They share one style, reproduced here:
- dark mahogany walls in tall moulded panels, square pilasters with brass plinths at every doorway and
  corner, a heavy cap and a frieze rail (`MAHOGANY` in `roomkit.py`); variants keep the pilasters and cap and
  change the field: cream wall tiles (kitchen), sage or beige plaster over a wainscot (service rooms,
  back corridor, infirmaries, linen stores);
- warm upright sconces flanking every doorway; caged lanterns in the store rooms and on the stairs;
- cream stone tiles, and per room: herringbone parquet (ballroom), planks (library, suite), a beige and
  taupe checker (kitchen), sage tiles (infirmaries), dark slate (back corridor);
- burgundy rugs, runners and border bands with a thin gold line (flat shapes built by `rug()`, so a
  cross or T runner gets one continuous gold outline and no line where it runs out through a doorway);
- low front walls: a lowered wall keeps its lower 0.64 m, and the doorway and corner posts keep 1.05 m;
- chunky, clean furniture (one builder per footprint `kind` in `make_room.py`).

The doorways are the game's (`hotel.js`): where a reference shows an opening the tile does not have, the
room has a wall there. The furniture sits exactly on the footprints in `hotel.js`, which were laid out to
follow each reference with the doorways reachable and the middle clear; the piece flagged `searchSpot(...)`
is the room's search spot (its `size[1]` is its real height, and the tile's `searchPoint` names it).

## Colour and light
The game draws the baked rooms unlit (albedo × light map × `exposure`) through Khronos neutral tone
mapping, which takes up to 0.04 off every channel of a dark colour (the least channel most). So colours
in `roomkit.py` / `make_room.py` are written as they should SHOW (picked from the references) and turned
into albedo by `shown(colour, light)`; the light maps are saved with their colour tamed (`sat` in
`save_lightmap`), so bounce light off brown walls does not turn everything orange. The dark rooms (service
corridor, storage, stairs, back corridor, housekeeping) are baked with lamps and little ambient light, and
stay dim in the game.

## Files
- `dump_rooms.mjs` — every tile from the game data, default orientation, centred on (0, 0).
- `textures_rooms.py` — the one albedo atlas all rooms share (4 × 4 cells, see its header).
- `roomkit.py` — geometry (boxes, turned boxes, discs, leaves), floors and rugs, walls (panels, tiles,
  plaster; pilasters and corner posts), doorways, sconces, lanterns, paintings, windows with drapes,
  mirrors, lighting, bake, denoise.
- `make_room.py` — the furniture library (one builder per footprint kind) and each room's theme: wall
  style, floor, rugs, wall decoration, lights, per-room details (`fx`). `--nobake` builds geometry only,
  `--out` writes somewhere else.
- `pack_glb.py` — packs the exported .glb (8-bit colours, 16-bit UVs) without changing the look.
- `build_all.sh` — build, bake and pack all rooms (or the ones named).
- `vsref.mjs` + `vsref_sheet.py` — each room in the real game, camera at the game's own pitch and zoom,
  turned so the room's entrance (its south doorway) is at the bottom as in the reference; writes
  `shots/<room>-vs-ref.png` and the contact sheet `shots/rooms-vs-refs.png`.
- `walkcheck.mjs` — reveals each tile next to the lobby and walks a guest in, then opens each of its
  other doorways and walks through and back.
- `shoot.mjs`, `perf.mjs` — screenshots from four angles and performance, in the real game.

Light maps store `light / 4` in sRGB JPEG (must match `LM_SCALE` in `src/render/bakedRoom.js`);
`exposure` per room is in `src/data/dressing.js` (no re-bake needed to brighten or darken a room).
