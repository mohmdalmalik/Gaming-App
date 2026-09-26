# Room pipeline (Blender → baked glTF → game)

Builds every room tile in the style of the starting room (`tools/lobby-pipeline/`), matching
`docs/art-reference.jpg`. The game loads the output from `assets/models/rooms/` when a room is revealed
(`dressBakedTile` in `src/render/bakedRoom.js`; the list of rooms is `BAKED_TILES` in `src/data/dressing.js`).

## Steps
```bash
python3 -m pip install "bpy==4.2.0" pillow numpy                       # once
node    tools/room-pipeline/dump_rooms.mjs > tools/room-pipeline/rooms.json
python3 tools/room-pipeline/textures_rooms.py                        # the shared albedo atlas
tools/room-pipeline/build_all.sh 1024 48                             # every room (~2.5 min each)
tools/room-pipeline/build_all.sh 512 12 library kitchen              # quick preview of a few
node    tools/room-pipeline/shoot.mjs --rooms library,kitchen         # look at them in the game
node    tools/room-pipeline/perf.mjs --rooms 12                       # draw calls with many rooms
```
Re-run `dump_rooms.mjs` and the builds whenever a tile's doorways or furniture change in
`src/data/hotel.js`: the models are built on those footprints.

## Files
- `dump_rooms.mjs` — every tile from the game data, default orientation, centred on (0, 0).
- `textures_rooms.py` — the one albedo atlas all rooms share (4 × 4 cells, see its header).
- `roomkit.py` — geometry, walls in four styles, doorways, wall decoration, lighting, bake, denoise.
- `make_room.py` — the furniture library (one builder per footprint kind) and a theme per room: wall
  style, floor, rugs, decoration along the walls, lights. `--nobake` builds geometry only (seconds).
- `pack_glb.py` — packs the exported .glb (8-bit colours, 16-bit UVs) without changing the look.
- `build_all.sh` — build, bake and pack all rooms (or the ones named).
- `shoot.mjs`, `perf.mjs` — screenshots from four angles and performance, in the real game.

Light maps store `light / 4` in sRGB JPEG (must match `LM_SCALE` in `src/render/bakedRoom.js`);
`exposure` per room is in `src/data/dressing.js` (no re-bake needed to brighten or darken a room).
