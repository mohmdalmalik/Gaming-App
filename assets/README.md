# Assets

What is in each folder and where the game reads it. Images are referenced by relative path (the game is served
from a sub-path), so keep paths relative.

| Folder | What | Read by |
|---|---|---|
| `audio/` | the music and effects (MP3), made by `tools/audio/` from code | `src/audio/` (the file table is the generated `src/audio/library.js`) |
| `cards/face/<type>.jpg`, `cards/back.jpg` | the owner's finished card faces (2:3, 512 x 768) and the card back | `CARD_FACE` and `CARD_BACK` in `src/ui/cards.js` |
| `characters/<guest>.glb` | the six guest models (the six looks of the wardrobe) | `src/data/wardrobe.js` (the looks), `src/data/characters.js`, `src/menu/lobbyCast.js` (the lobby's guests) |
| `portraits/<guest>.jpg`, `<guest>-possessed.jpg` | stock portraits, shown until a portrait drawn from the player's own avatar is ready | `PORTRAIT_ART` in `src/ui/portrait.js` |
| `models/lobby/`, `models/rooms/` | the baked rooms: one model and two light maps per room, one shared albedo | `src/render/bakedRoom.js`, listed in `src/data/dressing.js` |
| `icons/` | the app icon (README inside) | `index.html`, `manifest.webmanifest` |

Everything here is made by the tools in `tools/` (card faces: `tools/card-pipeline/`; guests: `tools/char-pipeline/`; rooms:
`tools/lobby-pipeline/` and `tools/room-pipeline/`; sounds: `tools/audio/`). To change a card's picture, replace its file in
`cards/face/` with a 512 x 768 JPEG: nothing in the code changes. A guest's stock portrait is a head-and-shoulders JPEG,
upright 3:4 (about 768 px on the long side: the interface crops it to a square and to a 3:4 box with
`object-position: 50% 20%`, so keep the face in the upper middle). The `-possessed` portrait appears only on a
guest's own player panel while they are possessed, never on the shared strip.

Not here any more (removed 14 Oct 2026, nothing used them): the older 640 x 640 card illustrations (the finished faces
replaced them; the Lock Pick one that `tools/card-pipeline/make_lockpick_face.py` reads now lives in
`tools/card-pipeline/art/`) and the Kenney furniture and building models of the first greybox dressing.
