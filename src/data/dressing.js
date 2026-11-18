// Per-room "dressing" — which baked glTF model replaces a room's greybox shell, floor and furniture
// boxes, its light maps and exposure, and (the lobby) where the lamp lights sit. Keyed by room id; only
// rooms listed are dressed, anything else would stay greybox and untouched. Every room of the hotel is
// listed: the lobby below and every other tile in BAKED_TILES.
//
// The furniture footprints stay in the room data (src/data/hotel.js), so collision comes from one place
// and the baked model is built on exactly those footprints (tools/lobby-pipeline, tools/room-pipeline).

export const roomDressings = {
  // The starting room is one baked model (tools/lobby-pipeline/, loaded by
  // src/render/bakedRoom.js): walnut panelling cut at a consistent height, cream stone floor,
  // burgundy rugs, red velvet seating, brass lamps and sconces, with soft shadows and lamp light
  // baked in. The collision footprints are the lobby furniture in src/data/hotel.js.
  hall: {
    style: 'baked',
    model: 'lobby/lobby.glb',
    light: 'lobby/lobby-light.jpg',
    floorLight: 'lobby/lobby-floor-light.jpg',
    exposure: 0.62,
    // Lamp lights: which of the room's mood-light indices (from mood.lights in hotel.js) sit
    // low by a lamp rather than up at the ceiling, and how warm/bright each is. Index 0 is the
    // ceiling fill and is left alone.
    lampLights: { indices: [1, 2, 3], height: 1.0, color: '#ffe6c0', intensityScale: 0.9 },
  },

};

// Every other room: a tile baked by tools/room-pipeline/make_room.py, loaded when the room is revealed
// (src/render/bakedRoom.js, dressBakedTile). All tiles share one albedo texture; each has its own two
// light maps. `exposure` scales the baked light, set so each room reads like its reference in the game. The five
// dark rooms (`dark` in src/data/hotel.js: service corridor, storage, stairs, back corridor, housekeeping) were
// lowered to 72% of their old exposure on 21 Oct 2026 (the owner chose darker dark rooms, the graphics review's
// option b; 0.42, 0.52, 0.44, 0.82, 0.43 before): clearly darker than a lit room, the guests (lit apart from the
// rooms), the furniture and the red eyes still read. At 60% the shelves and carts at the edges went nearly black.
export const BAKED_TILES = {
  lounge: 0.77, ballroom: 0.64, grandCorridor: 0.66, switchboard: 0.62, dining: 0.52, library: 0.72,
  kitchen: 0.5, serviceCorridor: 0.3, storage: 0.37, corridorE: 0.58, corridorW: 0.58, corridorN: 0.55,
  corridorS: 0.55, stairs: 0.32, backCorridor: 0.59, cloakroom: 0.61, cornerCorridor: 0.55, infirmary1: 0.51,
  infirmary2: 0.49, linenStore1: 0.52, linenStore2: 0.52, suite416: 0.7, housekeeping: 0.31, exit: 0.5,
};
// A room's own floor (graphics round 2, 18 Nov 2026): one square picture laid over the whole tile, north at the
// top, in place of the shared stone-and-red-rug floor, so every room reads as its own place at a glance and the
// rooms with a job carry their sign in the floor (the Switchboard's brass dial, the Infirmary's red cross, the
// Linen Store's folded napkin, the Fire Exit's green carpet running to the exit door). The baked light and the
// furniture's shadows stay: the picture replaces the floor's colour only (src/render/bakedRoom.js). The corridors
// keep the lobby's stone and red runners, which lead through their doorways. `art` is the file in
// assets/models/rooms/floors/ (the two Infirmaries and the two Linen Stores share one each); `gain` scales the
// baked light on that floor alone, where a pale or a dark design needs it. The pictures were made with Higgsfield
// (tools/room-pipeline/floors.md lists each one's prompt).
export const FLOOR_ART = {
  lounge: { art: 'lounge' }, ballroom: { art: 'ballroom' }, dining: { art: 'dining' }, library: { art: 'library' },
  kitchen: { art: 'kitchen' }, cloakroom: { art: 'cloakroom' }, suite416: { art: 'suite416' },
  switchboard: { art: 'switchboard' }, infirmary1: { art: 'infirmary' }, infirmary2: { art: 'infirmary' },
  linenStore1: { art: 'linenStore' }, linenStore2: { art: 'linenStore' }, exit: { art: 'exit' },
  storage: { art: 'storage', gain: 1.45 }, housekeeping: { art: 'housekeeping', gain: 1.25 }, stairs: { art: 'stairs', gain: 1.6 },
};
for (const [id, exposure] of Object.entries(BAKED_TILES)) {
  roomDressings[id] = {
    style: 'baked', tile: true, exposure,
    model: `rooms/${id}.glb`, light: `rooms/${id}-light.jpg`, floorLight: `rooms/${id}-floor.jpg`,
    albedo: 'rooms/albedo.jpg',
  };
  const f = FLOOR_ART[id];
  if (f) Object.assign(roomDressings[id], { floorArt: `rooms/floors/${f.art}.jpg`, floorGain: f.gain ?? 1 });
}
