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
// light maps. `exposure` scales the baked light, set so each room reads like its reference in the game; the
// dark rooms (service corridor, storage, stairs, back corridor, housekeeping) sit at about 60% of that.
export const BAKED_TILES = {
  lounge: 0.77, ballroom: 0.64, grandCorridor: 0.66, switchboard: 0.62, dining: 0.52, library: 0.72,
  kitchen: 0.5, serviceCorridor: 0.42, storage: 0.52, corridorE: 0.58, corridorW: 0.58, corridorN: 0.55,
  corridorS: 0.55, stairs: 0.44, backCorridor: 0.82, cloakroom: 0.61, cornerCorridor: 0.55, infirmary1: 0.51,
  infirmary2: 0.49, linenStore1: 0.52, linenStore2: 0.52, suite416: 0.7, housekeeping: 0.43, exit: 0.5,
};
for (const [id, exposure] of Object.entries(BAKED_TILES)) {
  roomDressings[id] = {
    style: 'baked', tile: true, exposure,
    model: `rooms/${id}.glb`, light: `rooms/${id}-light.jpg`, floorLight: `rooms/${id}-floor.jpg`,
    albedo: 'rooms/albedo.jpg',
  };
}
