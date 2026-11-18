# The rooms' own floor pictures (graphics round 2, 18 Nov 2026)

Sixteen rooms show a floor picture of their own (`FLOOR_ART` in `src/data/dressing.js`, drawn by
`src/render/bakedRoom.js`); the files are `assets/models/rooms/floors/<name>.jpg`, 1024 px square, north at the top
(the Fire Exit's arrows point up, at the exit door on the tile's north wall). Fourteen pictures: the two Infirmaries
share one, the two Linen Stores share one. The corridors and the lobby keep their stone and red runners.

They were made with Higgsfield (the owner's account), model `gpt_image_2_6`, quality `low`, 1024 x 1024, 0.25
credits each, and saved for the game by `python3 tools/room-pipeline/floor_art.py <folder with the originals>`
(that script also tones the Fire Exit's green down). The originals are not in the repository: each one is in the
owner's Higgsfield library under the job below, and the prompt makes a new one.

## The prompt
Every picture used the same opening and closing, with one description in between:

> Top-down orthographic view, perfectly flat, a square image filled edge to edge with the FLOOR ONLY of
> **[the room]**, for a cozy stylized isometric video game set in a grand 1930s art deco hotel.
> **[the description]** Centred, symmetric composition. Clean shapes, soft painterly stylized game texture, rich
> saturated colours, even flat lighting. No furniture, no walls, no people, no objects, no shadows, no
> perspective, no text, no letters, no numbers.

Rules that keep a picture usable: nothing with a right way up unless it points at something in the room (a tile is
turned four ways and the camera turns too: the Switchboard's telephone dial and the Infirmary's cross read the
same from every side, the Fire Exit's arrows point at its door); a clear middle (guests stand there) and nothing
that matters in the outer 2% (the walls stand on it).

| File | Room | Description | Higgsfield job |
|---|---|---|---|
| `switchboard` | Switchboard | deep petrol-teal carpet with a subtle art deco fan pattern, a wide border band of cream and thin brass lines, in the centre a large circular brass inlay medallion shaped like a vintage rotary telephone dial with ten finger holes in a ring | `61e7b96e-19ea-4295-892a-9df7d2f3d4fb` |
| `infirmary` | Infirmary (both) | glossy white and pale mint-green clinic tiles in a small checker, a mint-green border band, in the centre a large round white medallion with a bold bright red medical cross | `114337d8-f8ff-4fb4-994c-5e6b93cccc7d` |
| `linenStore` | Linen Store (both) | pale sky-blue and white diamond-pattern tiles, a navy border band, in the centre a large round white medallion with an eight-petal rosette like a folded white linen napkin, outlined in navy | `bb2c334c-2d0c-4443-b268-acf9cb8c9a37` |
| `exit` | Fire Exit | charcoal concrete, a border of yellow and black hazard stripes, three large green chevron arrows pointing straight up, a green band along the top edge | `493df0d7-3ce3-4406-ae4c-e9dd8ec15006` |
| `lounge` | Lounge | sapphire-blue carpet with a small gold art deco diamond-and-star motif, a deep navy border with two thin gold lines, a large gold-line sunburst octagon in the centre | `be402e78-5bca-4ab8-bed9-6503bca2fbcf` |
| `dining` | Dining Room | deep plum-purple carpet with a tone-on-tone damask pattern, a dark aubergine border with thin gold lines and small gold corner ornaments | `b24b91f5-f612-4d35-bccd-dbff26f6c819` |
| `library` | Library | warm honey-brown wooden planks, and in the middle a very large emerald-green Persian rug with a cream and gold border and a gold central medallion | `bbc37fb4-1033-4f42-ae54-1a3cc1d63183` |
| `ballroom` | Ballroom | golden-honey herringbone parquet, a dark walnut border with a thin brass inlay line, in the centre a very large inlaid compass-rose starburst medallion of dark walnut, pale maple and brass | `956fa073-d616-4ccf-9dfe-6c35d5ba2f22` |
| `kitchen` | Kitchen | black and white checkerboard tiles, about twelve across, slightly worn and glossy, a border row of plain white tiles | `303dd10a-eb91-4fb9-abc3-f2762a99d8c7` |
| `cloakroom` | Cloakroom | wall-to-wall tartan carpet in forest green and navy with thin yellow and red lines, a plain dark green border with a thin gold line | `2219551b-ad0f-4893-b658-f95bdb896a7e` |
| `suite416` | Guest Suite 416 | soft dusty-rose carpet with a delicate tone-on-tone floral pattern, a wide cream border with a thin gold line and small rose ornaments in the corners | `f74aa196-caee-421d-b28a-d939ddac8012` |
| `storage` | Storage Room | pale grey poured concrete with hairline cracks and faint stains, a painted safety-yellow square walkway outline a fifth in from the edges, a square steel drain grate in the centre | `05c4dd85-90ea-4977-a81c-63c73151183c` |
| `housekeeping` | Housekeeping Store | warm terracotta quarry tiles with pale grout, about ten across, a border row of darker brick-red tiles | `3f95a0ed-8f12-4c31-af37-cfbd10733736` |
| `stairs` | Service Stairs | speckled grey-green terrazzo with chips of cream, black and jade, divided into large squares by thin brass strips, a black terrazzo border | `bab84f60-f7c9-4ca9-8fd2-d38b8794b064` |

## Changing or adding one
1. Make a square picture with the prompt above (any image tool; from this project's cloud sessions Higgsfield's
   unlimited allowance is not available, only credits: it works in the Claude chat app).
2. Save it as `<name>.png` in a folder, run `python3 tools/room-pipeline/floor_art.py <that folder>`.
3. A new room: add it to `FLOOR_ART` in `src/data/dressing.js`. `gain` brightens that floor alone (the three dark
   rooms use 1.25 to 1.6, so their floors still read in their low light).
No Blender and no re-bake: the room's baked light and shadows are laid over the picture as they were over the old floor.
